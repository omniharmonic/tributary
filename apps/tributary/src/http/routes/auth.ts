/**
 * Identity routes: Door B (magic link), Door A (OAuth), sessions.
 */
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { suggestLabels } from '@tributary/identity'
import { config } from '../../config.js'
import { getDb } from '../../db/index.js'
import { host, inboundAddress } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { newToken } from '@tributary/identity'
import { recordAudit } from '../../lib/audit.js'
import { beginLogin, beginSignup, checkHandle, SignupError, verifyToken, type PendingSignup } from '../../lib/custody.js'
import { getHostByDid, storeOauthSession, unpauseHost } from '../../lib/hosts.js'
import { id } from '../../lib/ids.js'
import { describeError, log } from '../../lib/logging.js'
import { clientMetadata, jwks, OAUTH_SCOPE, oauthClient, OAuthUnavailableError } from '../../lib/oauth.js'
import { isPushPreview, loadPreview } from '../../lib/preview.js'
import { clearCookieHeader, cookieHeader, createSession, destroySession, SESSION_COOKIE } from '../../lib/sessions.js'
import { connectSource } from '../../lib/sources.js'
import { queueExtraction } from './confirmations.js'
import { resolvePdsEndpoint } from '@tributary/publisher'
import { ApiError, body, clientIp, rateLimit, requireHost, str, type Vars } from '../context.js'
import type { HostRow } from '../../lib/hosts.js'
import type { Visibility } from '@tributary/event-model'

export const authRoutes = new Hono<{ Variables: Vars }>()

function mapSignupError(err: unknown): never {
  if (err instanceof SignupError) throw new ApiError(err.status, err.code as never, err.message)
  throw err
}

authRoutes.get('/handle/check', async (c) => {
  const label = (c.req.query('label') ?? '').trim().toLowerCase()
  const r = await checkHandle(label)
  if (r.ok) return c.json({ ok: true })
  const taken = new Set<string>()
  const suggestions: string[] = []
  for (const s of suggestLabels(label, (l) => taken.has(l))) {
    const chk = await checkHandle(s)
    if (chk.ok) suggestions.push(s)
    if (suggestions.length >= 3) break
  }
  return c.json({ ok: false, reason: r.reason, suggestions })
})

authRoutes.post('/signup', async (c) => {
  rateLimit(`signup:${clientIp(c)}`, 10, 3_600_000)
  const b = await body(c)
  const pending: PendingSignup = {
    email: str(b.email, 'email', { max: 200 }),
    displayName: str(b.displayName, 'displayName', { max: 80 }),
    label: str(b.handle, 'handle', { max: 30 }).replace(/\..*$/, ''),
    previewId: str(b.previewId, 'previewId', { optional: true }) || undefined,
    visibility: (str(b.visibility, 'visibility', { optional: true }) || 'public') as Visibility,
    audience: typeof b.audience === 'object' && b.audience ? (b.audience as Record<string, unknown>) : undefined,
    newsletter: b.newsletter === true,
  }
  try {
    const r = await beginSignup(pending)
    return c.json({ did: null, handle: r.handle, status: 'check-your-email', ...(r.verifyUrl ? { verifyUrl: r.verifyUrl } : {}) }, 202)
  } catch (err) {
    mapSignupError(err)
  }
})

authRoutes.post('/login', async (c) => {
  rateLimit(`login:${clientIp(c)}`, 10, 3_600_000)
  const b = await body(c)
  try {
    const r = await beginLogin(str(b.email, 'email', { max: 200 }))
    return c.json({ status: 'check-your-email', ...(r.verifyUrl ? { verifyUrl: r.verifyUrl } : {}) }, 202)
  } catch (err) {
    mapSignupError(err)
  }
})

/** Connect the previewed source right after identity is established. */
export async function connectPreviewed(h: HostRow, previewId: string | undefined, visibility: Visibility | undefined, audience?: Record<string, unknown>): Promise<string | null> {
  if (!previewId) return null
  const p = await loadPreview(previewId)
  if (!p) return null
  const m = p.match as { type: string; platform?: string }
  const summary = p.summary as { needsConfirmation?: boolean; extracted?: never[]; notes?: string[] }
  if (summary.needsConfirmation) {
    // Extracted events wait for the person, never publish on verification (F10).
    if (!summary.extracted?.length) return null
    const pid = await queueExtraction(h.id, summary.extracted, summary.notes ?? [], 'console')
    return `confirm:${pid}`
  }
  const { source } = await connectSource(h, {
    type: m.type as never,
    platform: m.platform ?? '',
    config: p.config,
    defaultVisibility: visibility ?? 'public',
    audience: audience as never,
    tz: p.tz,
    rawEvents: isPushPreview(p) ? (p.rawEvents as never) : undefined,
  })
  return source.id
}

authRoutes.get('/verify', async (c) => {
  const token = c.req.query('token') ?? ''
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json')
  try {
    const r = await verifyToken(token)
    const { cookie, expiresAt } = await createSession(r.host.id)
    c.header('Set-Cookie', cookieHeader(cookie, expiresAt))
    let sourceId: string | null = null
    if (r.pending?.previewId) {
      try {
        sourceId = await connectPreviewed(r.host, r.pending.previewId, r.pending.visibility as Visibility | undefined, r.pending.audience)
      } catch (err) {
        log.warn('could not connect the previewed source after verification', { detail: describeError(err) })
      }
    }
    const redirect = sourceId?.startsWith('confirm:') ? `/confirm/${sourceId.slice('confirm:'.length)}?welcome=${r.created ? '1' : '0'}` : `/dashboard?welcome=${r.created ? '1' : '0'}${sourceId ? `&source=${sourceId}` : ''}`
    if (wantsJson) return c.json({ ok: true, redirect, created: r.created })
    return c.redirect(redirect, 302)
  } catch (err) {
    if (err instanceof SignupError) {
      if (wantsJson) throw new ApiError(err.status, err.code as never, err.message)
      return c.redirect(`/login?error=${encodeURIComponent(err.code)}`, 302)
    }
    throw err
  }
})

authRoutes.post('/logout', async (c) => {
  await destroySession(getCookie(c, SESSION_COOKIE))
  c.header('Set-Cookie', clearCookieHeader())
  return c.json({ ok: true })
})

/* ── Door A ─────────────────────────────────────────────────────────────────── */

authRoutes.post('/oauth/start', async (c) => {
  rateLimit(`oauth:${clientIp(c)}`, 20, 3_600_000)
  const b = await body(c)
  const handle = str(b.handle, 'handle', { max: 253 }).trim().toLowerCase().replace(/^@/, '')
  const previewId = str(b.previewId, 'previewId', { optional: true })
  const visibility = str(b.visibility, 'visibility', { optional: true }) || 'public'
  try {
    const client = await oauthClient()
    const state = JSON.stringify({ previewId, visibility, n: newToken(8) })
    const url = await client.authorize(handle, { scope: OAUTH_SCOPE, state })
    return c.json({ redirectUrl: url.toString() })
  } catch (err) {
    if (err instanceof OAuthUnavailableError) throw new ApiError(503, 'SourceUnsupported', err.message)
    log.warn('oauth authorize failed', { detail: describeError(err) })
    throw new ApiError(400, 'InvalidInput', 'We could not start sign-in with that handle. Check the spelling, or use the email door.')
  }
})

/** Mounted at the root (not /api): the callback URL is part of the client metadata. */
export const oauthRoot = new Hono<{ Variables: Vars }>()

oauthRoot.get('/oauth-client-metadata.json', (c) => c.json(clientMetadata()))
oauthRoot.get('/oauth/jwks.json', async (c) => c.json(await jwks()))
oauthRoot.get('/oauth/callback', async (c) => {
  const k = config()
  try {
    const client = await oauthClient()
    const params = new URLSearchParams(new URL(c.req.url).search)
    const { session, state } = await client.callback(params)
    const did = session.did
    const st = state ? (JSON.parse(state) as { previewId?: string; visibility?: string }) : {}
    // The token response tells us which scopes were granted; anything short of ours means no writes.
    const granted = (session as unknown as { scope?: string }).scope ?? ''
    if (granted && !granted.includes('repo:community.lexicon.calendar.event') && !granted.includes('transition:generic')) {
      await session.signOut().catch(() => {})
      return c.redirect('/connect?error=scopes', 302)
    }
    let h = await getHostByDid(did)
    if (!h) {
      const pdsUrl = (await resolvePdsEndpoint(did).catch(() => null)) ?? k.PDS_URL
      const hostId = id('host')
      const [row] = await getDb()
        .insert(host)
        .values({ id: hostId, did, handle: did, door: 'oauth', displayName: did, region: k.REGION_SLUG, provenanceLevel: 'email', pdsUrl, ownershipExercisedAt: new Date() })
        .returning()
      h = row!
      await getDb().insert(inboundAddress).values({ hostId, emailToken: newToken(12), webhookToken: newToken(16), webhookSecret: newToken(24) })
      await recordAudit({ hostId, actor: did, action: 'host.created', detail: { door: 'oauth' } })
      await refreshOauthProfile(h)
    } else if (h.pausedReason) {
      await unpauseHost(h.id)
    }
    await storeOauthSession(h.id, did)
    const { cookie, expiresAt } = await createSession(h.id)
    c.header('Set-Cookie', cookieHeader(cookie, expiresAt))
    let sourceId: string | null = null
    if (st.previewId) sourceId = await connectPreviewed(h, st.previewId, st.visibility as Visibility).catch(() => null)
    if (sourceId?.startsWith('confirm:')) return c.redirect(`/confirm/${sourceId.slice('confirm:'.length)}?welcome=1`, 302)
    return c.redirect(`/dashboard?welcome=1${sourceId ? `&source=${sourceId}` : ''}`, 302)
  } catch (err) {
    log.warn('oauth callback failed', { detail: describeError(err) })
    return c.redirect('/connect?error=oauth', 302)
  }
})

/** Handle and display name for an OAuth host, from the public directory record. */
async function refreshOauthProfile(h: HostRow): Promise<void> {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(h.did)}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return
    const p = (await res.json()) as { handle?: string; displayName?: string }
    await getDb()
      .update(host)
      .set({ handle: p.handle ?? h.handle, displayName: p.displayName || p.handle || h.displayName })
      .where(eq(host.id, h.id))
  } catch {
    /* profile is cosmetic */
  }
}

authRoutes.get('/session', (c) => {
  const h = c.get('host')
  return c.json({ signedIn: !!h })
})

export function requireSessionHost(c: Parameters<typeof requireHost>[0]): HostRow {
  return requireHost(c)
}
