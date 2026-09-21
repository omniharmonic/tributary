/**
 * `SpaceStore` over Postgres, schema `gate`. A line-for-line mirror of
 * `MemorySpaceStore`: the SAME access decisions (`Access`) in the SAME order, pinned
 * by the shared suite in `test/store-suite.ts`, so a Phase B migration moves rows,
 * not semantics.
 */
import { createHash } from 'node:crypto'
import type pg from 'pg'
import { Access } from './access.js'
import { tid } from './memory.js'
import {
  NotFoundError,
  SpaceAccessError,
  parseRecordUri,
  parseSpaceUri,
  type BlobStorage,
  type CreateSpaceInput,
  type Did,
  type Space,
  type SpaceMember,
  type SpaceRecord,
  type SpaceStore,
  type StoreOptions,
} from './types.js'

export const GATE_SCHEMA_SQL = `
create schema if not exists gate;
create table if not exists gate.space (
  uri text primary key,
  authority text not null,
  space_type text not null,
  skey text not null,
  read_policy jsonb not null,
  write_policy jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists space_authority_idx on gate.space (authority);
create table if not exists gate.space_member (
  space_uri text not null references gate.space(uri) on delete cascade,
  did text not null,
  role integer not null,
  created_at timestamptz not null default now(),
  primary key (space_uri, did)
);
create index if not exists space_member_did_idx on gate.space_member (did);
create table if not exists gate.space_record (
  uri text primary key,
  space_uri text not null references gate.space(uri) on delete cascade,
  author text not null,
  collection text not null,
  rkey text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists space_record_space_idx on gate.space_record (space_uri, collection);
create table if not exists gate.space_blob (
  id text not null,
  space_uri text not null references gate.space(uri) on delete cascade,
  author text not null,
  mime text not null,
  size integer not null,
  created_at timestamptz not null default now(),
  primary key (id, space_uri)
);
`

export async function migrateSpaceStore(pool: pg.Pool): Promise<void> {
  await pool.query(GATE_SCHEMA_SQL)
}

interface SpaceRow {
  uri: string
  authority: string
  space_type: string
  skey: string
  read_policy: Space['readPolicy']
  write_policy: Space['writePolicy']
  created_at: Date
}
interface RecordRow {
  uri: string
  space_uri: string
  author: string
  collection: string
  rkey: string
  value: unknown
  created_at: Date
  updated_at: Date
}

function toSpace(r: SpaceRow): Space {
  return {
    uri: r.uri,
    authority: r.authority as Did,
    spaceType: r.space_type,
    skey: r.skey,
    readPolicy: r.read_policy,
    writePolicy: r.write_policy,
    createdAt: r.created_at.toISOString(),
    credentialTail: 0,
  }
}
function toRecord<T>(r: RecordRow): SpaceRecord<T> {
  return {
    uri: r.uri,
    spaceUri: r.space_uri,
    author: r.author as Did,
    collection: r.collection,
    rkey: r.rkey,
    value: r.value as T,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

export class PostgresSpaceStore implements SpaceStore {
  private readonly access: Access
  private readonly storage: BlobStorage
  private readonly sign: (id: string, viewer: Did | null) => string

  constructor(
    private readonly pool: pg.Pool,
    opts: StoreOptions = {},
  ) {
    this.access = new Access({ roleOf: (uri, did) => this.roleOf(uri, did) }, opts)
    if (!opts.blobs) throw new Error('PostgresSpaceStore needs a BlobStorage')
    this.storage = opts.blobs
    this.sign = opts.signBlobUrl ?? ((id, viewer) => `gate://blobs/${id}?viewer=${viewer ?? 'anon'}`)
  }

  private async roleOf(spaceUri: string, did: Did): Promise<number | null> {
    const r = await this.pool.query<{ role: number }>('select role from gate.space_member where space_uri = $1 and did = $2', [spaceUri, did])
    return r.rows[0]?.role ?? null
  }

  private async load(uri: string): Promise<Space | null> {
    const r = await this.pool.query<SpaceRow>('select * from gate.space where uri = $1', [uri])
    return r.rows[0] ? toSpace(r.rows[0]) : null
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const uri = `at://${input.authority}/${input.spaceType}/${input.skey}`
    if (!parseSpaceUri(uri)) throw new SpaceAccessError('invalid space address')
    const r = await this.pool.query<SpaceRow>(
      `insert into gate.space (uri, authority, space_type, skey, read_policy, write_policy)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (uri) do update set read_policy = excluded.read_policy, write_policy = excluded.write_policy
       returning *`,
      [uri, input.authority, input.spaceType, input.skey, JSON.stringify(input.readPolicy), JSON.stringify(input.writePolicy)],
    )
    return toSpace(r.rows[0]!)
  }

  async getSpace(uri: string, viewer: Did | null = null): Promise<Space | null> {
    const s = await this.load(uri)
    if (!s) return null
    return (await this.access.canRead(s, viewer)) ? s : null
  }

  async deleteSpace(uri: string, actor: Did): Promise<void> {
    const s = await this.load(uri)
    if (!s || !(await this.access.canRead(s, actor))) throw new NotFoundError()
    if (!this.access.isAuthority(s, actor)) throw new SpaceAccessError('only the authority deletes a space')
    const blobs = await this.pool.query<{ id: string }>('select id from gate.space_blob where space_uri = $1', [uri])
    await this.pool.query('delete from gate.space where uri = $1', [uri])
    for (const b of blobs.rows) {
      const elsewhere = await this.pool.query('select 1 from gate.space_blob where id = $1 limit 1', [b.id])
      if (elsewhere.rowCount === 0) await this.storage.delete(b.id)
    }
  }

  async putMember(spaceUri: string, actor: Did, member: Did, role: number): Promise<void> {
    const s = await this.load(spaceUri)
    if (!s || !(await this.access.canRead(s, actor))) throw new NotFoundError()
    if (!(await this.access.canManage(s, actor))) throw new SpaceAccessError('only the authority manages membership')
    await this.pool.query(
      `insert into gate.space_member (space_uri, did, role) values ($1, $2, $3)
       on conflict (space_uri, did) do update set role = excluded.role`,
      [spaceUri, member, role],
    )
  }

  async removeMember(spaceUri: string, actor: Did, member: Did): Promise<void> {
    const s = await this.load(spaceUri)
    if (!s || !(await this.access.canRead(s, actor))) throw new NotFoundError()
    if (!(await this.access.canManage(s, actor))) throw new SpaceAccessError('only the authority manages membership')
    await this.pool.query('delete from gate.space_member where space_uri = $1 and did = $2', [spaceUri, member])
  }

  async listMembers(spaceUri: string, viewer: Did): Promise<SpaceMember[]> {
    const s = await this.load(spaceUri)
    if (!s || !(await this.access.canRead(s, viewer))) throw new NotFoundError()
    const r = await this.pool.query<{ did: string; role: number }>('select did, role from gate.space_member where space_uri = $1 order by created_at', [spaceUri])
    return r.rows.map((m) => ({ did: m.did as Did, role: m.role }))
  }

  async putRecord<T>(spaceUri: string, author: Did, collection: string, value: T, rkey = tid()): Promise<SpaceRecord<T>> {
    const s = await this.load(spaceUri)
    if (!s || !(await this.access.canRead(s, author))) {
      if (!s || !(await this.access.canWrite(s, author))) throw new NotFoundError()
    }
    if (!(await this.access.canWrite(s, author))) throw new SpaceAccessError('not permitted to write')
    const uri = `${spaceUri}/${author}/${collection}/${rkey}`
    const prev = await this.pool.query<{ author: string }>('select author from gate.space_record where uri = $1', [uri])
    if (prev.rows[0] && prev.rows[0].author !== author) throw new SpaceAccessError('record belongs to another author')
    const r = await this.pool.query<RecordRow>(
      `insert into gate.space_record (uri, space_uri, author, collection, rkey, value)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (uri) do update set value = excluded.value, updated_at = now()
       returning *`,
      [uri, spaceUri, author, collection, rkey, JSON.stringify(value)],
    )
    return toRecord<T>(r.rows[0]!)
  }

  async getRecord<T = unknown>(uri: string, viewer: Did | null): Promise<SpaceRecord<T> | null> {
    const parsed = parseRecordUri(uri)
    if (!parsed) return null
    const s = await this.load(parsed.spaceUri)
    if (!s) return null
    const r = await this.pool.query<RecordRow>('select * from gate.space_record where uri = $1', [uri])
    const row = r.rows[0]
    if (!row) return null
    const rec = toRecord<T>(row)
    if (rec.author === viewer) return rec
    return (await this.access.canRead(s, viewer, rec.author)) ? rec : null
  }

  async listRecords<T = unknown>(spaceUri: string, viewer: Did | null, collection?: string): Promise<SpaceRecord<T>[]> {
    const s = await this.load(spaceUri)
    if (!s || !(await this.access.canRead(s, viewer))) throw new NotFoundError()
    const r = collection
      ? await this.pool.query<RecordRow>('select * from gate.space_record where space_uri = $1 and collection = $2 order by created_at', [spaceUri, collection])
      : await this.pool.query<RecordRow>('select * from gate.space_record where space_uri = $1 order by created_at', [spaceUri])
    return r.rows.map((row) => toRecord<T>(row))
  }

  async deleteRecord(spaceUri: string, actor: Did, recordUri: string): Promise<void> {
    const s = await this.load(spaceUri)
    if (!s) throw new NotFoundError()
    const r = await this.pool.query<{ author: string }>('select author from gate.space_record where uri = $1 and space_uri = $2', [recordUri, spaceUri])
    const rec = r.rows[0]
    const canRead = await this.access.canRead(s, actor)
    if (!rec) {
      if (!canRead) throw new NotFoundError()
      return
    }
    if (rec.author !== actor && !(await this.access.canManage(s, actor))) {
      if (!canRead) throw new NotFoundError()
      throw new SpaceAccessError('only the author or a manager may delete')
    }
    await this.pool.query('delete from gate.space_record where uri = $1', [recordUri])
  }

  async putBlob(spaceUri: string, author: Did, bytes: Buffer, mime: string): Promise<{ id: string; uri: string }> {
    const s = await this.load(spaceUri)
    if (!s || !(await this.access.canWrite(s, author))) throw new NotFoundError()
    const id = createHash('sha256').update(bytes).digest('hex')
    await this.storage.put(id, bytes)
    await this.pool.query(
      `insert into gate.space_blob (id, space_uri, author, mime, size) values ($1, $2, $3, $4, $5)
       on conflict (id, space_uri) do nothing`,
      [id, spaceUri, author, mime, bytes.length],
    )
    return { id, uri: `${spaceUri}/${author}/blob/${id}` }
  }

  async getBlobUrl(blobId: string, viewer: Did | null): Promise<string | null> {
    const r = await this.pool.query<{ space_uri: string; author: string }>('select space_uri, author from gate.space_blob where id = $1', [blobId])
    if (r.rows.length === 0) return null
    for (const b of r.rows) {
      if (b.author === viewer) return this.sign(blobId, viewer)
      const s = await this.load(b.space_uri)
      if (s && (await this.access.canRead(s, viewer))) return this.sign(blobId, viewer)
    }
    return null
  }

  /** Ops/serving helper: the blob's mime, without an access check (the signed URL is the check). */
  async blobMeta(id: string): Promise<{ mime: string; size: number } | null> {
    const r = await this.pool.query<{ mime: string; size: number }>('select mime, size from gate.space_blob where id = $1 limit 1', [id])
    return r.rows[0] ?? null
  }
}
