/**
 * Description handling: HTML → sanitized markdown, boilerplate stripping, tracking
 * parameter removal, link extraction, conference-link detection, and Bluesky-style
 * facets so links are clickable in atmo.
 */
import sanitizeHtml from 'sanitize-html'
import TurndownService from 'turndown'

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' })
turndown.remove(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'])

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['a', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  disallowedTagsMode: 'discard',
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s) && /<(p|br|a|div|ul|ol|li|b|i|strong|em|h[1-6]|span)\b/i.test(s)
}

/** HTML (or text) → sanitized markdown. Plain text passes through with whitespace tidied. */
export function toMarkdown(input: string | undefined, isHtml = input ? looksLikeHtml(input) : false): string | undefined {
  if (!input) return undefined
  let md: string
  if (isHtml) {
    const clean = sanitizeHtml(input, SANITIZE)
    md = turndown.turndown(clean)
  } else {
    md = input.replace(/\r\n?/g, '\n')
  }
  md = stripBoilerplate(md)
  md = md
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return md || undefined
}

/** Known feed footers that add nothing to a card. */
const BOILERPLATE: RegExp[] = [
  /\n*Get up-to-date information at:?\s*https?:\/\/\S+\s*$/i, // Luma
  /\n*(?:Event|Hosted) (?:by|on) Luma\b.*$/i,
  /\n*RSVP (?:at|on) (?:lu\.ma|luma\.com)\S*\s*$/i,
  /\n*Learn more (?:at|on) Meetup\S*\s*$/i,
]

export function stripBoilerplate(md: string): string {
  let out = md
  for (const re of BOILERPLATE) out = out.replace(re, '')
  return out
}

const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', '_hsenc', '_hsmi', 'igshid'])

/** Canonical form of an event URL: https, lowercase host, no tracking params, no fragment, no trailing slash. */
export function canonicalUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let u: URL
  try {
    u = new URL(raw.trim().replace(/^webcal:\/\//i, 'https://'))
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
  u.hash = ''
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k)
  let s = u.toString()
  if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1)
  if (u.pathname === '/' && !u.search) s = s.replace(/\/$/, '')
  return s
}

const CONFERENCE_HOSTS = /(?:^|\.)(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|meet\.jit\.si|whereby\.com|gather\.town|webex\.com|bluejeans\.com|gotomeeting\.com|streamyard\.com)$/i

export function isConferenceUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return CONFERENCE_HOSTS.test(u.hostname) && !/^\/(?:pricing|about|download)/.test(u.pathname)
  } catch {
    return false
  }
}

const URL_RE = /https?:\/\/[^\s<>()\]"']+[^\s<>()\]"'.,;:!?]/g

export function extractUrls(text: string | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) out.push(m[0])
  return [...new Set(out)]
}

/**
 * Pull a conference link out of description/location. Returns the link and the text
 * with the link removed (so a public record cannot carry it by accident).
 */
export function extractJoinUrl(parts: Array<string | undefined>): { joinUrl?: string; scrubbed: Array<string | undefined> } {
  let joinUrl: string | undefined
  const scrubbed = parts.map((p) => {
    if (!p) return p
    let s = p
    for (const u of extractUrls(p)) {
      if (isConferenceUrl(u)) {
        joinUrl ??= u
        s = s.split(u).join('[link shared with confirmed guests]')
      }
    }
    return s
  })
  return { joinUrl, scrubbed }
}

export interface LinkFacet {
  index: { byteStart: number; byteEnd: number }
  features: Array<{ $type: 'app.bsky.richtext.facet#link'; uri: string }>
}

/**
 * Bluesky rich-text facets for every URL in `text`, with BYTE offsets (UTF-8), which
 * is what `app.bsky.richtext.facet` requires and what atmo splices into its markdown.
 */
export function linkFacets(text: string): LinkFacet[] {
  const enc = new TextEncoder()
  const facets: LinkFacet[] = []
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    const byteStart = enc.encode(text.slice(0, start)).length
    const byteEnd = byteStart + enc.encode(m[0]).length
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] })
  }
  return facets
}

/** Personal data the parser must drop at every level (architecture §9.4, §15). */
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function findContacts(text: string | undefined): { phones: string[]; emails: string[] } {
  if (!text) return { phones: [], emails: [] }
  return { phones: [...new Set(text.match(PHONE_RE) ?? [])], emails: [...new Set(text.match(EMAIL_RE) ?? [])] }
}

export function redactContacts(text: string | undefined): string | undefined {
  if (!text) return text
  return text.replace(EMAIL_RE, '[email removed]').replace(PHONE_RE, '[phone removed]')
}

/** A short plain-text excerpt for Listed-tier records and previews. */
export function excerpt(md: string | undefined, max = 280): string | undefined {
  if (!md) return undefined
  const plain = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= max) return plain || undefined
  return plain.slice(0, max - 1).replace(/\s+\S*$/, '') + '...'
}
