import { createHash } from 'node:crypto'
import type { NormalizedEvent } from './types.js'

const NUL = String.fromCharCode(0)

/** Title normalization shared with the discovery site's duplicate grouping. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|of|and|at|in|on|for|to|with)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) out[k] = canonical(x)
    }
    return out
  }
  return v
}

export function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex')
}

/**
 * The content hash covers everything that ends up in the published record and nothing
 * that does not (fetchedAt, contentHash itself, cache refs). Equal hash means no write.
 */
export function contentHash(e: Omit<NormalizedEvent, 'contentHash'>): string {
  const { provenance, image, ...rest } = e
  const body = canonical({
    ...rest,
    image: image ? { url: image.url, alt: image.alt, origin: image.origin, bytesRef: image.bytesRef } : undefined,
    platform: provenance.platform,
    method: provenance.method,
  })
  return sha256(JSON.stringify(body))
}

/** Fallback identity when a source regenerates UIDs: hash(title-normalized, start, location). */
export function fallbackIdentity(name: string, startInstant: string, location?: string): string {
  return 'h_' + sha256(`${normalizeTitle(name)}${NUL}${startInstant}${NUL}${(location ?? '').toLowerCase().trim()}`).slice(0, 24)
}

/** Canonical form of a source (feed URL, calendar id, group slug) for claims and duplicate detection. */
export function sourceFingerprint(type: string, key: string): string {
  return `${type}:${key.trim().toLowerCase()}`
}
