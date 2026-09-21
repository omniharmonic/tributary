/**
 * `SpaceStore` in memory: tests, and the reference the Postgres backend must match
 * decision for decision (both run `test/store-suite.ts`).
 */
import { createHash, randomBytes } from 'node:crypto'
import { Access } from './access.js'
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

export function tid(): string {
  // A TID-shaped key: time-ordered, unique enough for rkeys.
  const t = BigInt(Date.now()) * 1000n + BigInt(randomBytes(2).readUInt16BE(0) % 1000)
  const B32 = '234567abcdefghijklmnopqrstuvwxyz'
  let n = t
  let s = ''
  for (let i = 0; i < 11; i++) {
    s = B32[Number(n & 31n)] + s
    n >>= 5n
  }
  return `${s}${B32[randomBytes(1)[0]! & 31]}${B32[randomBytes(1)[0]! & 31]}`
}

export class MemoryBlobStorage implements BlobStorage {
  private bytes = new Map<string, Buffer>()
  async put(id: string, b: Buffer): Promise<void> {
    this.bytes.set(id, b)
  }
  async get(id: string): Promise<Buffer | null> {
    return this.bytes.get(id) ?? null
  }
  async delete(id: string): Promise<void> {
    this.bytes.delete(id)
  }
}

export class MemorySpaceStore implements SpaceStore {
  private spaces = new Map<string, Space>()
  private members = new Map<string, Map<Did, number>>()
  private records = new Map<string, Map<string, SpaceRecord>>()
  private blobs = new Map<string, { id: string; uri: string; spaceUri: string; author: Did; mime: string; size: number }>()
  private readonly access: Access
  private readonly storage: BlobStorage
  private readonly sign: (id: string, viewer: Did | null) => string

  constructor(private readonly opts: StoreOptions = {}) {
    this.access = new Access({ roleOf: async (uri, did) => this.members.get(uri)?.get(did) ?? null }, opts)
    this.storage = opts.blobs ?? new MemoryBlobStorage()
    this.sign = opts.signBlobUrl ?? ((id, viewer) => `memory://blobs/${id}?viewer=${viewer ?? 'anon'}`)
  }

  private require(uri: string): Space {
    const s = this.spaces.get(uri)
    if (!s) throw new NotFoundError()
    return s
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    if (!parseSpaceUri(`at://${input.authority}/${input.spaceType}/${input.skey}`)) throw new SpaceAccessError('invalid space address')
    const uri = `at://${input.authority}/${input.spaceType}/${input.skey}`
    const existing = this.spaces.get(uri)
    const space: Space = {
      uri,
      authority: input.authority,
      spaceType: input.spaceType,
      skey: input.skey,
      readPolicy: input.readPolicy,
      writePolicy: input.writePolicy,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      credentialTail: 0,
    }
    this.spaces.set(uri, space)
    if (!existing) {
      this.members.set(uri, new Map())
      this.records.set(uri, new Map())
    }
    return space
  }

  async getSpace(uri: string, viewer: Did | null = null): Promise<Space | null> {
    const s = this.spaces.get(uri)
    if (!s) return null
    return (await this.access.canRead(s, viewer)) ? s : null
  }

  async deleteSpace(uri: string, actor: Did): Promise<void> {
    const s = this.spaces.get(uri)
    if (!s || !(await this.access.canRead(s, actor))) throw new NotFoundError()
    if (!this.access.isAuthority(s, actor)) throw new SpaceAccessError('only the authority deletes a space')
    this.spaces.delete(uri)
    this.members.delete(uri)
    this.records.delete(uri)
    for (const [id, b] of this.blobs) {
      if (b.spaceUri === uri) {
        this.blobs.delete(id)
        await this.storage.delete(id)
      }
    }
  }

  async putMember(spaceUri: string, actor: Did, member: Did, role: number): Promise<void> {
    const s = this.spaces.get(spaceUri)
    if (!s || !(await this.access.canRead(s, actor))) throw new NotFoundError()
    if (!(await this.access.canManage(s, actor))) throw new SpaceAccessError('only the authority manages membership')
    this.members.get(spaceUri)!.set(member, role)
  }

  async removeMember(spaceUri: string, actor: Did, member: Did): Promise<void> {
    const s = this.spaces.get(spaceUri)
    if (!s || !(await this.access.canRead(s, actor))) throw new NotFoundError()
    if (!(await this.access.canManage(s, actor))) throw new SpaceAccessError('only the authority manages membership')
    this.members.get(spaceUri)!.delete(member)
  }

  async listMembers(spaceUri: string, viewer: Did): Promise<SpaceMember[]> {
    const s = this.spaces.get(spaceUri)
    if (!s || !(await this.access.canRead(s, viewer))) throw new NotFoundError()
    return [...this.members.get(spaceUri)!.entries()].map(([did, role]) => ({ did, role }))
  }

  async putRecord<T>(spaceUri: string, author: Did, collection: string, value: T, rkey = tid()): Promise<SpaceRecord<T>> {
    const s = this.spaces.get(spaceUri)
    if (!s || !(await this.access.canRead(s, author))) {
      // A non-reader who is nevertheless a writer (write-only policies) still gets in.
      if (!s || !(await this.access.canWrite(s, author))) throw new NotFoundError()
    }
    if (!(await this.access.canWrite(s, author))) throw new SpaceAccessError('not permitted to write')
    const uri = `${spaceUri}/${author}/${collection}/${rkey}`
    const rows = this.records.get(spaceUri)!
    const prev = rows.get(uri)
    if (prev && prev.author !== author) throw new SpaceAccessError('record belongs to another author')
    const now = new Date().toISOString()
    const rec: SpaceRecord<T> = { uri, spaceUri, author, collection, rkey, value, createdAt: prev?.createdAt ?? now, updatedAt: now }
    rows.set(uri, rec as SpaceRecord)
    return rec
  }

  async getRecord<T = unknown>(uri: string, viewer: Did | null): Promise<SpaceRecord<T> | null> {
    const parsed = parseRecordUri(uri)
    if (!parsed) return null
    const s = this.spaces.get(parsed.spaceUri)
    if (!s) return null
    const rec = this.records.get(parsed.spaceUri)?.get(uri) as SpaceRecord<T> | undefined
    if (!rec) return null
    if (rec.author === viewer) return rec
    return (await this.access.canRead(s, viewer, rec.author)) ? rec : null
  }

  async listRecords<T = unknown>(spaceUri: string, viewer: Did | null, collection?: string): Promise<SpaceRecord<T>[]> {
    const s = this.spaces.get(spaceUri)
    if (!s || !(await this.access.canRead(s, viewer))) throw new NotFoundError()
    return [...this.records.get(spaceUri)!.values()].filter((r) => !collection || r.collection === collection) as SpaceRecord<T>[]
  }

  async deleteRecord(spaceUri: string, actor: Did, recordUri: string): Promise<void> {
    const s = this.spaces.get(spaceUri)
    if (!s) throw new NotFoundError()
    const rows = this.records.get(spaceUri)!
    const rec = rows.get(recordUri)
    const canRead = await this.access.canRead(s, actor)
    if (!rec) {
      if (!canRead) throw new NotFoundError()
      return
    }
    if (rec.author !== actor && !(await this.access.canManage(s, actor))) {
      if (!canRead) throw new NotFoundError()
      throw new SpaceAccessError('only the author or a manager may delete')
    }
    rows.delete(recordUri)
  }

  async putBlob(spaceUri: string, author: Did, bytes: Buffer, mime: string): Promise<{ id: string; uri: string }> {
    const s = this.spaces.get(spaceUri)
    if (!s || !(await this.access.canWrite(s, author))) throw new NotFoundError()
    const id = createHash('sha256').update(bytes).digest('hex')
    await this.storage.put(id, bytes)
    const uri = `${spaceUri}/${author}/blob/${id}`
    this.blobs.set(id, { id, uri, spaceUri, author, mime, size: bytes.length })
    return { id, uri }
  }

  async getBlobUrl(blobId: string, viewer: Did | null): Promise<string | null> {
    const b = this.blobs.get(blobId)
    if (!b) return null
    const s = this.spaces.get(b.spaceUri)
    if (!s) return null
    if (b.author !== viewer && !(await this.access.canRead(s, viewer))) return null
    return this.sign(blobId, viewer)
  }

  /** Test/ops helper: blob metadata without an access check. */
  blobMeta(id: string) {
    return this.blobs.get(id) ?? null
  }
}
