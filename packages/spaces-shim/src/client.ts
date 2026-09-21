/**
 * `SpaceStore` over the Gate's HTTP API, plus the Gate-only calls (invites, access
 * requests, audit). Service-to-service inside the box: authenticated by the shared
 * service secret, with the acting/viewing DID in a header. This is the one place
 * global `fetch` is used on purpose — the Gate's URL is operator configuration, never
 * user input.
 */
import {
  NotFoundError,
  SpaceAccessError,
  type CreateSpaceInput,
  type Did,
  type Space,
  type SpaceMember,
  type SpaceRecord,
  type SpaceStore,
} from './types.js'

export interface GateClientOptions {
  baseUrl: string
  serviceSecret: string
  /** The default viewer for calls that take none (`getSpace`). */
  viewer?: Did | null
  fetch?: typeof fetch
}

export type InviteKind = 'join' | 'read' | 'read-join'

export interface InviteSummary {
  id: string
  kind: InviteKind
  role: number
  expiresAt: string
  maxUses: number | null
  uses: number
  createdBy: Did
  createdAt: string
  revokedAt: string | null
}

export interface AccessRequest {
  id: string
  spaceUri: string
  did: Did
  state: 'pending' | 'approved' | 'denied'
  requestedAt: string
  decidedAt: string | null
}

export interface AuditEntry {
  id: number
  at: string
  spaceUri: string
  actor: Did | null
  action: string
  subject: string | null
  detail: Record<string, unknown>
}

export class GateHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'GateHttpError'
  }
}

const enc = encodeURIComponent

export class GateClient {
  private readonly f: typeof fetch
  constructor(readonly opts: GateClientOptions) {
    this.f = opts.fetch ?? fetch
  }

  as(viewer: Did | null): GateClient {
    return new GateClient({ ...this.opts, viewer })
  }

  protected async call<T>(method: string, path: string, body?: unknown, viewer: Did | null | undefined = this.opts.viewer, raw?: { bytes: Buffer; mime: string }): Promise<T> {
    const headers: Record<string, string> = { 'x-gate-service': this.opts.serviceSecret }
    if (viewer) headers['x-viewer-did'] = viewer
    let payload: BodyInit | undefined
    if (raw) {
      headers['content-type'] = raw.mime
      payload = new Uint8Array(raw.bytes)
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await this.f(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, { method, headers, body: payload })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    if (res.status === 404) throw new NotFoundError()
    if (res.status === 403) throw new SpaceAccessError(typeof json.message === 'string' ? json.message : 'Forbidden')
    if (!res.ok) throw new GateHttpError(res.status, typeof json.error === 'string' ? json.error : `HTTP${res.status}`)
    return json as T
  }

  /* invites and requests */

  createInvite(spaceUri: string, actor: Did, input: { kind: InviteKind; expiresInHours?: number; maxUses?: number | null; role?: number }): Promise<{ id: string; token: string; expiresAt: string }> {
    return this.call('POST', `/spaces/${enc(spaceUri)}/invites`, input, actor)
  }
  listInvites(spaceUri: string, actor: Did): Promise<{ invites: InviteSummary[] }> {
    return this.call('GET', `/spaces/${enc(spaceUri)}/invites`, undefined, actor)
  }
  revokeInvite(id: string, actor: Did): Promise<void> {
    return this.call('DELETE', `/invites/${enc(id)}`, undefined, actor)
  }
  redeemInvite(token: string, viewer: Did): Promise<{ spaceUri: string; kind: InviteKind; role: number | null }> {
    return this.call('POST', '/invites/redeem', { token }, viewer)
  }
  share(spaceUri: string, actor: Did, did: Did): Promise<void> {
    return this.call('PUT', `/spaces/${enc(spaceUri)}/shares/${enc(did)}`, undefined, actor)
  }
  unshare(spaceUri: string, actor: Did, did: Did): Promise<void> {
    return this.call('DELETE', `/spaces/${enc(spaceUri)}/shares/${enc(did)}`, undefined, actor)
  }
  requestAccess(spaceUri: string, viewer: Did): Promise<{ id: string; state: AccessRequest['state'] }> {
    return this.call('POST', `/spaces/${enc(spaceUri)}/requests`, {}, viewer)
  }
  listRequests(spaceUri: string, actor: Did): Promise<{ requests: AccessRequest[] }> {
    return this.call('GET', `/spaces/${enc(spaceUri)}/requests`, undefined, actor)
  }
  decideRequest(id: string, actor: Did, action: 'approve' | 'deny'): Promise<{ id: string; state: AccessRequest['state'] }> {
    return this.call('POST', `/requests/${enc(id)}`, { action }, actor)
  }
  audit(spaceUri: string, actor: Did): Promise<{ entries: AuditEntry[] }> {
    return this.call('GET', `/audit?space=${enc(spaceUri)}`, undefined, actor)
  }
  health(): Promise<{ status: string }> {
    return this.call('GET', '/health', undefined, null)
  }
}

export class RemoteSpaceStore extends GateClient implements SpaceStore {
  override as(viewer: Did | null): RemoteSpaceStore {
    return new RemoteSpaceStore({ ...this.opts, viewer })
  }

  createSpace(input: CreateSpaceInput): Promise<Space> {
    return this.call('POST', '/spaces', input, input.authority)
  }
  getSpace(uri: string, viewer: Did | null = this.opts.viewer ?? null): Promise<Space | null> {
    return this.call<Space>('GET', `/spaces/${enc(uri)}`, undefined, viewer).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)))
  }
  deleteSpace(uri: string, actor: Did): Promise<void> {
    return this.call('DELETE', `/spaces/${enc(uri)}`, undefined, actor)
  }
  putMember(spaceUri: string, actor: Did, member: Did, role: number): Promise<void> {
    return this.call('PUT', `/spaces/${enc(spaceUri)}/members/${enc(member)}`, { role }, actor)
  }
  removeMember(spaceUri: string, actor: Did, member: Did): Promise<void> {
    return this.call('DELETE', `/spaces/${enc(spaceUri)}/members/${enc(member)}`, undefined, actor)
  }
  async listMembers(spaceUri: string, viewer: Did): Promise<SpaceMember[]> {
    const r = await this.call<{ members: SpaceMember[] }>('GET', `/spaces/${enc(spaceUri)}/members`, undefined, viewer)
    return r.members
  }
  putRecord<T>(spaceUri: string, author: Did, collection: string, value: T, rkey?: string): Promise<SpaceRecord<T>> {
    return this.call('POST', `/spaces/${enc(spaceUri)}/records`, { collection, value, rkey }, author)
  }
  getRecord<T = unknown>(uri: string, viewer: Did | null): Promise<SpaceRecord<T> | null> {
    return this.call<SpaceRecord<T>>('GET', `/records/${enc(uri)}`, undefined, viewer).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)))
  }
  async listRecords<T = unknown>(spaceUri: string, viewer: Did | null, collection?: string): Promise<SpaceRecord<T>[]> {
    const q = collection ? `?collection=${enc(collection)}` : ''
    const r = await this.call<{ records: SpaceRecord<T>[] }>('GET', `/spaces/${enc(spaceUri)}/records${q}`, undefined, viewer)
    return r.records
  }
  deleteRecord(spaceUri: string, actor: Did, recordUri: string): Promise<void> {
    return this.call('DELETE', `/records/${enc(recordUri)}?space=${enc(spaceUri)}`, undefined, actor)
  }
  putBlob(spaceUri: string, author: Did, bytes: Buffer, mime: string): Promise<{ id: string; uri: string }> {
    return this.call('POST', `/spaces/${enc(spaceUri)}/blobs`, undefined, author, { bytes, mime })
  }
  async getBlobUrl(blobId: string, viewer: Did | null): Promise<string | null> {
    return this.call<{ url: string }>('GET', `/blobs/${enc(blobId)}/url`, undefined, viewer)
      .then((r) => r.url)
      .catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)))
  }
}
