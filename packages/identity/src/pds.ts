/**
 * The Directory PDS from two angles (lifted from Free School's `lib/pds.ts`):
 *  1. ADMIN — invite codes, account creation, admin password rotation, takedowns.
 *  2. SESSION — an app-password `AtpAgent` per host.
 *
 * Door B, least privilege (architecture §8.2): create the account with a random main
 * password, immediately mint an app password named `tributary-sync` from that session,
 * store only the app password, discard the main one. A compromise of Tributary can
 * write records but cannot take an identity away from its host.
 */
import { AtpAgent } from '@atproto/api'

export class PdsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'PdsError'
  }
}

export interface PdsConfig {
  /** The PDS as the world sees it (through Caddy). */
  url: string
  adminPassword: string
}

export const SYNC_APP_PASSWORD_NAME = 'tributary-sync'

function adminAuth(c: PdsConfig): string {
  if (!c.adminPassword) throw new Error('PDS admin password is not set')
  return `Basic ${Buffer.from(`admin:${c.adminPassword}`).toString('base64')}`
}

async function xrpc<T>(c: PdsConfig, method: string, body: unknown, opts: { admin?: boolean; get?: boolean } = {}): Promise<T> {
  const base = c.url.replace(/\/$/, '')
  let url = `${base}/xrpc/${method}`
  const init: RequestInit = { method: opts.get ? 'GET' : 'POST', headers: {} }
  const headers = init.headers as Record<string, string>
  if (opts.admin) headers.authorization = adminAuth(c)
  if (opts.get) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries((body ?? {}) as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const x of v) q.append(k, String(x))
      else if (v !== undefined) q.set(k, String(v))
    }
    url += `?${q}`
  } else {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body ?? {})
  }
  const res = await fetch(url, init)
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = { message: text.slice(0, 200) }
  }
  if (!res.ok) {
    throw new PdsError(typeof json.message === 'string' ? json.message : `PDS ${method} failed`, res.status, typeof json.error === 'string' ? json.error : undefined)
  }
  return json as T
}

export const pdsAdmin = {
  async createInviteCode(c: PdsConfig, useCount = 1): Promise<string> {
    const out = await xrpc<{ code: string }>(c, 'com.atproto.server.createInviteCode', { useCount }, { admin: true })
    return out.code
  },
  async createAccount(c: PdsConfig, input: { email: string; handle: string; password: string; inviteCode: string }): Promise<{ did: string; handle: string; accessJwt: string; refreshJwt: string }> {
    return xrpc(c, 'com.atproto.server.createAccount', input)
  },
  async updateAccountPassword(c: PdsConfig, did: string, password: string): Promise<void> {
    await xrpc(c, 'com.atproto.admin.updateAccountPassword', { did, password }, { admin: true })
  },
  async deleteAccount(c: PdsConfig, did: string): Promise<void> {
    await xrpc(c, 'com.atproto.admin.deleteAccount', { did }, { admin: true })
  },
  async takedown(c: PdsConfig, subject: { did: string } | { uri: string; cid: string }, ref = 'tributary-steward'): Promise<void> {
    const body =
      'did' in subject
        ? { subject: { $type: 'com.atproto.admin.defs#repoRef', did: subject.did }, takedown: { applied: true, ref } }
        : { subject: { $type: 'com.atproto.repo.strongRef', uri: subject.uri, cid: subject.cid }, takedown: { applied: true, ref } }
    await xrpc(c, 'com.atproto.admin.updateSubjectStatus', body, { admin: true })
  },
  async getAccountInfo(c: PdsConfig, did: string): Promise<{ did: string; handle: string; email?: string; emailConfirmedAt?: string } | null> {
    try {
      return await xrpc(c, 'com.atproto.admin.getAccountInfo', { did }, { admin: true, get: true })
    } catch (err) {
      if (err instanceof PdsError && err.status === 400) return null
      throw err
    }
  },
}

/** `null` means "no such handle", the only answer a caller may read as "available". */
export async function resolveHandle(handle: string, pdsUrl: string): Promise<string | null> {
  const url = `${pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  const res = await fetch(url)
  if (res.ok) {
    const json = (await res.json()) as { did?: string }
    return json.did ?? null
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (res.status === 400 && (json.error === 'HandleNotFound' || (json.error === 'InvalidRequest' && json.message === 'Unable to resolve handle'))) return null
  throw new PdsError(json.message ?? 'resolveHandle failed', res.status, json.error)
}

/** The PDS's own password reset: the email goes straight to the host. This is the takeover door. */
export async function requestPasswordReset(pdsUrl: string, email: string): Promise<void> {
  await xrpc({ url: pdsUrl, adminPassword: '' }, 'com.atproto.server.requestPasswordReset', { email })
}

export async function loginWithAppPassword(pdsUrl: string, identifier: string, appPassword: string): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: pdsUrl })
  await agent.login({ identifier, password: appPassword })
  return agent
}

/**
 * Provision a custodial account: invite → createAccount with a random password → app
 * password → discard the main password. Returns what Tributary stores (encrypted).
 */
export async function provisionCustodialAccount(
  c: PdsConfig,
  input: { email: string; handle: string; recoveryKey?: string },
  randomPassword: () => string,
): Promise<{ did: string; handle: string; appPassword: string }> {
  const inviteCode = await pdsAdmin.createInviteCode(c, 1)
  const password = randomPassword()
  const created = await pdsAdmin.createAccount(c, { email: input.email, handle: input.handle, password, inviteCode, ...(input.recoveryKey ? { recoveryKey: input.recoveryKey } : {}) } as never)
  const agent = new AtpAgent({ service: c.url })
  await agent.resumeSession({ did: created.did, handle: created.handle, accessJwt: created.accessJwt, refreshJwt: created.refreshJwt, active: true })
  const app = await agent.com.atproto.server.createAppPassword({ name: SYNC_APP_PASSWORD_NAME })
  return { did: created.did, handle: created.handle, appPassword: app.data.password }
}

/** Revoke our sync credential from the host's own session (host-initiated) or admin-side by rotating it away. */
export async function revokeSyncAppPassword(agent: AtpAgent): Promise<void> {
  await agent.com.atproto.server.revokeAppPassword({ name: SYNC_APP_PASSWORD_NAME })
}
