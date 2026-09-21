/**
 * Timezone identifier resolution for ICS feeds.
 *
 * Outlook, Exchange and a few WordPress plugins write Windows display names or
 * registry names as TZID (`Mountain Standard Time`, `(UTC-07:00) Mountain Time (US &
 * Canada)`); Mozilla-era feeds write `/mozilla.org/20050126_1/America/Denver`. Anything
 * we cannot map to a valid IANA zone is treated as floating and left for the source
 * default, which the normalizer flags as inferred.
 */
import { IANAZone } from 'luxon'

const WINDOWS_TO_IANA: Record<string, string> = {
  'dateline standard time': 'Etc/GMT+12',
  'hawaiian standard time': 'Pacific/Honolulu',
  'alaskan standard time': 'America/Anchorage',
  'pacific standard time': 'America/Los_Angeles',
  'pacific standard time (mexico)': 'America/Tijuana',
  'us mountain standard time': 'America/Phoenix',
  'mountain standard time': 'America/Denver',
  'mountain standard time (mexico)': 'America/Chihuahua',
  'central standard time': 'America/Chicago',
  'central standard time (mexico)': 'America/Mexico_City',
  'canada central standard time': 'America/Regina',
  'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns',
  'sa pacific standard time': 'America/Bogota',
  'sa western standard time': 'America/La_Paz',
  'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Argentina/Buenos_Aires',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'gmt standard time': 'Europe/London',
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'romance standard time': 'Europe/Paris',
  'central european standard time': 'Europe/Warsaw',
  'e. europe standard time': 'Europe/Chisinau',
  'gtb standard time': 'Europe/Bucharest',
  'fle standard time': 'Europe/Kiev',
  'russian standard time': 'Europe/Moscow',
  'turkey standard time': 'Europe/Istanbul',
  'israel standard time': 'Asia/Jerusalem',
  'arabian standard time': 'Asia/Dubai',
  'india standard time': 'Asia/Kolkata',
  'sri lanka standard time': 'Asia/Colombo',
  'nepal standard time': 'Asia/Kathmandu',
  'bangladesh standard time': 'Asia/Dhaka',
  'se asia standard time': 'Asia/Bangkok',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'taipei standard time': 'Asia/Taipei',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'aus eastern standard time': 'Australia/Sydney',
  'aus central standard time': 'Australia/Darwin',
  'w. australia standard time': 'Australia/Perth',
  'cen. australia standard time': 'Australia/Adelaide',
  'e. australia standard time': 'Australia/Brisbane',
  'tasmania standard time': 'Australia/Hobart',
  'new zealand standard time': 'Pacific/Auckland',
  'south africa standard time': 'Africa/Johannesburg',
  'egypt standard time': 'Africa/Cairo',
  'w. central africa standard time': 'Africa/Lagos',
  'e. africa standard time': 'Africa/Nairobi',
}

/** `(UTC-07:00) Mountain Time (US & Canada)` style display names. */
const DISPLAY_NAME_TO_IANA: Array<[RegExp, string]> = [
  [/mountain time \(us/i, 'America/Denver'],
  [/arizona/i, 'America/Phoenix'],
  [/pacific time \(us/i, 'America/Los_Angeles'],
  [/central time \(us/i, 'America/Chicago'],
  [/eastern time \(us/i, 'America/New_York'],
  [/alaska/i, 'America/Anchorage'],
  [/hawaii/i, 'Pacific/Honolulu'],
  [/atlantic time \(canada\)/i, 'America/Halifax'],
  [/dublin, edinburgh, lisbon, london/i, 'Europe/London'],
  [/amsterdam, berlin/i, 'Europe/Berlin'],
  [/brussels, copenhagen, madrid, paris/i, 'Europe/Paris'],
]

/** Common non-IANA abbreviations seen in the wild. */
const ABBREVIATIONS: Record<string, string> = {
  mst: 'America/Denver',
  mdt: 'America/Denver',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  est: 'America/New_York',
  edt: 'America/New_York',
  gmt: 'UTC',
  z: 'UTC',
  bst: 'Europe/London',
  cet: 'Europe/Paris',
  cest: 'Europe/Paris',
}

/** Resolve any TZID spelling to a valid IANA zone, or undefined when it cannot be trusted. */
export function resolveTzid(tzid: string | undefined | null): string | undefined {
  if (!tzid) return undefined
  let s = tzid.trim().replace(/^"|"$/g, '')
  if (!s) return undefined
  // Mozilla / Sunbird prefix: /mozilla.org/20050126_1/America/Denver
  const slash = /\/[^/]+\/[^/]+\/(.+)$/.exec(s)
  if (s.startsWith('/') && slash?.[1]) s = slash[1]
  const lower = s.toLowerCase()
  // `MST`, `EST`, `HST` are legacy IANA names for FIXED offsets (no DST); a feed that
  // writes them means the local zone, so the abbreviation table wins over IANA validity.
  if (ABBREVIATIONS[lower]) return ABBREVIATIONS[lower]
  if (IANAZone.isValidZone(s)) return s
  if (WINDOWS_TO_IANA[lower]) return WINDOWS_TO_IANA[lower]
  for (const [re, zone] of DISPLAY_NAME_TO_IANA) if (re.test(s)) return zone
  // "Etc/GMT-7"-like or "UTC+02:00" offsets: we do not invent a zone from an offset.
  return undefined
}
