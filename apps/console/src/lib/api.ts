/**
 * The one typed client for docs/api.md. Every state-changing call carries
 * `X-Requested-With: tributary` (CSRF) and credentials. `VITE_MOCK_API=1` swaps in
 * `mock.ts` so the whole app runs without a backend.
 */
import { ApiError, isApiErrorBody } from './errors'
import type {
  ApiKey,
  AudienceInfo,
  Confirmation,
  DetectMatch,
  DetectResponse,
  EventOverride,
  HandleCheck,
  Inbound,
  JoinResult,
  LedgerEvent,
  OrgRole,
  OrgRoleName,
  Me,
  Preview,
  PublicConfig,
  PublicEvent,
  PublicHost,
  RawEvent,
  Rule,
  SignupResponse,
  Source,
  SourceDetail,
  Visibility,
  Audience,
} from './types'

export const MOCK = import.meta.env.VITE_MOCK_API === '1'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

async function call<T>(method: Method, path: string, body?: unknown, init: { form?: FormData; accept?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: init.accept ?? 'application/json' }
  if (method !== 'GET') headers['x-requested-with'] = 'tributary'
  let payload: BodyInit | undefined
  if (init.form) payload = init.form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError('Network', 'You seem to be offline.', 0)
  }
  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  if (!res.ok) {
    if (isApiErrorBody(json)) throw new ApiError(json.error, json.message, res.status, json)
    throw new ApiError(res.status === 401 ? 'Unauthorized' : res.status === 404 ? 'NotFound' : 'Internal', `Request failed (${res.status})`, res.status, json)
  }
  return json as T
}

export interface Api {
  publicConfig(): Promise<PublicConfig>
  publicEvents(params: { region: string; from?: string; to?: string; category?: string; q?: string; cursor?: string }): Promise<{ events: PublicEvent[]; cursor?: string | null }>
  publicEvent(did: string, rkey: string): Promise<PublicEvent>
  requestPlace(did: string, rkey: string): Promise<{ state: 'pending' | 'approved' }>
  publicHost(handle: string): Promise<{ host: PublicHost; events: PublicEvent[] }>

  detect(input: string, file?: File): Promise<DetectResponse>
  preview(match: DetectMatch, file?: File): Promise<Preview>
  getPreview(previewId: string): Promise<Preview>

  signup(body: { email: string; displayName: string; handle: string; previewId?: string; visibility?: Visibility; newsletter?: boolean }): Promise<SignupResponse>
  checkHandle(label: string): Promise<HandleCheck>
  login(email: string): Promise<{ status: 'check-your-email'; verifyUrl?: string }>
  verify(token: string): Promise<{ ok: true; redirect?: string }>
  oauthStart(body: { handle: string; previewId?: string; visibility?: Visibility }): Promise<{ redirectUrl: string }>
  me(): Promise<Me>
  logout(): Promise<void>
  takeControl(): Promise<{ status: string }>
  revokeSync(): Promise<{ status: string }>
  deleteEverything(): Promise<void>
  exportUrl(): string

  sources(): Promise<{ sources: Source[] }>
  addSource(body: { match?: DetectMatch; previewId?: string; defaultVisibility: Visibility; audience?: Audience }): Promise<Source>
  source(id: string): Promise<SourceDetail>
  patchSource(id: string, body: { defaultVisibility?: Visibility; audience?: Audience; paused?: boolean; interval?: number; tz?: string }): Promise<Source | { pendingConfirmation: number }>
  syncSource(id: string): Promise<{ jobId: string }>
  removeSource(id: string): Promise<{ removed: number }>
  rules(id: string): Promise<{ rules: Rule[] }>
  putRules(id: string, rules: Rule[]): Promise<{ rules: Rule[]; pendingConfirmation?: number }>

  events(params: { sourceId?: string; state?: string; from?: string; to?: string; cursor?: string; limit?: number }): Promise<{ events: LedgerEvent[]; cursor?: string | null }>
  patchEvent(id: string, body: EventOverride): Promise<LedgerEvent | { pendingConfirmation: string }>
  republish(id: string): Promise<void>

  confirmations(): Promise<{ items: Confirmation[] }>
  confirmation(id: string): Promise<Confirmation>
  resolveConfirmation(id: string, action: 'confirm' | 'reject', edits?: Record<string, Partial<RawEvent>>): Promise<void>

  keys(): Promise<{ keys: ApiKey[] }>
  createKey(name: string): Promise<ApiKey>
  deleteKey(id: string): Promise<void>
  inbound(): Promise<Inbound>
  rotateInbound(): Promise<Inbound>

  audience(eventId: string): Promise<AudienceInfo>
  createInvite(eventId: string, body: { kind: 'join' | 'read' | 'read-join'; expiresInHours: number; maxUses: number | null }): Promise<{ id: string; url: string }>
  deleteInvite(eventId: string, inviteId: string): Promise<void>
  invitePeople(eventId: string, body: { handles: string[]; emails: string[] }): Promise<{ resolved: Array<{ handle: string; did: string }>; pendingEmails: string[] }>
  decideRequest(eventId: string, requestId: string, action: 'approve' | 'deny'): Promise<void>

  /** Redeem a join link as the signed-in viewer. */
  redeemInvite(token: string): Promise<JoinResult>

  roles(): Promise<{ roles: OrgRole[] }>
  addRole(body: { handle: string; role: OrgRoleName }): Promise<void>
  removeRole(did: string): Promise<void>
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const realApi: Api = {
  publicConfig: () => call('GET', '/api/public/config'),
  publicEvents: (params) => call('GET', `/api/public/events${qs(params)}`),
  publicEvent: (did, rkey) => call('GET', `/api/public/events/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`),
  requestPlace: (did, rkey) => call('POST', `/api/public/events/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}/request`, {}),
  publicHost: (handle) => call('GET', `/api/public/hosts/${encodeURIComponent(handle)}`),

  detect: (input, file) => {
    if (file) {
      const form = new FormData()
      form.set('file', file)
      if (input) form.set('input', input)
      return call('POST', '/api/detect', undefined, { form })
    }
    return call('POST', '/api/detect', { input })
  },
  preview: (match, file) => {
    if (file) {
      const form = new FormData()
      form.set('file', file)
      form.set('match', JSON.stringify(match))
      return call('POST', '/api/preview', undefined, { form })
    }
    return call('POST', '/api/preview', { match })
  },
  getPreview: (id) => call('GET', `/api/preview/${encodeURIComponent(id)}`),

  signup: (body) => call('POST', '/api/auth/signup', body),
  checkHandle: (label) => call('GET', `/api/auth/handle/check${qs({ label })}`),
  login: (email) => call('POST', '/api/auth/login', { email }),
  verify: (token) => call('GET', `/api/auth/verify${qs({ token })}`),
  oauthStart: (body) => call('POST', '/api/auth/oauth/start', body),
  me: () => call('GET', '/api/me'),
  logout: () => call('POST', '/api/auth/logout', {}),
  takeControl: () => call('POST', '/api/me/take-control', {}),
  revokeSync: () => call('POST', '/api/me/revoke-sync', {}),
  deleteEverything: () => call('POST', '/api/me/delete', { confirm: 'delete everything' }),
  exportUrl: () => '/api/me/export',

  sources: () => call('GET', '/api/sources'),
  addSource: (body) => call('POST', '/api/sources', body),
  source: (id) => call('GET', `/api/sources/${id}`),
  patchSource: (id, body) => call('PATCH', `/api/sources/${id}`, body),
  syncSource: (id) => call('POST', `/api/sources/${id}/sync`, {}),
  removeSource: (id) => call('DELETE', `/api/sources/${id}`),
  rules: (id) => call('GET', `/api/sources/${id}/rules`),
  putRules: (id, rules) => call('PUT', `/api/sources/${id}/rules`, { rules }),

  events: (params) => call('GET', `/api/events${qs(params)}`),
  patchEvent: (id, body) => call('PATCH', `/api/events/${id}`, body),
  republish: (id) => call('POST', `/api/events/${id}/republish`, {}),

  confirmations: () => call('GET', '/api/confirmations'),
  confirmation: (id) => call('GET', `/api/confirmations/${id}`),
  resolveConfirmation: (id, action, edits) => call('POST', `/api/confirmations/${id}`, { action, edits }),

  keys: () => call('GET', '/api/me/keys'),
  createKey: (name) => call('POST', '/api/me/keys', { name }),
  deleteKey: (id) => call('DELETE', `/api/me/keys/${id}`),
  inbound: () => call('GET', '/api/me/inbound'),
  rotateInbound: () => call('POST', '/api/me/inbound/rotate', {}),

  audience: (eventId) => call('GET', `/api/events/${eventId}/audience`),
  createInvite: (eventId, body) => call('POST', `/api/events/${eventId}/invites`, body),
  deleteInvite: (eventId, inviteId) => call('DELETE', `/api/events/${eventId}/invites/${inviteId}`),
  invitePeople: (eventId, body) => call('POST', `/api/events/${eventId}/invite-people`, body),
  decideRequest: (eventId, requestId, action) => call('POST', `/api/events/${eventId}/requests/${requestId}`, { action }),

  redeemInvite: (token) => call('POST', `/api/join/${encodeURIComponent(token)}`, {}),

  roles: () => call('GET', '/api/me/roles'),
  addRole: (body) => call('POST', '/api/me/roles', body),
  removeRole: (did) => call('DELETE', `/api/me/roles/${encodeURIComponent(did)}`),
}

let api: Api = realApi
if (MOCK) {
  const { mockApi } = await import('./mock')
  api = mockApi
}
export { api, call }
