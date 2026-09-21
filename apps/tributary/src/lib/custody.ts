/**
 * Door B (architecture §8.2): "Publish as…". Email + display name + handle. We verify
 * the email with a magic link, then mint a real account on the Directory PDS with a
 * random main password, keep only an app password, and publish.
 *
 * The signup itself is deferred until the link is clicked, so an unverified address
 * never mints a permanent public identity.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { generateLabel, hashToken, newToken, PdsError, provisionCustodialAccount, randomPassword, resolveHandle, RESERVED_LABELS, validateLabel, type PdsConfig } from '@tributary/identity'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { emailToken, host, inboundAddress } from '../db/schema.js'
import { id } from './ids.js'
import { describeError, log } from './logging.js'
import { sendMail } from './mail.js'
import { getHostByHandle, storeAppPassword, type HostRow } from './hosts.js'
import { recordAudit } from './audit.js'

export const VERIFY_TTL_MS = 24 * 3_600_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class SignupError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'SignupError'
  }
}

export function pdsConfig(): PdsConfig {
  const c = config()
  return { url: c.PDS_URL, adminPassword: c.PDS_ADMIN_PASSWORD }
}

export interface PendingSignup {
  email: string
  displayName: string
  label: string
  previewId?: string
  visibility?: string
  audience?: Record<string, unknown>
  newsletter?: boolean
}

export async function checkHandle(label: string): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'reserved' | 'taken' }> {
  const v = validateLabel(label, RESERVED_LABELS)
  if (!v.ok) return v
  const handle = `${label}.${config().handleDomain}`
  if (await getHostByHandle(handle)) return { ok: false, reason: 'taken' }
  try {
    const did = await resolveHandle(handle, config().PDS_URL)
    if (did) return { ok: false, reason: 'taken' }
  } catch (err) {
    // Cannot ask the PDS: say taken rather than promise a name we cannot mint.
    log.warn('handle check could not reach the PDS', { detail: describeError(err) })
    return { ok: false, reason: 'taken' }
  }
  return { ok: true }
}

function verifyUrl(token: string): string {
  return `${config().WEB_PUBLIC_URL}/auth/verify?token=${encodeURIComponent(token)}`
}

/** Step 1 of Door B: validate, store the pending signup, send the link. */
export async function beginSignup(input: PendingSignup): Promise<{ handle: string; verifyUrl?: string }> {
  const c = config()
  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new SignupError('That does not look like an email address.', 400, 'InvalidInput')
  const label = input.label.trim().toLowerCase()
  const check = await checkHandle(label)
  if (!check.ok) throw new SignupError(`That handle is ${check.reason === 'invalid' ? 'not valid (3–18 lowercase letters, digits or hyphens)' : check.reason}.`, 400, 'InvalidInput')
  const displayName = input.displayName.trim().slice(0, 80)
  if (!displayName) throw new SignupError('Please give a display name.', 400, 'InvalidInput')

  // Rate limit: at most 5 pending links per address per day.
  const recent = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(emailToken)
    .where(and(eq(emailToken.email, email), gt(emailToken.createdAt, new Date(Date.now() - 86_400_000))))
  if (Number(recent[0]?.n ?? 0) >= 5) throw new SignupError('Too many links requested for this address today.', 429, 'RateLimited')

  const token = newToken()
  await getDb().insert(emailToken).values({
    tokenHash: hashToken(token),
    email,
    purpose: 'signup',
    payload: { ...input, email, label, displayName } as Record<string, unknown>,
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  })
  const url = verifyUrl(token)
  await sendMail({
    to: email,
    subject: `Confirm your ${c.BRAND_NAME} account`,
    text: `Hello ${displayName},\n\nClick to confirm your email and publish your events as @${label}.${c.handleDomain}:\n\n${url}\n\nThis link works once and expires in 24 hours. If you did not ask for this, ignore it.\n\nPublishing is public and permanent: deletes propagate, but copies others made cannot be recalled. ${c.WEB_PUBLIC_URL}/about/publishing\n`,
  })
  return { handle: `${label}.${c.handleDomain}`, ...(c.SMTP_URL ? {} : { verifyUrl: url }) }
}

/** A returning host: same door, no account creation. */
export async function beginLogin(emailRaw: string): Promise<{ verifyUrl?: string }> {
  const c = config()
  const email = emailRaw.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new SignupError('That does not look like an email address.', 400, 'InvalidInput')
  const token = newToken()
  await getDb().insert(emailToken).values({ tokenHash: hashToken(token), email, purpose: 'login', payload: null, expiresAt: new Date(Date.now() + VERIFY_TTL_MS) })
  const url = verifyUrl(token)
  // Always answer the same way whether or not the address is known (no enumeration).
  const rows = await getDb().select().from(host).where(eq(host.email, email)).limit(1)
  if (rows[0]) {
    await sendMail({ to: email, subject: `Sign in to ${c.BRAND_NAME}`, text: `Click to sign in:\n\n${url}\n\nThis link works once and expires in 24 hours.\n` })
  } else {
    await sendMail({ to: email, subject: `Sign in to ${c.BRAND_NAME}`, text: `We could not find an account for this address. Add your events at ${c.WEB_PUBLIC_URL}/add to create one.\n` })
  }
  return c.SMTP_URL ? {} : { verifyUrl: url }
}

export interface VerifyResult {
  host: HostRow
  created: boolean
  pending?: PendingSignup
}

/** Step 2: the link was clicked. Mint the account (signup) or find it (login). */
export async function verifyToken(token: string): Promise<VerifyResult> {
  const c = config()
  const rows = await getDb()
    .select()
    .from(emailToken)
    .where(and(eq(emailToken.tokenHash, hashToken(token)), isNull(emailToken.usedAt), gt(emailToken.expiresAt, new Date())))
    .limit(1)
  const t = rows[0]
  if (!t) throw new SignupError('This link is no longer valid. Request a new one.', 400, 'InvalidInput')
  await getDb().update(emailToken).set({ usedAt: new Date() }).where(eq(emailToken.tokenHash, t.tokenHash))

  if (t.purpose === 'login') {
    const existing = await getDb().select().from(host).where(eq(host.email, t.email)).limit(1)
    if (!existing[0]) throw new SignupError('No account for this address yet.', 404, 'NotFound')
    return { host: existing[0], created: false }
  }

  const pending = t.payload as unknown as PendingSignup
  // An address that already has an account just signs in.
  const existing = await getDb().select().from(host).where(eq(host.email, t.email)).limit(1)
  if (existing[0]) return { host: existing[0], created: false, pending }

  const label = pending.label
  let handle = `${label}.${c.handleDomain}`
  let account: { did: string; handle: string; appPassword: string } | undefined
  let lastErr: unknown
  for (let attempt = 0; attempt < 4 && !account; attempt++) {
    try {
      account = await provisionCustodialAccount(pdsConfig(), { email: t.email, handle }, randomPassword)
    } catch (err) {
      lastErr = err
      if (err instanceof PdsError && (err.code === 'HandleNotAvailable' || err.code === 'InvalidHandle')) {
        handle = `${generateLabel()}.${c.handleDomain}`
        continue
      }
      break
    }
  }
  if (!account) {
    log.error('custodial signup failed at the PDS', { detail: describeError(lastErr) })
    throw new SignupError('We could not create your account right now. Please try the link again in a minute.', 502, 'PdsRejected')
  }

  const hostId = id('host')
  const [row] = await getDb()
    .insert(host)
    .values({
      id: hostId,
      did: account.did,
      handle: account.handle,
      door: 'custodial',
      email: t.email,
      emailVerifiedAt: new Date(),
      displayName: pending.displayName,
      region: c.REGION_SLUG,
      provenanceLevel: 'email',
      pdsUrl: c.PDS_URL,
    })
    .returning()
  await storeAppPassword(hostId, account.did, account.appPassword)
  await getDb().insert(inboundAddress).values({ hostId, emailToken: newToken(12), webhookToken: newToken(16), webhookSecret: newToken(24) })
  await recordAudit({ hostId, actor: account.did, action: 'host.created', detail: { door: 'custodial' } })
  log.info('custodial host minted')
  return { host: row!, created: true, pending }
}

/** "Set a password and take full control": the PDS's own reset email. We never knew the password. */
export async function takeControl(h: HostRow): Promise<void> {
  if (h.door !== 'custodial' || !h.email) throw new SignupError('This account is not custodial.', 400, 'InvalidInput')
  const { requestPasswordReset } = await import('@tributary/identity')
  await requestPasswordReset(config().PDS_URL, h.email)
  await getDb().update(host).set({ ownershipExercisedAt: new Date() }).where(eq(host.id, h.id))
  await recordAudit({ hostId: h.id, actor: h.did, action: 'host.take-control' })
}
