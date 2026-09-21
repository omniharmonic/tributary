/**
 * Cover image recovery (architecture §11). Order: native field → JSON-LD `image` →
 * platform page data (Luma `cover_url`, Meetup JSON-LD) → `og:image`, rejecting an
 * og:image that the site reuses across events (its default share image).
 *
 * Fetching, re-encoding and hashing happen in the publisher; this only finds the URL.
 */
import type { HttpClient } from '@tributary/ssrf-fetch'
import { extractJsonLdEvents, extractPageMeta } from '../jsonld-page/extract.js'

export interface RecoverImageInput {
  sourceUrl: string
  platform: string
  /** The image the source already gave us (ICS ATTACH, API field). */
  existing?: string
}

export interface RecoverImageCtx {
  http: HttpClient
  /** How many DISTINCT other events on `domain` used this og:image. ≥3 means it is the site's default. */
  seen: (domain: string, url: string) => number
  log?: { warn(msg: string, fields?: Record<string, string | number | boolean>): void }
}

export interface RecoveredImage {
  url: string
  alt?: string
  via: 'native' | 'jsonld' | 'page-data' | 'og'
}

/** How many other events may share an og:image before we call it the site's default. */
export const DEFAULT_SHARE_IMAGE_THRESHOLD = 3

const IMAGE_URL = /^https?:\/\//i
const PLACEHOLDER = /\/(?:placeholder|default|blank|logo-square|share-default)[^/]*\.(?:png|jpe?g|webp|gif)(?:\?|$)/i

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Pure ranking over an already-fetched page; exported so tests and the runtime cache can reuse it. */
export function pickImageFromPage(html: string, pageUrl: string, platform: string, seen: RecoverImageCtx['seen']): RecoveredImage | undefined {
  const events = extractJsonLdEvents(html, pageUrl)
  const jsonld = events.find((e) => e.imageUrl && IMAGE_URL.test(e.imageUrl))
  if (jsonld?.imageUrl && !PLACEHOLDER.test(jsonld.imageUrl)) return { url: jsonld.imageUrl, alt: jsonld.imageAlt ?? jsonld.name, via: 'jsonld' }
  const meta = extractPageMeta(html, pageUrl)
  if (platform === 'luma' && meta.lumaCoverUrl && IMAGE_URL.test(meta.lumaCoverUrl)) return { url: meta.lumaCoverUrl, alt: meta.ogTitle ?? meta.title, via: 'page-data' }
  if (meta.ogImage && IMAGE_URL.test(meta.ogImage) && !PLACEHOLDER.test(meta.ogImage)) {
    const reuse = seen(domainOf(pageUrl), meta.ogImage)
    if (reuse < DEFAULT_SHARE_IMAGE_THRESHOLD) return { url: meta.ogImage, alt: meta.ogTitle ?? meta.title, via: 'og' }
  }
  return undefined
}

export async function recoverImage(input: RecoverImageInput, ctx: RecoverImageCtx): Promise<RecoveredImage | undefined> {
  if (input.existing && IMAGE_URL.test(input.existing)) return { url: input.existing, via: 'native' }
  if (!input.sourceUrl || !IMAGE_URL.test(input.sourceUrl)) return undefined
  let html: string
  let finalUrl = input.sourceUrl
  try {
    const res = await ctx.http.getPage(input.sourceUrl, { timeoutMs: 15_000 })
    if (res.status !== 200 || (res.contentType && !/html|xml/.test(res.contentType))) return undefined
    html = res.text()
    finalUrl = res.url
  } catch (err) {
    ctx.log?.warn('image recovery fetch failed', { reason: err instanceof Error ? err.name : 'unknown' })
    return undefined
  }
  return pickImageFromPage(html, finalUrl, input.platform, ctx.seen)
}
