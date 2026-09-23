/**
 * Free-text location parsing. Feeds put the whole place on one line and every platform
 * punctuates it differently:
 *
 *   "Boulder Public Library, 1001 Arapahoe Ave, Boulder, CO 80302"
 *   "The Dairy Arts Center • 2590 Walnut St"
 *   "1001 Arapahoe Ave Boulder CO"
 *   "Online"
 *
 * Pulling the street out is what lets the geocoder answer at house precision instead of
 * dropping to the city centroid, and pulling the venue name out is what lets the
 * gazetteer match. Deliberately conservative: anything that is plainly not a place
 * ("Online", "TBA") comes back `undefined` so callers do not geocode a placeholder.
 */
import { KNOWN_LOCALITIES } from './venues.js'

export interface ParsedAddress {
  /** House number and street, e.g. "1001 Arapahoe Ave". */
  street?: string
  locality?: string
  /** Always the two-letter form when recognised. */
  region?: string
  /** Five digits; a ZIP+4 is truncated. */
  postalCode?: string
  /** The leading part that carries no house number, e.g. "Boulder Public Library". */
  venueName?: string
}

/** Whole-string placeholders that mean "there is no address here". */
const NON_ADDRESS =
  /^(online|virtual|remote|zoom|zoom call|zoom meeting|google meet|teams|webinar|livestream|live stream|streaming|tba|tbd|n\s*\/?\s*a|none|unknown|to be (announced|determined|confirmed)|location (tba|tbd|to be announced|to be determined)|various|various locations|multiple locations|see (the )?(description|website|link|event page)|check (the )?(description|website)|hybrid|in person|virtual event|online event|online only|no location)$/

const STREET_SUFFIX =
  /(?:st|street|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|way|pl|place|pkwy|parkway|ter|terrace|trl|trail|hwy|highway|loop|sq|square|walk|row|path|run|bend|crossing|xing|plz|plaza|spur|route|rte|expy|expressway|aly|alley|mall|commons|ranch|ridge|point|pt|view|park)/

const DIRECTIONAL = /(?:n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)/

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/
const STATE_RE = /\b(co|colo|colorado)\b/i
/** A house number then at least one word, ending in a street suffix. */
const STREET_BODY = `\\d+[a-z]?\\s+(?:${DIRECTIONAL.source}\\s+)?[a-z0-9'’.\\- ]*?\\b(?:${STREET_SUFFIX.source})\\b\\.?(?:\\s+(?:${DIRECTIONAL.source})\\b\\.?)?`
const STREET_RE = new RegExp(`^${STREET_BODY}`, 'i')
const STREET_ANYWHERE_RE = new RegExp(`\\b${STREET_BODY}`, 'i')
/** Fallback: a house number plus a short run of words ("1898 S Flatiron Ct"). */
const LOOSE_STREET_RE = /^\d+[a-z]?\s+\S+(?:\s+\S+){0,4}$/i

const UNIT_RE = /\b(?:suite|ste|unit|apt|apartment|#|room|rm|bldg|building|floor|fl)\b\.?\s*[a-z0-9-]+/i

const LOCALITY_SET = new Set(KNOWN_LOCALITIES)

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s,;:.•·|–—-]+|[\s,;:.•·|–—-]+$/g, '').trim()
}

function normalizeState(raw: string): string {
  return /^colo/i.test(raw) ? 'CO' : raw.toUpperCase()
}

/** Does this segment read as a street line? */
function isStreet(segment: string): boolean {
  const s = segment.replace(UNIT_RE, '').trim()
  if (!/^\d/.test(s)) return false
  return STREET_RE.test(s) || LOOSE_STREET_RE.test(s)
}

/** Split a segment that ends in a known locality, e.g. "1001 Arapahoe Ave Boulder". */
function splitTrailingLocality(segment: string): { rest: string; locality?: string } {
  const words = segment.split(' ')
  // Longest locality first so "estes park" beats "park".
  for (let take = Math.min(3, words.length - 1); take >= 1; take--) {
    const tail = words.slice(words.length - take).join(' ').toLowerCase()
    if (LOCALITY_SET.has(tail)) {
      return { rest: words.slice(0, words.length - take).join(' '), locality: titleCase(tail) }
    }
  }
  return { rest: segment }
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/**
 * Best-effort structured form of a one-line location. `undefined` means there is no
 * place here at all; a result with only `venueName` means we found a name but no
 * address, which is exactly what the gazetteer wants to try next.
 */
export function parseAddressLine(text: string | undefined | null): ParsedAddress | undefined {
  const raw = tidy(String(text ?? ''))
  if (!raw || !/[a-z]/i.test(raw)) return undefined
  if (NON_ADDRESS.test(raw.toLowerCase().replace(/\s+/g, ' '))) return undefined

  let working = raw

  // ZIP, then state, lifted out wherever they sit.
  let postalCode: string | undefined
  const zip = ZIP_RE.exec(working)
  if (zip) {
    postalCode = zip[1]
    working = tidy(working.slice(0, zip.index) + ' ' + working.slice(zip.index + zip[0].length))
  }
  let region: string | undefined
  const state = STATE_RE.exec(working)
  if (state) {
    region = normalizeState(state[1]!)
    working = tidy(working.slice(0, state.index) + ' ' + working.slice(state.index + state[0].length))
  }

  // One separator vocabulary.
  const segments = working
    .split(/\s*[,;•·|]\s*|\s+[–—]\s+/)
    .map(tidy)
    .filter(Boolean)
  if (segments.length === 0) return undefined

  let locality: string | undefined
  // A whole segment that is a locality, searched from the end.
  for (let i = segments.length - 1; i >= 0; i--) {
    if (LOCALITY_SET.has(segments[i]!.toLowerCase())) {
      locality = titleCase(segments[i]!.toLowerCase())
      segments.splice(i, 1)
      break
    }
  }
  // Otherwise a locality glued to the end of the last segment.
  if (!locality) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const split = splitTrailingLocality(segments[i]!)
      if (split.locality) {
        locality = split.locality
        if (split.rest) segments[i] = split.rest
        else segments.splice(i, 1)
        break
      }
    }
  }

  const streetAt = segments.findIndex(isStreet)
  const street = streetAt >= 0 ? segments[streetAt] : undefined
  const nameParts = streetAt >= 0 ? segments.slice(0, streetAt) : locality || region || postalCode ? segments : segments
  const venueName = nameParts.filter((s) => !isStreet(s)).join(', ') || undefined

  if (!street && !locality && !region && !postalCode && !venueName) return undefined
  return {
    ...(street ? { street } : {}),
    ...(locality ? { locality } : {}),
    ...(region ? { region } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(venueName ? { venueName } : {}),
  }
}

/** The street-first query a geocoder should be given, or `undefined` if there is none. */
export function geocodableQuery(p: ParsedAddress): string | undefined {
  if (!p.street) return undefined
  return [p.street, p.locality, p.region, p.postalCode].filter(Boolean).join(', ')
}
