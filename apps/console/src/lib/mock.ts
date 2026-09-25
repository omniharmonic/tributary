/**
 * Realistic Boulder fixtures so the console is fully navigable without a backend
 * (`VITE_MOCK_API=1 pnpm dev`). State lives in memory for the tab's lifetime.
 */
import { DateTime } from 'luxon'
import type { Api } from './api'
import { ApiError } from './errors'
import type { ApiKey, Confirmation, CsvInfo, DetectMatch, EventCard, LedgerEvent, ManagedHost, Me, OrgRole, Preview, PublicEvent, PublicHost, Rule, Source, SourceDetail, StewardReport, Visibility } from './types'

const TZ = 'America/Denver'
const now = DateTime.now().setZone(TZ)
const at = (dayOffset: number, hour: number, minute = 0) => now.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 })
const iso = (d: DateTime) => d.toUTC().toISO()!
const when = (s: DateTime, e?: DateTime) => {
  const t = (d: DateTime) => d.toFormat(d.minute === 0 ? 'h a' : 'h:mm a')
  return e ? `${s.toFormat('ccc, LLL d')} · ${t(s)} – ${t(e)} ${s.toFormat('ZZZZ')}` : `${s.toFormat('ccc, LLL d')} · ${t(s)} ${s.toFormat('ZZZZ')}`
}

function card(p: { key: string; name: string; start: DateTime; end?: DateTime; place?: string; placeCoarse?: boolean; image?: string; platform: string; sourceUrl: string; organizerName?: string; priceText?: string; tags?: string[]; category?: string; visibility?: Visibility; excerpt?: string; status?: EventCard['status']; mode?: EventCard['mode'] }): EventCard {
  const missing: EventCard['missing'] = []
  if (!p.image) missing.push('image')
  if (!p.place && p.mode !== 'virtual') missing.push('place')
  if (!p.end) missing.push('end')
  return {
    key: p.key,
    name: p.name,
    startsAt: iso(p.start),
    endsAt: p.end ? iso(p.end) : undefined,
    timezone: TZ,
    allDay: false,
    when: when(p.start, p.end),
    status: p.status ?? 'scheduled',
    mode: p.mode ?? 'inperson',
    place: p.place,
    placeCoarse: p.placeCoarse ?? false,
    imageUrl: p.image,
    imageOrigin: p.image ? 'source' : undefined,
    sourceUrl: p.sourceUrl,
    platform: p.platform,
    organizerName: p.organizerName,
    priceText: p.priceText,
    tags: p.tags ?? [],
    category: p.category,
    visibility: p.visibility ?? 'public',
    excerpt: p.excerpt,
    missing,
    complete: !missing.includes('image') && !missing.includes('place'),
  }
}

// Small inline SVG "posters" so cards have images without a network.
const poster = (a: string, b: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 500'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='800' height='500' fill='url(#g)'/><path d='M0 420 L120 250 L210 360 L330 180 L450 330 L560 240 L680 380 L800 260 L800 500 L0 500Z' fill='rgba(0,0,0,0.18)'/><text x='40' y='90' font-family='Georgia,serif' font-size='44' fill='white'>${label}</text></svg>`)}`

const hosts: Record<string, PublicHost> = {
  dairy: { did: 'did:plc:dairyarts0000000000000001', handle: 'dairyarts.freeskool.directory', displayName: 'Dairy Arts Center', provenanceLevel: 'domain', about: 'Boulder’s home for the arts: theatre, galleries, cinema and music at 26th and Walnut.' },
  etown: { did: 'did:plc:etownhall0000000000000002', handle: 'etown.freeskool.directory', displayName: 'eTown Hall', provenanceLevel: 'source', about: 'A solar-powered venue and radio studio in downtown Boulder.' },
  library: { did: 'did:plc:bpl0000000000000000000003', handle: 'boulderlibrary.freeskool.directory', displayName: 'Boulder Public Library', provenanceLevel: 'email' },
  seeds: { did: 'did:plc:seedlib00000000000000004', handle: 'seedlibrary.freeskool.directory', displayName: 'Front Range Seed Library', provenanceLevel: 'email' },
  hikers: { did: 'did:plc:hikers0000000000000000005', handle: 'flatironshikers.freeskool.directory', displayName: 'Flatirons Hikers', provenanceLevel: 'listed' },
  cohere: { did: 'did:plc:cohere0000000000000000006', handle: 'cohere.freeskool.directory', displayName: 'COhere', provenanceLevel: 'source' },
}

const publicEvents: PublicEvent[] = [
  { did: hosts.dairy!.did, rkey: '3lxa1', host: hosts.dairy!, descriptionMd: 'An evening of short films by Front Range filmmakers, with a Q&A after the screening. Doors at 6:30.', card: card({ key: 'e1', name: 'Boulder Shorts: Autumn Screening', start: at(0, 19), end: at(0, 21), place: 'Dairy Arts Center, 2590 Walnut St', image: poster('#35637f', '#1e2b26', 'Boulder Shorts'), platform: 'squarespace', sourceUrl: 'https://thedairy.org/event/boulder-shorts', priceText: '$12', category: 'film', tags: ['film'], excerpt: 'Short films by Front Range filmmakers, with a Q&A after.' }) },
  { did: hosts.library!.did, rkey: '3lxa2', host: hosts.library!, descriptionMd: 'Bring seeds, take seeds. Learn to save seed from this year’s garden and plan next year’s. Kids welcome.', card: card({ key: 'e2', name: 'Seed Swap and Garden Planning', start: at(1, 10), end: at(1, 13), place: 'Boulder Public Library, Main, 1001 Arapahoe Ave', image: poster('#2e5e48', '#b8641a', 'Seed Swap'), platform: 'luma', sourceUrl: 'https://lu.ma/seedswap', organizerName: 'Front Range Seed Library', priceText: 'Free', category: 'gardening', tags: ['gardening', 'mutual-aid'], excerpt: 'Bring seeds, take seeds. Learn to save seed from this year’s garden.' }) },
  { did: hosts.etown!.did, rkey: '3lxa3', host: hosts.etown!, descriptionMd: 'Live taping of the eTown radio show with two touring acts and a conversation about community solar.', card: card({ key: 'e3', name: 'eTown Live Taping', start: at(2, 19, 30), end: at(2, 22), place: 'eTown Hall, 1535 Spruce St', image: poster('#b8641a', '#35637f', 'eTown Live'), platform: 'wordpress', sourceUrl: 'https://etown.org/events/live-taping', priceText: '$28', category: 'music', tags: ['music', 'radio'], excerpt: 'Live taping with two touring acts.' }) },
  { did: hosts.hikers!.did, rkey: '3lxa4', host: hosts.hikers!, card: card({ key: 'e4', name: 'Sunrise Hike: Royal Arch', start: at(3, 6, 30), end: at(3, 9, 30), place: 'Chautauqua Ranger Cottage', platform: 'meetup', sourceUrl: 'https://www.meetup.com/flatirons-hikers/events/1', priceText: 'Free', category: 'outdoors', tags: ['hiking'], excerpt: 'A steady climb to the arch before the heat. Bring water and a headlamp.' }) },
  { did: hosts.seeds!.did, rkey: '3lxa5', host: hosts.seeds!, descriptionMd: 'A living-room concert with a Denver string trio. Exact address shared with confirmed guests.', card: card({ key: 'e5', name: 'House Concert: Strings in the Living Room', start: at(4, 19), end: at(4, 21), place: 'Boulder, CO', placeCoarse: true, image: poster('#1e2b26', '#2e5e48', 'House Concert'), platform: 'luma', sourceUrl: 'https://lu.ma/houseconcert', priceText: 'Suggested $20', category: 'music', tags: ['music'], visibility: 'gated', excerpt: 'A living-room concert. Exact address shared with confirmed guests.' }), requestState: 'none' },
  { did: hosts.cohere!.did, rkey: '3lxa6', host: hosts.cohere!, descriptionMd: 'Ten days of gatherings across Boulder: workshops, walks, dinners and a closing assembly.', card: card({ key: 'e6', name: 'COhere Opening Circle', start: at(6, 17), end: at(6, 19), place: 'Boulder Civic Area, 1300 Canyon Blvd', image: poster('#35637f', '#b8641a', 'COhere'), platform: 'google', sourceUrl: 'https://calendar.google.com/calendar/event?eid=cohere', priceText: 'Free', category: 'community', tags: ['community'], excerpt: 'Ten days of gatherings across Boulder.' }) },
  { did: hosts.library!.did, rkey: '3lxa7', host: hosts.library!, card: card({ key: 'e7', name: 'Repair Café', start: at(9, 10), end: at(9, 13), place: 'Boulder Public Library, North Branch', image: poster('#2e5e48', '#35637f', 'Repair Café'), platform: 'google', sourceUrl: 'https://calendar.google.com/calendar/event?eid=repair', priceText: 'Free', category: 'community', tags: ['repair'], excerpt: 'Bring a broken thing; leave with a fixed one, or at least a diagnosis.' }) },
  { did: hosts.dairy!.did, rkey: '3lxa8', host: hosts.dairy!, card: card({ key: 'e8', name: 'Gallery Opening: Snowmelt', start: at(12, 18), end: at(12, 20), place: 'Dairy Arts Center, 2590 Walnut St', image: poster('#b8641a', '#1e2b26', 'Snowmelt'), platform: 'squarespace', sourceUrl: 'https://thedairy.org/event/snowmelt', priceText: 'Free', category: 'art', tags: ['art'], status: 'postponed', excerpt: 'Paintings of the Front Range in thaw. Postponed; new date to come.' }) },
  { did: hosts.etown!.did, rkey: '3lxa9', host: hosts.etown!, card: card({ key: 'e9', name: 'Songwriters Circle (online)', start: at(5, 18), end: at(5, 19, 30), platform: 'wordpress', sourceUrl: 'https://etown.org/events/songwriters', priceText: 'Free', category: 'music', mode: 'virtual', excerpt: 'Share a song in progress; get one note of feedback each.' }) },
]

let me: Me | null = {
  host: { id: 'h1', did: hosts.seeds!.did, handle: hosts.seeds!.handle, displayName: 'Front Range Seed Library', email: 'hello@frontrangeseeds.org', door: 'custodial', provenanceLevel: 'email', region: 'boulder', logoUrl: null, createdAt: iso(now.minus({ days: 12 })) },
  capabilities: { canSetPassword: true, canMigrate: true },
}
let signedOutOnce = false

const sources: SourceDetail[] = [
  {
    id: 's1', type: 'luma', platform: 'luma', label: 'Luma calendar cal-Xk3v', url: 'https://lu.ma/frontrangeseeds', status: 'active', defaultVisibility: 'public', lastSyncAt: iso(now.minus({ minutes: 14 })), lastSuccessAt: iso(now.minus({ minutes: 14 })), nextRunAt: iso(now.plus({ minutes: 16 })), consecutiveFailures: 0, lastError: null, counts: { live: 11, cancelled: 1, held: 0 }, claimed: true, createdAt: iso(now.minus({ days: 12 })), tz: TZ, interval: 30,
    rules: [{ match: { titleContains: '[Members]' }, level: 'members', audience: { group: hosts.seeds!.did, minRole: 10 } }],
    syncRuns: [
      { startedAt: iso(now.minus({ minutes: 14 })), finishedAt: iso(now.minus({ minutes: 14 })), ok: true, fetched: 12, published: 0, updated: 1, cancelled: 0, removed: 0, held: 0 },
      { startedAt: iso(now.minus({ minutes: 44 })), finishedAt: iso(now.minus({ minutes: 44 })), ok: true, fetched: 12, published: 0, updated: 0, cancelled: 0, removed: 0, held: 0 },
      { startedAt: iso(now.minus({ hours: 2 })), finishedAt: iso(now.minus({ hours: 2 })), ok: false, fetched: 0, published: 0, updated: 0, cancelled: 0, removed: 0, held: 0, error: { code: 'RateLimited', message: 'Luma asked us to slow down' } },
    ],
  },
  {
    id: 's2', type: 'gcal-public', platform: 'google', label: 'Google Calendar: Board', url: 'https://calendar.google.com/calendar/ical/board%40frontrangeseeds.org/public/basic.ics', status: 'failing', defaultVisibility: 'held', lastSyncAt: iso(now.minus({ hours: 26 })), lastSuccessAt: iso(now.minus({ days: 3 })), nextRunAt: iso(now.plus({ hours: 2 })), consecutiveFailures: 9, lastError: { code: 'SourceUnreachable', message: 'Your calendar is no longer public.' }, counts: { live: 0, cancelled: 0, held: 4 }, claimed: true, createdAt: iso(now.minus({ days: 9 })), tz: TZ, interval: 15,
    rules: [], syncRuns: [{ startedAt: iso(now.minus({ hours: 26 })), finishedAt: iso(now.minus({ hours: 26 })), ok: false, fetched: 0, published: 0, updated: 0, cancelled: 0, removed: 0, held: 0, error: { code: 'SourceUnreachable', message: 'HTTP 404' } }],
  },
]

const ledger: LedgerEvent[] = [
  { id: 'ev1', sourceId: 's1', externalId: 'evt-seedswap@events.lu.ma', state: 'live', visibility: 'public', visibilitySource: 'host-default', card: publicEvents[1]!.card, atUri: `at://${hosts.seeds!.did}/community.lexicon.calendar.event/3lxa2`, atCid: 'bafy1', firstSeen: iso(now.minus({ days: 12 })), lastSeen: iso(now.minus({ minutes: 14 })), override: null },
  { id: 'ev2', sourceId: 's1', externalId: 'evt-house@events.lu.ma', state: 'live', visibility: 'gated', visibilitySource: 'rule', card: publicEvents[4]!.card, atUri: `at://${hosts.seeds!.did}/community.lexicon.calendar.event/3lxa5`, teaserAtUri: `at://${hosts.seeds!.did}/community.lexicon.calendar.event/3lxa5`, spaceUri: `at://${hosts.seeds!.did}/coop.lexicon.space.event.detail/3lxa5`, firstSeen: iso(now.minus({ days: 3 })), lastSeen: iso(now.minus({ minutes: 14 })), override: null },
  { id: 'ev3', sourceId: 's1', externalId: 'evt-workday@events.lu.ma', state: 'cancelled', visibility: 'public', card: card({ key: 'ev3', name: 'Garden Workday', start: at(-2, 9), end: at(-2, 12), place: 'Growing Gardens, 1630 Hawthorn Ave', platform: 'luma', sourceUrl: 'https://lu.ma/workday', status: 'cancelled' }), atUri: `at://${hosts.seeds!.did}/community.lexicon.calendar.event/3lxa0`, firstSeen: iso(now.minus({ days: 10 })), lastSeen: iso(now.minus({ days: 1 })), missingSince: iso(now.minus({ days: 1 })), override: null },
  { id: 'ev4', sourceId: 's2', externalId: 'board-1@google.com', state: 'held', visibility: 'held', visibilitySource: 'source-signal', card: card({ key: 'ev4', name: 'Board meeting', start: at(8, 18), end: at(8, 20), place: '1234 Elm St, Boulder', platform: 'google', sourceUrl: 'https://calendar.google.com/calendar/event?eid=board1', visibility: 'held' }), firstSeen: iso(now.minus({ days: 9 })), lastSeen: iso(now.minus({ days: 3 })), override: null },
]

const confirmations: Confirmation[] = [
  {
    id: 'c1', kind: 'extracted', createdAt: iso(now.minus({ hours: 3 })), expiresAt: iso(now.plus({ days: 6 })), channel: 'email', sourceId: null,
    cards: [{ ...card({ key: 'x1', name: 'Repair café, first Saturdays', start: at(11, 10), end: at(11, 13), place: 'the library', platform: 'extract', sourceUrl: '' }), needsConfirmation: true, confidence: { name: 0.96, start: 0.71, end: 0.65, place: 0.58, recurrence: 0.8 } }],
    proposed: { recurrenceText: 'first Saturdays', rrule: 'FREQ=MONTHLY;BYDAY=1SA', year: now.year, timezone: TZ },
    evidence: { name: 'Repair café, first Saturdays 10–1 at the library', start: 'first Saturdays 10', place: 'at the library' },
    nextDates: [iso(at(11, 10)), iso(at(39, 10)), iso(at(67, 10))],
  },
  {
    id: 'c2', kind: 'widen', createdAt: iso(now.minus({ minutes: 40 })), expiresAt: iso(now.plus({ days: 13 })), channel: 'console', sourceId: 's2',
    cards: [ledger[3]!.card], proposed: { from: 'held', to: 'public', reason: 'You changed the source default to Public. 1 event that was held would become public.' }, evidence: {},
  },
]

let keys: ApiKey[] = [{ id: 'k1', name: 'Zapier', createdAt: iso(now.minus({ days: 5 })), lastUsedAt: iso(now.minus({ hours: 5 })) }]
let inbound = { email: 'add+7f3k2q@in.freeskool.directory', webhookUrl: 'https://tributary.freeskool.directory/api/webhook/7f3k2q', webhookSecret: 'whsec_9f1d0c2a7b3e4d5f6a7b8c9d' }
const previews = new Map<string, Preview>()
let roles: OrgRole[] = [{ did: 'did:plc:editorexampleaaaaaaaaaa', role: 'editor' }]
const managed: ManagedHost[] = [
  { id: 'h-dairy', handle: hosts.dairy!.handle, displayName: hosts.dairy!.displayName, role: 'editor' },
  { id: 'h-library', handle: hosts.library!.handle, displayName: hosts.library!.displayName, role: 'viewer' },
]
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const verifyAttempts = new Map<string, number>()

const requireMe = () => {
  if (!me) throw new ApiError('Unauthorized', 'Sign in to continue.', 401)
  return me
}

function detectFor(input: string, file?: File): DetectMatch[] {
  if (file) {
    if (/\.ics$/i.test(file.name)) return [{ type: 'upload', platform: 'file', confidence: 0.99, label: file.name, hint: { kind: 'ics' } }]
    if (/^image\//.test(file.type) || /\.pdf$/i.test(file.name)) return [{ type: 'extract', platform: 'flyer', confidence: 0.9, label: file.name, hint: { kind: 'flyer' }, note: 'We will read the flyer and ask you to confirm before anything is published.' }]
    return [{ type: 'upload', platform: 'file', confidence: 0.6, label: file.name, hint: { kind: 'csv' } }]
  }
  const s = input.trim()
  if (/lu\.ma|luma\.com/i.test(s)) return [{ type: 'luma', platform: 'luma', confidence: 0.98, label: 'Luma calendar', hint: { url: s } }, { type: 'jsonld-page', platform: 'luma', confidence: 0.4, label: 'Single Luma event page', hint: { url: s } }]
  if (/meetup\.com/i.test(s)) return [{ type: 'meetup', platform: 'meetup', confidence: 0.97, label: 'Meetup group', hint: { url: s } }]
  if (/calendar\.google\.com|\.ics(\?|$)|^webcal:/i.test(s)) return [{ type: 'gcal-public', platform: 'google', confidence: 0.95, label: 'Google Calendar (public)', hint: { url: s } }, { type: 'ics', platform: 'ics', confidence: 0.7, label: 'Calendar feed (.ics)', hint: { url: s } }]
  if (/eventbrite\.com/i.test(s)) return [{ type: 'jsonld-page', platform: 'eventbrite', confidence: 0.9, label: 'Eventbrite page', hint: { url: s } }]
  if (/docs\.google\.com\/spreadsheets/i.test(s)) return [{ type: 'sheet', platform: 'sheet', confidence: 0.95, label: 'Google Sheet', hint: { sheetId: 'mock-sheet', gid: '0' }, note: 'The sheet must be shared with "anyone with the link". We will ask you to match the columns.' }]
  if (/facebook\.com|partiful\.com/i.test(s)) return [{ type: 'extract', platform: 'unsupported', confidence: 0.3, label: 'Not readable from here', hint: { url: s }, note: 'Facebook and Partiful pages cannot be read without logging in. Forward the invite email, drop a screenshot, or describe the event instead.' }]
  if (/^https?:\/\//i.test(s)) return [{ type: 'tribe', platform: 'wordpress', confidence: 0.8, label: 'WordPress Events Calendar', hint: { url: s } }, { type: 'jsonld-page', platform: 'web', confidence: 0.5, label: 'Event page', hint: { url: s } }]
  return [{ type: 'extract', platform: 'text', confidence: 0.85, label: 'Described event', hint: { text: s }, note: 'We will turn this into an event and ask you to confirm before it is published.' }]
}

const CSV_HEADERS = ['Title', 'Date', 'Start time', 'End time', 'Venue', 'Details', 'Link', 'Poster']
const CSV_SAMPLE = [
  { Title: 'Seed Swap', Date: '2026-10-04', 'Start time': '10:00', 'End time': '13:00', Venue: 'Boulder Public Library', Details: 'Bring seeds, take seeds.', Link: 'https://frontrangeseeds.org/swap', Poster: '' },
  { Title: 'Garden Planning Night', Date: '2026-10-12', 'Start time': '18:30', 'End time': '20:00', Venue: 'Growing Gardens', Details: 'Plan next year together.', Link: '', Poster: '' },
  { Title: 'Harvest Potluck', Date: '2026-10-25', 'Start time': '17:00', 'End time': '', Venue: '', Details: 'Bring a dish.', Link: '', Poster: '' },
]

function csvInfoFor(mapping?: Record<string, string | null>): CsvInfo {
  const m: CsvInfo['mapping'] = mapping ?? { name: 'Title', start: 'Date', startTime: 'Start time', end: null, endTime: 'End time', location: 'Venue', description: 'Details', url: 'Link', image: 'Poster', price: null, tags: null, id: null }
  const used = new Set(Object.values(m).filter((v): v is string => !!v))
  return { headers: CSV_HEADERS, mapping: m, sample: CSV_SAMPLE, unmapped: CSV_HEADERS.filter((h) => !used.has(h)) }
}

function previewFor(match: DetectMatch): Preview {
  const id = `pv_${Math.random().toString(36).slice(2, 9)}`
  const structured = match.type !== 'extract'
  const csv = (match.type === 'upload' && match.hint.kind === 'csv') || match.type === 'sheet' ? csvInfoFor(match.hint.mapping as Record<string, string | null> | undefined) : undefined
  const cards = structured
    ? publicEvents.slice(0, 6).map((e, i) => ({ ...e.card, key: `p${i}`, platform: match.platform, visibility: (i === 4 ? 'held' : 'public') as Visibility }))
    : [{ ...card({ key: 'x', name: 'Repair café, first Saturdays', start: at(11, 10), end: at(11, 13), place: 'the library', platform: 'extract', sourceUrl: '' }), needsConfirmation: true, confidence: { name: 0.96, start: 0.7, place: 0.55 } }]
  const p: Preview = {
    previewId: id,
    source: { type: match.type, platform: match.platform, label: match.label, fingerprint: `${match.type}:${String(match.hint.url ?? match.hint.text ?? 'x').toLowerCase()}`, tz: TZ, alreadyConnected: false },
    count: structured ? 23 : 1,
    upcoming: structured ? 23 : 1,
    cards,
    notes: structured ? ['4 events have no image; we will use your logo.', '1 event is marked private at the source and will be held.'] : ['The year and the recurrence are guesses. Check them before publishing.'],
    defaultVisibility: 'public',
    signals: { private: structured ? 1 : 0, conferenceLinks: structured ? 2 : 0 },
    expiresAt: iso(now.plus({ hours: 1 })),
    needsConfirmation: !structured,
    ...(csv ? { csv, count: csv.mapping.name ? 3 : 0, upcoming: csv.mapping.name ? 3 : 0, notes: csv.mapping.name ? ['Check the column matching below; the cards update as you change it.'] : ['Tell us which column holds the event name.'] } : {}),
  }
  previews.set(id, p)
  return p
}

export const mockApi: Api = {
  async publicConfig() {
    await delay(80)
    return { region: { slug: 'boulder', name: 'Boulder', tz: TZ }, handleDomain: 'boulderevents.directory', brand: 'Boulder Events Directory', adapterName: 'Tributary' }
  },
  async publicEvents({ q, category }) {
    await delay()
    let list = publicEvents.filter((e) => e.card.visibility === 'public' || (me && e.card.visibility === 'gated'))
    if (category) list = list.filter((e) => e.card.category === category)
    if (q) list = list.filter((e) => `${e.card.name} ${e.host.displayName} ${e.card.place ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    return { events: list.map((e) => (e.card.visibility === 'gated' && me ? { ...e, audienceName: 'confirmed guests' } : e)), cursor: null }
  },
  async publicEventCounts({ category }) {
    await delay()
    const days: Record<string, number> = {}
    for (const e of publicEvents) {
      if (e.card.visibility !== 'public') continue
      if (category && e.card.category !== category) continue
      const day = e.card.startsAt.slice(0, 10)
      days[day] = (days[day] ?? 0) + 1
    }
    return { days }
  },
  async publicEvent(did, rkey) {
    await delay()
    const e = publicEvents.find((x) => x.did === did && x.rkey === rkey)
    if (!e) throw new ApiError('NotFound', 'Nothing is here.', 404)
    return e
  },
  async requestPlace(did, rkey) {
    requireMe()
    await delay()
    const e = publicEvents.find((x) => x.did === did && x.rkey === rkey)
    if (e) e.requestState = 'pending'
    return { state: 'pending' }
  },
  async publicHost(handle) {
    await delay()
    const host = Object.values(hosts).find((h) => h.handle === handle)
    if (!host) throw new ApiError('NotFound', 'Nothing is here.', 404)
    return { host, events: publicEvents.filter((e) => e.host.handle === handle && e.card.visibility === 'public') }
  },
  async detect(input, file) {
    await delay(500)
    return { matches: detectFor(input, file), preview: null }
  },
  async preview(match) {
    await delay(900)
    return previewFor(match)
  },
  async getPreview(id) {
    await delay(100)
    const p = previews.get(id)
    if (!p) throw new ApiError('NotFound', 'That preview has expired. Paste the link again.', 404)
    return p
  },
  async signup(body) {
    await delay(600)
    if (!/@/.test(body.email)) throw new ApiError('InvalidInput', 'That does not look like an email address.', 400)
    return { did: null, handle: `${body.handle}.freeskool.directory`, status: 'check-your-email', verifyUrl: `/auth/verify?token=mock-${body.handle}` }
  },
  async checkHandle(label) {
    await delay(200)
    if (!/^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$/.test(label)) return { ok: false, reason: 'invalid' }
    if (['admin', 'boulder', 'pds', 'www', 'api'].includes(label)) return { ok: false, reason: 'reserved', suggestions: [`${label}-events`, `${label}2`] }
    if (label === 'dairyarts') return { ok: false, reason: 'taken', suggestions: ['dairyartscenter', 'thedairy'] }
    return { ok: true }
  },
  async login(email) {
    await delay(500)
    if (!/@/.test(email)) throw new ApiError('InvalidInput', 'That does not look like an email address.', 400)
    return { status: 'check-your-email', verifyUrl: '/auth/verify?token=mock-login' }
  },
  async verify(token) {
    await delay(400)
    if (!token.startsWith('mock-')) throw new ApiError('NotFound', 'That link has expired. Ask for a new one.', 404)
    if (!me || signedOutOnce) {
      me = { host: { id: 'h1', did: hosts.seeds!.did, handle: hosts.seeds!.handle, displayName: 'Front Range Seed Library', email: 'hello@frontrangeseeds.org', door: 'custodial', provenanceLevel: 'email', region: 'boulder', createdAt: iso(now) }, capabilities: { canSetPassword: true, canMigrate: true } }
    }
    return { ok: true, redirect: '/dashboard?welcome=1' }
  },
  async oauthStart(body) {
    await delay(300)
    if (!body.handle.includes('.')) throw new ApiError('InvalidInput', 'Enter a full handle, like name.bsky.social.', 400)
    return { redirectUrl: `/connect?error=scopes&handle=${encodeURIComponent(body.handle)}` }
  },
  async me() {
    await delay(60)
    return requireMe()
  },
  async logout() {
    me = null
    signedOutOnce = true
  },
  async takeControl() {
    requireMe()
    await delay(400)
    return { status: 'email-sent' }
  },
  async revokeSync() {
    requireMe()
    await delay(300)
    for (const s of sources) s.status = 'paused'
    return { status: 'revoked' }
  },
  async deleteEverything() {
    requireMe()
    await delay(600)
    me = null
    signedOutOnce = true
  },
  exportUrl: () => 'data:application/json,{}',
  async sources() {
    requireMe()
    await delay()
    return { sources: sources.map(({ rules: _r, syncRuns: _s, ...s }) => s) }
  },
  async connectEventbrite(token) {
    requireMe()
    await delay(800)
    if (!/^[A-Z0-9]{16,}$/i.test(token)) throw new ApiError('InvalidInput', 'That does not look like an Eventbrite private token. It is a 20-character code on the API keys page.', 400)
    const existing = sources.find((x) => x.type === 'eventbrite')
    if (existing) return { source: existing, created: false }
    const s: SourceDetail = { id: `s${sources.length + 1}`, type: 'eventbrite', platform: 'eventbrite', label: 'Eventbrite: Front Range Seed Library', url: 'https://www.eventbrite.com/o/front-range-seed-library', status: 'active', defaultVisibility: 'public', lastSyncAt: null, lastSuccessAt: null, nextRunAt: iso(now.plus({ minutes: 1 })), consecutiveFailures: 0, lastError: null, counts: { live: 0, cancelled: 0, held: 0 }, claimed: true, createdAt: iso(now), tz: TZ, interval: 60, rules: [], syncRuns: [] }
    sources.push(s)
    return { source: s, created: true }
  },
  async addSource(body) {
    requireMe()
    await delay(700)
    const p = body.previewId ? previews.get(body.previewId) : undefined
    const s: SourceDetail = { id: `s${sources.length + 1}`, type: p?.source.type ?? body.match?.type ?? 'ics', platform: p?.source.platform ?? body.match?.platform ?? 'ics', label: p?.source.label ?? body.match?.label ?? 'New source', status: 'active', defaultVisibility: body.defaultVisibility, lastSyncAt: null, lastSuccessAt: null, nextRunAt: iso(now.plus({ minutes: 1 })), consecutiveFailures: 0, lastError: null, counts: { live: 0, cancelled: 0, held: 0 }, claimed: true, createdAt: iso(now), tz: TZ, interval: 30, rules: [], syncRuns: [] }
    sources.push(s)
    return s
  },
  async verifySource(id) {
    requireMe()
    await delay(300)
    const s = sources.find((x) => x.id === id)
    if (!s) throw new ApiError('NotFound', 'Nothing is here.', 404)
    verifyAttempts.set(id, 0)
    return { token: `tributary-verify-${id}k3m9x2`, instructions: 'Paste this token anywhere in your calendar’s title or description at the source, wait a minute, then check.' }
  },
  async checkVerification(id) {
    const who = requireMe()
    await delay(900)
    const n = (verifyAttempts.get(id) ?? 0) + 1
    verifyAttempts.set(id, n)
    if (n < 2) return { verified: false, reason: 'The token was not found in the feed yet; feeds can take a few minutes to update.' }
    if (who.host.provenanceLevel === 'email') who.host.provenanceLevel = 'source'
    return { verified: true, provenanceLevel: who.host.provenanceLevel }
  },
  async source(id) {
    requireMe()
    await delay()
    const s = sources.find((x) => x.id === id)
    if (!s) throw new ApiError('NotFound', 'Nothing is here.', 404)
    return s
  },
  async patchSource(id, body) {
    requireMe()
    await delay(300)
    const s = sources.find((x) => x.id === id)
    if (!s) throw new ApiError('NotFound', 'Nothing is here.', 404)
    if (body.defaultVisibility && rank(body.defaultVisibility) > rank(s.defaultVisibility) && s.counts.held + s.counts.live > 0) return { pendingConfirmation: s.counts.held || 1 }
    if (body.defaultVisibility) s.defaultVisibility = body.defaultVisibility
    if (body.paused !== undefined) s.status = body.paused ? 'paused' : 'active'
    if (body.interval) s.interval = body.interval
    if (body.tz) s.tz = body.tz
    return s
  },
  async syncSource(id) {
    requireMe()
    await delay(300)
    const s = sources.find((x) => x.id === id)
    if (s) {
      s.lastSyncAt = iso(DateTime.now())
      s.syncRuns.unshift({ startedAt: iso(DateTime.now()), finishedAt: iso(DateTime.now()), ok: s.status !== 'failing', fetched: 12, published: 0, updated: 0, cancelled: 0, removed: 0, held: 0, error: s.status === 'failing' ? s.lastError : null })
    }
    return { jobId: 'job_mock' }
  },
  async removeSource(id) {
    requireMe()
    await delay(400)
    const i = sources.findIndex((x) => x.id === id)
    const removed = i >= 0 ? sources[i]!.counts.live : 0
    if (i >= 0) sources.splice(i, 1)
    return { removed }
  },
  async rules(id) {
    requireMe()
    return { rules: sources.find((x) => x.id === id)?.rules ?? [] }
  },
  async putRules(id, rules: Rule[]) {
    requireMe()
    await delay(300)
    const s = sources.find((x) => x.id === id)
    if (s) s.rules = rules
    return { rules }
  },
  async events(params) {
    requireMe()
    await delay()
    let list = ledger
    if (params.sourceId) list = list.filter((e) => e.sourceId === params.sourceId)
    if (params.state) list = list.filter((e) => e.state === params.state)
    return { events: list, cursor: null }
  },
  async patchEvent(id, body) {
    requireMe()
    await delay(300)
    const e = ledger.find((x) => x.id === id)
    if (!e) throw new ApiError('NotFound', 'Nothing is here.', 404)
    if (body.visibility && rank(body.visibility) > rank(e.visibility)) return { pendingConfirmation: 'c3' }
    e.override = { ...(e.override ?? {}), ...body }
    if (body.visibility) e.visibility = body.visibility
    return e
  },
  async republish() {
    requireMe()
    await delay(200)
  },
  async confirmations() {
    requireMe()
    await delay()
    return { items: confirmations }
  },
  async confirmation(id) {
    await delay()
    const c = confirmations.find((x) => x.id === id)
    if (!c) throw new ApiError('NotFound', 'Nothing is here.', 404)
    return c
  },
  async resolveConfirmation(id) {
    await delay(400)
    const i = confirmations.findIndex((x) => x.id === id)
    if (i >= 0) confirmations.splice(i, 1)
  },
  async confirmationFromPreview(previewId) {
    requireMe()
    await delay(400)
    const p = previews.get(previewId)
    if (!p) throw new ApiError('NotFound', 'That preview has expired. Paste the link again.', 404)
    const c: Confirmation = { id: `c${confirmations.length + 3}`, kind: 'extracted', createdAt: iso(DateTime.now()), expiresAt: iso(now.plus({ days: 14 })), channel: 'console', sourceId: null, cards: p.cards, proposed: {}, evidence: {} }
    confirmations.unshift(c)
    return { id: c.id }
  },
  async keys() {
    requireMe()
    return { keys }
  },
  async createKey(name) {
    requireMe()
    await delay(300)
    const k: ApiKey = { id: `k${keys.length + 1}`, name, createdAt: iso(DateTime.now()), key: `tb_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}` }
    keys = [...keys, { ...k, key: undefined }]
    return k
  },
  async deleteKey(id) {
    requireMe()
    keys = keys.filter((k) => k.id !== id)
  },
  async inbound() {
    requireMe()
    return inbound
  },
  async rotateInbound() {
    requireMe()
    await delay(300)
    inbound = { email: `add+${Math.random().toString(36).slice(2, 8)}@in.freeskool.directory`, webhookUrl: `https://tributary.freeskool.directory/api/webhook/${Math.random().toString(36).slice(2, 8)}`, webhookSecret: `whsec_${Math.random().toString(36).slice(2)}` }
    return inbound
  },
  async audience(eventId) {
    requireMe()
    await delay()
    return {
      spaceUri: `at://${hosts.seeds!.did}/coop.lexicon.space.event.detail/${eventId}`,
      policy: 'any(confirmedFor(this), authorityOnly, memberRole(authority, atLeast: 20))',
      members: 7,
      invites: [{ id: 'i1', kind: 'read-join', expiresAt: iso(now.plus({ days: 2 })), usesLeft: 14 }],
      requests: [
        { id: 'r1', did: 'did:plc:guest1', handle: 'maple.bsky.social', requestedAt: iso(now.minus({ hours: 5 })), state: 'pending' },
        { id: 'r2', did: 'did:plc:guest2', handle: 'wren.freeskool.directory', requestedAt: iso(now.minus({ days: 1 })), state: 'approved' },
      ],
    }
  },
  async createInvite(eventId, body) {
    requireMe()
    await delay(300)
    return { id: `i${Math.random().toString(36).slice(2, 6)}`, url: `https://tributary.freeskool.directory/i/${body.kind}-${Math.random().toString(36).slice(2, 12)}` }
  },
  async deleteInvite() {
    requireMe()
    await delay(200)
  },
  async invitePeople(_e, body) {
    requireMe()
    await delay(400)
    return { resolved: body.handles.map((h) => ({ handle: h, did: `did:plc:${h.replace(/\W/g, '').slice(0, 16)}` })), pendingEmails: body.emails }
  },
  async decideRequest() {
    requireMe()
    await delay(200)
  },
  async report(body) {
    await delay(300)
    if (!body.atUri) throw new ApiError('InvalidInput', 'That listing could not be identified.', 400)
    return { message: 'Thank you. A steward will look at this.' }
  },
  async redeemInvite(token) {
    requireMe()
    await delay(400)
    if (token === 'expired') throw new ApiError('NotFound', 'This link has expired or has been used up. Ask the host for a new one.', 404)
    const gated = publicEvents.find((e) => e.card.visibility === 'gated')
    if (gated) {
      gated.requestState = 'approved'
      gated.revealed = { exactLocation: '2130 Mapleton Ave, Boulder, CO 80304' }
    }
    return { spaceUri: `at://${hosts.seeds!.did}/coop.lexicon.space.event.invite/3lxa5`, kind: 'read-join', role: 10 }
  },
  async roles() {
    const m = requireMe()
    await delay(120)
    return { roles: [{ did: m.host.did, role: 'owner' }, ...roles] }
  },
  async addRole(body) {
    requireMe()
    await delay(300)
    if (!body.handle.includes('.')) throw new ApiError('InvalidInput', 'That handle could not be resolved.', 400)
    const did = `did:plc:${body.handle.replace(/[^a-z0-9]/g, '').slice(0, 24).padEnd(24, 'x')}`
    roles = [...roles.filter((r) => r.did !== did), { did, role: body.role }]
  },
  async removeRole(did) {
    requireMe()
    await delay(200)
    roles = roles.filter((r) => r.did !== did)
  },
  async managed() {
    requireMe()
    await delay(120)
    return { hosts: managed }
  },

  async stewardReports(all) {
    requireMe()
    await delay(200)
    return { reports: all ? reports : reports.filter((r) => !r.resolvedAt) }
  },
  async resolveReport(id, action) {
    requireMe()
    await delay(300)
    const r = reports.find((x) => x.id === id)
    if (!r) throw new ApiError('NotFound', 'Nothing is here.', 404)
    if (r.resolvedAt) throw new ApiError('Conflict', 'This report was already handled.', 409)
    r.resolvedAt = new Date().toISOString()
    r.resolution = action
    if (action !== 'dismiss' && r.event) r.event.hidden = true
    return { ok: true, resolution: action }
  },
}

const reportUri = (h: PublicHost, rkey: string) => `at://${h.did}/community.lexicon.calendar.event/${rkey}`
const reports: StewardReport[] = [
  { id: 'rep_1', atUri: reportUri(hosts.hikers!, '3lx1'), reason: 'wrong-details', details: 'The trailhead moved to the south lot this season.', createdAt: iso(now.minus({ hours: 3 })), resolvedAt: null, resolution: null, event: { id: 'ev_h1', name: 'Sunrise hike, Chautauqua', state: 'live', visibility: 'public', hidden: false }, host: { handle: hosts.hikers!.handle, displayName: hosts.hikers!.displayName, door: 'listed' } },
  { id: 'rep_2', atUri: reportUri(hosts.seeds!, '3lx2'), reason: 'private-information', details: 'The description has someone’s phone number in it.', createdAt: iso(now.minus({ days: 1, hours: 2 })), resolvedAt: null, resolution: null, event: { id: 'ev_s1', name: 'Seed Swap and Garden Planning', state: 'live', visibility: 'public', hidden: false }, host: { handle: hosts.seeds!.handle, displayName: hosts.seeds!.displayName, door: 'custodial' } },
  { id: 'rep_3', atUri: reportUri(hosts.library!, '3lx3'), reason: 'spam', details: null, createdAt: iso(now.minus({ days: 2 })), resolvedAt: null, resolution: null, event: { id: 'ev_l1', name: 'Make money fast seminar', state: 'live', visibility: 'public', hidden: false }, host: { handle: hosts.library!.handle, displayName: hosts.library!.displayName, door: 'custodial' } },
  { id: 'rep_4', atUri: reportUri(hosts.etown!, '3lx4'), reason: 'not-an-event', details: 'This is a fundraising page.', createdAt: iso(now.minus({ days: 6 })), resolvedAt: iso(now.minus({ days: 5 })), resolution: 'dismiss', event: { id: 'ev_e1', name: 'eTown Hall Sessions', state: 'live', visibility: 'public', hidden: false }, host: { handle: hosts.etown!.handle, displayName: hosts.etown!.displayName, door: 'oauth' } },
]

/** Higher is more visible. Widening (up) needs confirmation; narrowing (down) applies at once. */
function rank(v: Visibility): number {
  return { held: 0, invite: 1, members: 2, gated: 3, unlisted: 4, public: 5 }[v]
}
