/**
 * All identity crypto in one place, lifted from Free School (`lib/crypto.ts`) and
 * made config-free: callers pass the key ring.
 *
 *  - credentials: AES-256-GCM under a VERSIONED key, so rotating the key re-wraps
 *    rather than locking every host out;
 *  - sessions: `<id>.<hmac>` — the cookie is a pointer plus a signature, never a token;
 *  - magic links / API keys / invite tokens: random, only the sha256 is stored.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type KeyRing = Map<string, Buffer>

/** `v1:<base64 32 bytes>,v2:<...>` → ring. */
export function parseKeyRing(spec: string): KeyRing {
  const ring: KeyRing = new Map()
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':')
    if (i <= 0) throw new Error('key ring entry must be <version>:<base64>')
    const version = part.slice(0, i)
    const key = Buffer.from(part.slice(i + 1), 'base64')
    if (key.length !== 32) throw new Error(`key ${version} must be 32 bytes`)
    ring.set(version, key)
  }
  if (ring.size === 0) throw new Error('empty key ring')
  return ring
}

export interface Wrapped {
  keyVersion: string
  blob: Buffer
}

export function wrapSecret(plaintext: string, ring: KeyRing, version: string): Wrapped {
  const key = ring.get(version)
  if (!key) throw new Error(`no key for version ${version}`)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { keyVersion: version, blob: Buffer.concat([iv, ct, cipher.getAuthTag()]) }
}

export function unwrapSecret(wrapped: Wrapped, ring: KeyRing): string {
  const key = ring.get(wrapped.keyVersion)
  if (!key) throw new Error(`no key for version ${wrapped.keyVersion}`)
  const iv = wrapped.blob.subarray(0, 12)
  const tag = wrapped.blob.subarray(wrapped.blob.length - 16)
  const ct = wrapped.blob.subarray(12, wrapped.blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/* sessions */

export function newSessionId(): string {
  return randomBytes(24).toString('base64url')
}

export function signSessionId(id: string, secret: string): string {
  return `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`
}

export function verifySessionCookie(cookie: string, secret: string): string | null {
  const i = cookie.lastIndexOf('.')
  if (i <= 0) return null
  const id = cookie.slice(0, i)
  const sig = Buffer.from(cookie.slice(i + 1), 'base64url')
  const want = createHmac('sha256', secret).update(id).digest()
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null
  return id
}

/* tokens */

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

export function randomPassword(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** `tb_` prefixed API keys: recognisable in a leak scanner, hashed at rest. */
export function newApiKey(): string {
  return `tb_${randomBytes(24).toString('base64url')}`
}

export function hmacHex(secret: string, body: string | Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
