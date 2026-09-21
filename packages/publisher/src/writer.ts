/**
 * Repo writers. One narrow interface (build, validate, upload blob, CAS write) so the
 * publisher can later be a Rust service (architecture §19.1). Two implementations:
 * app-password sessions (Door B) and OAuth sessions (Door A, an `Agent` supplied by
 * `@atproto/oauth-client-node`).
 */
import { AtpAgent, type Agent } from '@atproto/api'

export interface BlobRefJson {
  $type: 'blob'
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface RepoWriter {
  did: string
  uploadBlob(bytes: Uint8Array, mime: string): Promise<BlobRefJson>
  putRecord(collection: string, rkey: string, record: unknown, swapRecord?: string | null): Promise<{ uri: string; cid: string }>
  deleteRecord(collection: string, rkey: string): Promise<void>
  getRecord(collection: string, rkey: string): Promise<{ uri: string; cid?: string; value: Record<string, unknown> } | null>
  listRecords(collection: string, cursor?: string, limit?: number): Promise<{ records: Array<{ uri: string; cid: string; value: Record<string, unknown> }>; cursor?: string }>
}

export class CasError extends Error {
  constructor() {
    super('compare-and-swap failed: the record changed underneath us')
    this.name = 'CasError'
  }
}

/** The PDS's write budget (5,000 points an hour by default) is exhausted; stop and resume later. */
export class WriterRateLimitError extends Error {
  constructor() {
    super('the PDS asked us to slow down')
    this.name = 'WriterRateLimitError'
  }
}

export class WriterAuthError extends Error {
  constructor(message = 'the session was rejected') {
    super(message)
    this.name = 'WriterAuthError'
  }
}

function toJsonBlob(ref: unknown): BlobRefJson {
  const r = ref as { toJSON?: () => unknown; ref?: unknown; mimeType?: string; size?: number }
  const j = (typeof r.toJSON === 'function' ? r.toJSON() : r) as BlobRefJson
  return j
}

function isCas(err: unknown): boolean {
  const e = err as { error?: string; message?: string; status?: number }
  return e?.error === 'InvalidSwap' || /swap/i.test(e?.message ?? '')
}

function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; error?: string }
  return e?.status === 429 || e?.error === 'RateLimitExceeded'
}

function isAuth(err: unknown): boolean {
  const e = err as { error?: string; status?: number }
  return e?.status === 401 || e?.error === 'AuthenticationRequired' || e?.error === 'ExpiredToken' || e?.error === 'InvalidToken' || e?.error === 'AuthMissing'
}

/** Wraps any `Agent` (app-password `AtpAgent` or an OAuth session agent). */
export class AgentWriter implements RepoWriter {
  constructor(
    readonly did: string,
    private readonly agent: Agent,
  ) {}

  async uploadBlob(bytes: Uint8Array, mime: string): Promise<BlobRefJson> {
    try {
      const res = await this.agent.com.atproto.repo.uploadBlob(bytes, { encoding: mime })
      return toJsonBlob(res.data.blob)
    } catch (err) {
      if (isRateLimit(err)) throw new WriterRateLimitError()
      if (isAuth(err)) throw new WriterAuthError()
      throw err
    }
  }

  async putRecord(collection: string, rkey: string, record: unknown, swapRecord?: string | null): Promise<{ uri: string; cid: string }> {
    try {
      const res = await this.agent.com.atproto.repo.putRecord({
        repo: this.did,
        collection,
        rkey,
        record: record as Record<string, unknown>,
        // Never `validate: true`: the PDS does not bundle this lexicon (architecture §6).
        validate: false,
        ...(swapRecord === undefined ? {} : { swapRecord }),
      })
      return { uri: res.data.uri, cid: res.data.cid }
    } catch (err) {
      if (isCas(err)) throw new CasError()
      if (isRateLimit(err)) throw new WriterRateLimitError()
      if (isAuth(err)) throw new WriterAuthError()
      throw err
    }
  }

  async deleteRecord(collection: string, rkey: string): Promise<void> {
    try {
      await this.agent.com.atproto.repo.deleteRecord({ repo: this.did, collection, rkey })
    } catch (err) {
      if (isRateLimit(err)) throw new WriterRateLimitError()
      if (isAuth(err)) throw new WriterAuthError()
      throw err
    }
  }

  async getRecord(collection: string, rkey: string): Promise<{ uri: string; cid?: string; value: Record<string, unknown> } | null> {
    try {
      const res = await this.agent.com.atproto.repo.getRecord({ repo: this.did, collection, rkey })
      return { uri: res.data.uri, cid: res.data.cid, value: res.data.value as Record<string, unknown> }
    } catch (err) {
      const e = err as { error?: string; status?: number }
      if (e?.error === 'RecordNotFound' || e?.status === 400 || e?.status === 404) return null
      throw err
    }
  }

  async listRecords(collection: string, cursor?: string, limit = 100): Promise<{ records: Array<{ uri: string; cid: string; value: Record<string, unknown> }>; cursor?: string }> {
    const res = await this.agent.com.atproto.repo.listRecords({ repo: this.did, collection, limit, cursor })
    return { records: res.data.records as Array<{ uri: string; cid: string; value: Record<string, unknown> }>, cursor: res.data.cursor }
  }
}

/** Sessions from an app password are cheap; create one per run and cache it briefly. */
const sessionCache = new Map<string, { agent: AtpAgent; at: number }>()
const SESSION_TTL_MS = 30 * 60_000

export async function appPasswordWriter(pdsUrl: string, did: string, identifier: string, appPassword: string): Promise<RepoWriter> {
  const key = `${pdsUrl}|${did}`
  const hit = sessionCache.get(key)
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return new AgentWriter(did, hit.agent)
  const agent = new AtpAgent({ service: pdsUrl })
  try {
    await agent.login({ identifier, password: appPassword })
  } catch (err) {
    throw new WriterAuthError(err instanceof Error ? err.message : 'login failed')
  }
  sessionCache.set(key, { agent, at: Date.now() })
  return new AgentWriter(did, agent)
}

export function forgetSession(pdsUrl: string, did: string): void {
  sessionCache.delete(`${pdsUrl}|${did}`)
}

/** Resolve a DID's PDS endpoint from its DID document (plc or web). */
export async function resolvePdsEndpoint(did: string, plcUrl = 'https://plc.directory'): Promise<string | null> {
  let doc: { service?: Array<{ id: string; type: string; serviceEndpoint: string }> } | undefined
  if (did.startsWith('did:plc:')) {
    const res = await fetch(`${plcUrl.replace(/\/$/, '')}/${did}`)
    if (!res.ok) return null
    doc = (await res.json()) as typeof doc
  } else if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length).replace(/:/g, '/')
    const res = await fetch(`https://${host}/.well-known/did.json`)
    if (!res.ok) return null
    doc = (await res.json()) as typeof doc
  }
  const svc = doc?.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer')
  return svc?.serviceEndpoint ?? null
}
