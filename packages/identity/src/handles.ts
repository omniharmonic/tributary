/**
 * Handle rules (architecture §8.1): front labels of 3–18 characters, lowercase,
 * `[a-z0-9]` with single hyphens inside, plus a reserved list so nobody squats
 * `cityofboulder` or a name the edge serves. Hosts choose their own label (an
 * organization wants `dairyarts`, not `calmotter417`); the generator is the fallback.
 */
import { randomInt } from 'node:crypto'

export const HANDLE_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,16}[a-z0-9])$/

/** Generic labels every deployment reserves. */
const GENERIC = `
admin administrator root sysadmin support help helpdesk info contact abuse security postmaster hostmaster webmaster
www www1 www2 web mail email smtp imap pop pop3 ftp sftp ssh vpn dns ns ns1 ns2 mx api apis app apps static assets cdn
media img images image video videos files download downloads upload uploads internal intranet dev develop developer
developers staging stage test testing demo sandbox beta alpha canary preview prod production status health metrics
login logout signin signup register account accounts settings profile profiles me my mine you your user users member
members people person host hosts admin-panel dashboard console panel manage manager management moderator mod mods
steward stewards curator curators editor editors owner owners team teams staff crew official verified verify
tributary directory the-directory boulder-directory gate pds plc relay indexer bot bots agent agents system service
services feed feeds calendar calendars event events rsvp tickets ticket subscribe unsubscribe newsletter blog news
about legal terms privacy policy dmca copyright contact-us careers jobs press shop store checkout cart pay payment
payments billing invoice invoices bank wallet crypto donate donations gift
bluesky bsky atproto atmosphere atmo techne freeskool free-school freeschool cohere iiw beacon dandelion actualize
boulder denver longmont louisville lafayette superior erie niwot nederland lyons broomfield westminster arvada golden
frontrange front-range colorado co usa us america
city cityof city-of cityofboulder city-of-boulder county bouldercounty boulder-county state government gov police fire
library libraries school schools district university cu cuboulder cu-boulder naropa college campus hospital clinic
church temple mosque synagogue mayor council courthouse dmv post-office
google gmail apple icloud microsoft outlook facebook meta instagram twitter x tiktok youtube luma lu-ma meetup eventbrite
partiful discord telegram signal whatsapp slack zoom
null undefined none nobody anonymous anon guest guests visitor visitors public private everyone all
`.split(/\s+/).filter(Boolean)

/** Local organizations whose names a stranger must not take (impersonation, §15). */
const LOCAL_ORGS = `
dairyarts dairy-arts thedairy dairyartscenter etown etownhall e-town bmoca bpl boulderlibrary boulder-library
chautauqua bouldertheater boulder-theater foxtheatre fox-theatre trident junkyard rayback bouldershelter bouldercounty
museumofboulder growinggardens boulderfarmersmarket farmersmarket bcfm boulderjcc jcc naropa nomad firehouse
longmontmuseum spiritofthefrontrange sotfr opencivics regenhub regen-hub bouldercivic bouldercivictech
`.split(/\s+/).filter(Boolean)

export const RESERVED_LABELS: ReadonlySet<string> = new Set([...GENERIC, ...LOCAL_ORGS])

export function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function validateLabel(
  label: string,
  reserved: ReadonlySet<string> = RESERVED_LABELS,
): { ok: true } | { ok: false; reason: 'invalid' | 'reserved' } {
  if (!HANDLE_LABEL_RE.test(label)) return { ok: false, reason: 'invalid' }
  if (reserved.has(label)) return { ok: false, reason: 'reserved' }
  return { ok: true }
}

/** Alternatives when a label is taken or reserved. */
export function suggestLabels(label: string, taken: (l: string) => boolean = () => false): string[] {
  const base = normalizeLabel(label).slice(0, 14) || 'events'
  const cands = [`${base}-events`, `${base}-boulder`, `${base}-co`, `${base}2`, `${base}${randomInt(10, 99)}`, `the-${base}`]
  return cands.filter((c) => validateLabel(c).ok && !taken(c)).slice(0, 4)
}

const FIRST = ['calm', 'quiet', 'bright', 'open', 'warm', 'clear', 'kind', 'plain', 'steady', 'fresh', 'wide', 'still', 'early', 'easy', 'free', 'glad', 'soft', 'true', 'newly', 'good']
const SECOND = ['otter', 'maple', 'creek', 'meadow', 'finch', 'cedar', 'willow', 'heron', 'aspen', 'wren', 'birch', 'sparrow', 'clover', 'juniper', 'alder', 'thrush', 'laurel', 'plover', 'sorrel', 'sedge']

/** Fallback generator (Free School's): never derived from the email. */
export function generateLabel(reserved: ReadonlySet<string> = RESERVED_LABELS): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const l = `${FIRST[randomInt(FIRST.length)]!}${SECOND[randomInt(SECOND.length)]!}${randomInt(100, 1000)}`
    if (!reserved.has(l)) return l
  }
  throw new Error('could not generate a label outside the reserved list')
}

/** A display name → a label suggestion for the signup form ("Dairy Arts Center" → "dairy-arts-center"). */
export function labelFromName(name: string): string {
  const l = normalizeLabel(name.replace(/\b(the|of|and|&)\b/gi, ' ')).slice(0, 18).replace(/-$/, '')
  return l.length >= 3 ? l : ''
}
