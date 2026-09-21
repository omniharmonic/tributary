/**
 * Cover images (architecture §11): fetched through ssrf-fetch, decoded and re-encoded
 * with sharp (strips EXIF, caps 2048 px, targets under 900 KB to match atmo's own
 * compressor and stay far below the PDS's 5 MB default), hashed so identical images
 * upload once per repo.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { HttpClient } from '@tributary/ssrf-fetch'

export interface PreparedImage {
  bytes: Buffer
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
  /** sha256 of the ORIGINAL bytes: the cache key across re-encodes. */
  sourceHash: string
  /** sha256 of the encoded bytes: what the blob dedupe uses. */
  hash: string
}

export const MAX_EDGE = 2048
export const TARGET_BYTES = 900 * 1024

export async function prepareImage(original: Buffer): Promise<PreparedImage> {
  const sourceHash = createHash('sha256').update(original).digest('hex')
  const img = sharp(original, { failOn: 'none', animated: false }).rotate()
  // Always JPEG (flattened onto white): the widest-rendered format across readers and
  // proxies. Re-encoding (never passing source bytes through) is what strips EXIF and
  // any payload hidden in the file.
  let pipeline = img.flatten({ background: '#ffffff' }).resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
  let quality = 82
  let out: Buffer
  const mime: PreparedImage['mime'] = 'image/jpeg'
  for (;;) {
    out = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer()
    if (out.length <= TARGET_BYTES || quality <= 50) break
    quality -= 8
    if (quality < 66) pipeline = pipeline.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
  }
  const final = await sharp(out).metadata()
  return {
    bytes: out,
    mime,
    width: final.width ?? 0,
    height: final.height ?? 0,
    sourceHash,
    hash: createHash('sha256').update(out).digest('hex'),
  }
}

export async function fetchAndPrepareImage(url: string, http: HttpClient): Promise<PreparedImage | undefined> {
  const res = await http.get(url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 25_000, headers: { accept: 'image/*,*/*;q=0.5' } })
  if (res.status !== 200 || res.body.length === 0) return undefined
  if (res.contentType && !res.contentType.startsWith('image/') && res.contentType !== 'application/octet-stream') return undefined
  try {
    return await prepareImage(res.body)
  } catch {
    return undefined
  }
}

/** A generated regional placeholder: a plain colour block with the initials, so a card is never empty. */
export async function placeholderImage(text: string, colour = '#4b6b47'): Promise<PreparedImage> {
  const initials = text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${colour}"/><text x="600" y="360" font-family="Helvetica, Arial, sans-serif" font-size="220" fill="#fff" text-anchor="middle" opacity="0.9">${initials}</text></svg>`
  return prepareImage(Buffer.from(svg))
}
