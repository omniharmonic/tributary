/**
 * The ICS wrapper over ical.js (architecture §4.2). Tested against the golden corpus in
 * `fixtures/ics` rather than trusted: known upstream bugs touch exactly the hard cases
 * (recurrence exceptions, timezone iteration), so the corpus is the contract.
 *
 * Rules implemented here:
 *  - timezone precedence: per-property TZID (with its VTIMEZONE) → X-WR-TIMEZONE →
 *    source default; floating times are interpreted in that order and reported with
 *    `tz` undefined only when nothing in the feed said which zone they are in, so the
 *    normalizer flags them; Windows/Outlook zone names are mapped to IANA (tz.ts)
 *  - all-day (VALUE=DATE) → `allDay: true` with date strings
 *  - recurrence: RRULE/RDATE minus EXDATE with RECURRENCE-ID overrides, expanded
 *    inside the window; identity `UID` + `occurrence = <original start, UTC ISO>`
 *  - STATUS:CANCELLED → cancelled; CLASS → sourcePrivacy; ATTENDEE never read
 *  - X-ALT-DESC;FMTTYPE=text/html preferred over DESCRIPTION
 *  - images: ATTACH;FMTTYPE=image/*, X-TKF-FEATURED-IMAGE (Tockify), X-WR-IMAGE, IMAGE
 *  - the observed window (min/max start actually seen) is reported so missing-detection
 *    applies only inside it
 *  - a malformed VEVENT is dropped and counted; the rest of the feed still parses
 */
import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import { isConferenceUrl, type EventStatus, type RawEvent, type SourcePrivacy } from '@tributary/event-model'
import { resolveTzid } from './tz.js'

export interface ParseIcsOptions {
  window: { from: Date; to: Date }
  defaultTz: string
  now?: Date
  /** Hard cap on expanded occurrences per recurring event. */
  maxOccurrences?: number
}

export interface ParseIcsResult {
  events: RawEvent[]
  meta: { title?: string; description?: string; tz?: string; prodId?: string; url?: string }
  /** The feed is the full current set within its observed window. */
  complete: boolean
  window: { from?: Date; to?: Date }
  uidChurnSuspected?: boolean
  dropped: number
}

type Component = InstanceType<typeof ICAL.Component>
type Property = InstanceType<typeof ICAL.Property>
type Time = InstanceType<typeof ICAL.Time>
type Event = InstanceType<typeof ICAL.Event>

const ONE_HOUR = 3_600_000
const ONE_DAY = 24 * ONE_HOUR

/** A wall-clock reading of an ical.js Time plus how the feed said to interpret it. */
interface Wall {
  /** `YYYY-MM-DDTHH:mm:ss` or `YYYY-MM-DD` for dates. */
  wall: string
  isDate: boolean
  isUtc: boolean
  /** The resolved IANA zone from TZID, when there was one we could map. */
  zone?: string
}

function wallOf(t: Time, prop?: Property | null): Wall {
  const isDate = t.isDate
  const wall = t.toString().replace(/Z$/, '')
  const isUtc = !isDate && (t.zone?.tzid === 'UTC' || t.zone === ICAL.Timezone.utcTimezone)
  const tzidParam = prop?.getParameter('tzid') as string | undefined
  const fromParam = resolveTzid(tzidParam)
  const fromZone = !isUtc && t.zone && t.zone.tzid !== 'floating' ? resolveTzid(t.zone.tzid) : undefined
  return { wall, isDate, isUtc, zone: fromParam ?? fromZone }
}

/** The instant of a wall reading, given the zone precedence already applied. */
function instantOf(w: Wall, zone: string): DateTime {
  if (w.isDate) return DateTime.fromISO(w.wall, { zone }).startOf('day')
  if (w.isUtc) return DateTime.fromISO(w.wall, { zone: 'utc' })
  return DateTime.fromISO(w.wall, { zone })
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s || undefined
}

/**
 * ical.js exposes duration-only events (DTSTART + DURATION) through `Event.endDate`,
 * and answers the start itself for a timed event with no DTEND: that is "no end".
 */
function endTime(ev: Event): Time | undefined {
  try {
    const end = ev.endDate ?? undefined
    if (!end) return undefined
    if (!end.isDate && end.compare(ev.startDate) === 0) return undefined
    return end
  } catch {
    return undefined
  }
}

const URL_RE = /https?:\/\/[^\s<>()\]"']+[^\s<>()\]"'.,;:!?]/g

/** The first URL in a description that is not a conference link (those are gated, never the RSVP target). */
function firstPlainUrl(text: string | undefined): string | undefined {
  if (!text) return undefined
  for (const m of text.matchAll(URL_RE)) if (!isConferenceUrl(m[0])) return m[0]
  return undefined
}

function imageFrom(comp: Component): string | undefined {
  for (const p of comp.getAllProperties('attach')) {
    const fmt = String(p.getParameter('fmttype') ?? '').toLowerCase()
    const v = p.getFirstValue()
    const s = typeof v === 'string' ? v : undefined
    if (s && /^https?:\/\//.test(s) && (fmt.startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(s))) return s
  }
  for (const name of ['x-tkf-featured-image', 'x-wr-image', 'image', 'x-image', 'x-microsoft-cdo-image']) {
    const v = comp.getFirstPropertyValue(name)
    const s = typeof v === 'string' ? v.trim() : undefined
    if (s && /^https?:\/\//.test(s)) return s
  }
  return undefined
}

function statusOf(comp: Component): EventStatus | undefined {
  const s = str(comp.getFirstPropertyValue('status'))?.toUpperCase()
  if (s === 'CANCELLED') return 'cancelled'
  return undefined
}

function privacyOf(comp: Component): SourcePrivacy | undefined {
  const c = str(comp.getFirstPropertyValue('class'))?.toUpperCase()
  if (c === 'PRIVATE') return 'private'
  if (c === 'CONFIDENTIAL') return 'confidential'
  if (c === 'PUBLIC') return 'public'
  return undefined
}

function categoriesOf(comp: Component): string[] | undefined {
  const out: string[] = []
  for (const p of comp.getAllProperties('categories')) {
    for (const v of p.getValues()) {
      const s = str(v)
      if (s) out.push(...s.split(',').map((x) => x.trim()).filter(Boolean))
    }
  }
  return out.length ? [...new Set(out)] : undefined
}

function organizerOf(comp: Component): string | undefined {
  const p = comp.getFirstProperty('organizer')
  if (!p) return undefined
  const cn = str(p.getParameter('cn'))
  if (cn) return cn.replace(/^"|"$/g, '')
  const v = str(p.getFirstValue())
  // A bare mailto: is a contact, not a name; never surface it.
  if (!v || /^mailto:/i.test(v)) return undefined
  return v
}

function descriptionOf(comp: Component): { description?: string; descriptionIsHtml?: boolean } {
  for (const p of comp.getAllProperties('x-alt-desc')) {
    const fmt = String(p.getParameter('fmttype') ?? '').toLowerCase()
    const v = str(p.getFirstValue())
    if (v && (fmt === 'text/html' || /<[a-z][\s\S]*>/i.test(v))) return { description: v, descriptionIsHtml: true }
  }
  const d = str(comp.getFirstPropertyValue('description'))
  if (!d) return {}
  // Some WordPress feeds put HTML straight into DESCRIPTION.
  const isHtml = /<(p|br|a|div|ul|ol|li|b|i|strong|em|h[1-6]|span)\b[^>]*>/i.test(d)
  return { description: d, descriptionIsHtml: isHtml }
}

function geoOf(comp: Component): { lat: number; lon: number } | undefined {
  const g = comp.getFirstPropertyValue('geo') as unknown
  if (Array.isArray(g) && g.length === 2) {
    const lat = Number(g[0])
    const lon = Number(g[1])
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) return { lat, lon }
  } else if (typeof g === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)[;,](-?\d+(?:\.\d+)?)$/.exec(g.trim())
    if (m) {
      const lat = Number(m[1])
      const lon = Number(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) return { lat, lon }
    }
  }
  return undefined
}

function lastModifiedOf(comp: Component): string | undefined {
  const v = comp.getFirstPropertyValue('last-modified') as Time | null
  if (!v || typeof v !== 'object' || !('toJSDate' in v)) return undefined
  try {
    return v.toJSDate().toISOString()
  } catch {
    return undefined
  }
}

/** Register every VTIMEZONE so TZID references resolve; unknown names stay floating and go through tz.ts. */
function registerTimezones(cal: Component): void {
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    try {
      const tzid = tz.getFirstPropertyValue('tzid')
      if (typeof tzid === 'string' && tzid) ICAL.TimezoneService.register(tz, tzid)
    } catch {
      /* a broken VTIMEZONE must not take the feed down */
    }
  }
}

const CONTENT_LINE = /^(?:[A-Za-z][A-Za-z0-9-]*)(?:;[^:]*)?:/

/**
 * Unfold, drop lines that cannot be content lines (no NAME[;PARAMS]: prefix), and
 * normalize newlines. ical.js throws on the whole feed for one such line.
 */
export function preclean(text: string): string {
  const unfolded = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '')
  const kept: string[] = []
  for (const line of unfolded.split('\n')) {
    if (!line.trim()) continue
    if (CONTENT_LINE.test(line)) kept.push(line)
  }
  return kept.join('\r\n') + '\r\n'
}

/** Split a feed into (header, vevent blocks) so a single bad VEVENT can be dropped. */
function splitEvents(cleaned: string): { header: string[]; events: string[][] } {
  const lines = cleaned.split('\r\n')
  const header: string[] = []
  const events: string[][] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (!line) continue
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = [line]
      continue
    }
    if (current) {
      current.push(line)
      if (/^END:VEVENT$/i.test(line)) {
        events.push(current)
        current = null
      }
      continue
    }
    header.push(line)
  }
  return { header, events }
}

function parseCalendar(text: string): { cal: Component; dropped: number } {
  const cleaned = preclean(text)
  try {
    return { cal: new ICAL.Component(ICAL.parse(cleaned)), dropped: 0 }
  } catch {
    // Fall back to per-event parsing inside the same header (VTIMEZONEs included).
    const { header, events } = splitEvents(cleaned)
    const headerNoEnd = header.filter((l) => !/^END:VCALENDAR$/i.test(l))
    const good: string[] = []
    let dropped = 0
    for (const ev of events) {
      try {
        ICAL.parse([...headerNoEnd, ...ev, 'END:VCALENDAR'].join('\r\n'))
        good.push(...ev)
      } catch {
        dropped++
      }
    }
    try {
      return { cal: new ICAL.Component(ICAL.parse([...headerNoEnd, ...good, 'END:VCALENDAR'].join('\r\n'))), dropped }
    } catch {
      return { cal: new ICAL.Component(ICAL.parse('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//tributary//repair//EN\r\nEND:VCALENDAR\r\n')), dropped: dropped + events.length - good.length }
    }
  }
}

export function parseIcs(text: string, opts: ParseIcsOptions): ParseIcsResult {
  if (!/BEGIN:VCALENDAR/i.test(text)) return { events: [], meta: {}, complete: false, window: {}, dropped: 0 }
  const { cal, dropped: parseDropped } = parseCalendar(text)
  let dropped = parseDropped
  registerTimezones(cal)

  const feedTz = resolveTzid(str(cal.getFirstPropertyValue('x-wr-timezone')))
  const fallbackTz = feedTz ?? opts.defaultTz
  const meta = {
    title: str(cal.getFirstPropertyValue('x-wr-calname')) ?? str(cal.getFirstPropertyValue('name')),
    description: str(cal.getFirstPropertyValue('x-wr-caldesc')) ?? str(cal.getFirstPropertyValue('description')),
    tz: feedTz,
    prodId: str(cal.getFirstPropertyValue('prodid')),
    url: str(cal.getFirstPropertyValue('x-original-url')) ?? str(cal.getFirstPropertyValue('url')),
  }

  const windowFrom = DateTime.fromJSDate(opts.window.from)
  const windowTo = DateTime.fromJSDate(opts.window.to)
  const maxOcc = opts.maxOccurrences ?? 500

  // Group masters and exceptions by UID; a lone exception becomes a standalone event.
  const masters = new Map<string, { ev: Event; comp: Component }>()
  const exceptions = new Map<string, Array<{ ev: Event; comp: Component }>>()
  for (const comp of cal.getAllSubcomponents('vevent')) {
    let ev: Event
    try {
      ev = new ICAL.Event(comp, { strictExceptions: false })
      // Force the lazy DTSTART parse so a malformed date is caught here.
      void ev.startDate
    } catch {
      dropped++
      continue
    }
    const uid = str(comp.getFirstPropertyValue('uid')) ?? `noid-${masters.size + 1}`
    if (ev.isRecurrenceException()) {
      const list = exceptions.get(uid) ?? []
      list.push({ ev, comp })
      exceptions.set(uid, list)
    } else {
      masters.set(uid, { ev, comp })
    }
  }
  for (const [uid, list] of exceptions) {
    const m = masters.get(uid)
    if (m) for (const x of list) m.ev.relateException(x.ev)
  }

  const events: RawEvent[] = []
  let observedFrom: DateTime | undefined
  let observedTo: DateTime | undefined
  let openEnded = false
  const observe = (dt: DateTime) => {
    if (!observedFrom || dt < observedFrom) observedFrom = dt
    if (!observedTo || dt > observedTo) observedTo = dt
  }

  /** Build one RawEvent from a component, with the times already chosen. */
  const build = (comp: Component, uid: string, startW: Wall, endW: Wall | undefined, occurrence: string | undefined, sharedTz: string | undefined): RawEvent | null => {
    const name = str(comp.getFirstPropertyValue('summary'))
    if (!name) return null
    const zoneDeclared = startW.zone ?? sharedTz ?? feedTz
    const tz = zoneDeclared
    const { description, descriptionIsHtml } = descriptionOf(comp)
    const urlProp = str(comp.getFirstPropertyValue('url'))
    const url = urlProp && /^https?:\/\//i.test(urlProp) ? urlProp : firstPlainUrl(description)
    const seq = comp.getFirstPropertyValue('sequence')
    const raw: RawEvent = {
      externalId: uid,
      ...(occurrence ? { occurrence } : {}),
      name,
      ...(description ? { description, descriptionIsHtml: !!descriptionIsHtml } : {}),
      start: startW.isDate ? startW.wall : startW.isUtc ? `${startW.wall}Z` : startW.wall,
      ...(endW ? { end: endW.isDate ? endW.wall : endW.isUtc ? `${endW.wall}Z` : endW.wall } : {}),
      ...(tz ? { tz } : {}),
      ...(startW.isDate ? { allDay: true } : {}),
    }
    const status = statusOf(comp)
    if (status) raw.status = status
    const location = str(comp.getFirstPropertyValue('location'))
    if (location) raw.location = location
    const geo = geoOf(comp)
    if (geo) raw.geo = geo
    if (url) raw.url = url
    const image = imageFrom(comp)
    if (image) raw.imageUrl = image
    const organizer = organizerOf(comp)
    if (organizer) raw.organizerName = organizer
    const tags = categoriesOf(comp)
    if (tags) raw.tags = tags
    const privacy = privacyOf(comp)
    if (privacy) raw.sourcePrivacy = privacy
    if (typeof seq === 'number') raw.sequence = seq
    else if (typeof seq === 'string' && /^\d+$/.test(seq)) raw.sequence = Number(seq)
    const lm = lastModifiedOf(comp)
    if (lm) raw.lastModified = lm
    return raw
  }

  const overlaps = (start: DateTime, end: DateTime | undefined, isDate: boolean) => {
    const e = end ?? start.plus({ milliseconds: isDate ? ONE_DAY : ONE_HOUR })
    return e > windowFrom && start < windowTo
  }

  for (const [uid, { ev, comp }] of masters) {
    let startW: Wall
    try {
      startW = wallOf(ev.startDate, comp.getFirstProperty('dtstart'))
    } catch {
      dropped++
      continue
    }
    const zone = startW.zone ?? fallbackTz
    const masterStart = instantOf(startW, zone)
    if (!masterStart.isValid) {
      dropped++
      continue
    }
    observe(masterStart)

    if (!ev.isRecurring()) {
      const endT = endTime(ev)
      const endW = endT ? wallOf(endT, comp.getFirstProperty('dtend') ?? comp.getFirstProperty('dtstart')) : undefined
      const endI = endW ? instantOf(endW, endW.zone ?? zone) : undefined
      if (!overlaps(masterStart, endI?.isValid ? endI : undefined, startW.isDate)) continue
      const raw = build(comp, uid, startW, endW, undefined, startW.zone)
      if (raw) events.push(raw)
      else dropped++
      continue
    }

    // Recurring: expand within the window, apply exceptions.
    const rrules = comp.getAllProperties('rrule')
    const infinite = rrules.some((p) => {
      const r = p.getFirstValue() as { count?: number | null; until?: Time | null } | null
      return r && !r.count && !r.until
    })
    if (infinite) openEnded = true
    let iterator: ReturnType<Event['iterator']>
    try {
      iterator = ev.iterator()
    } catch {
      dropped++
      continue
    }
    let n = 0
    let next: Time | null
    while ((next = iterator.next()) && n < maxOcc) {
      n++
      let details: ReturnType<Event['getOccurrenceDetails']>
      try {
        details = ev.getOccurrenceDetails(next)
      } catch {
        continue
      }
      const item = details.item
      const itemComp = item.component
      const isException = item !== ev
      const recW = wallOf(details.recurrenceId, comp.getFirstProperty('dtstart'))
      const originalStart = instantOf(recW, recW.zone ?? zone)
      const occStartW = wallOf(details.startDate, (isException ? itemComp.getFirstProperty('dtstart') : null) ?? comp.getFirstProperty('dtstart'))
      const occZone = occStartW.zone ?? zone
      const occStart = instantOf(occStartW, occZone)
      const occEndT = details.endDate && (details.endDate.isDate || details.endDate.compare(details.startDate) !== 0) ? details.endDate : undefined
      const occEndW = occEndT ? wallOf(occEndT, (isException ? itemComp.getFirstProperty('dtend') : null) ?? comp.getFirstProperty('dtend') ?? comp.getFirstProperty('dtstart')) : undefined
      const occEnd = occEndW ? instantOf(occEndW, occEndW.zone ?? occZone) : undefined
      observe(occStart)
      if (occStart > windowTo && originalStart > windowTo) break
      if (!overlaps(occStart, occEnd?.isValid ? occEnd : undefined, occStartW.isDate)) continue
      const raw = build(isException ? itemComp : comp, uid, occStartW, occEndW, originalStart.toUTC().toISO()!, startW.zone)
      if (!raw) continue
      // An exception inherits what it does not override.
      if (isException) {
        const base = build(comp, uid, startW, undefined, undefined, startW.zone)
        if (base) {
          for (const k of ['description', 'descriptionIsHtml', 'location', 'geo', 'url', 'imageUrl', 'organizerName', 'tags', 'sourcePrivacy'] as const) {
            if (raw[k] === undefined && base[k] !== undefined) (raw as unknown as Record<string, unknown>)[k] = base[k]
          }
        }
      }
      raw.seriesKey = uid
      events.push(raw)
    }
  }

  // Exceptions whose master is not in the feed: publish them as standalone occurrences.
  for (const [uid, list] of exceptions) {
    if (masters.has(uid)) continue
    for (const { ev, comp } of list) {
      try {
        const startW = wallOf(ev.startDate, comp.getFirstProperty('dtstart'))
        const zone = startW.zone ?? fallbackTz
        const start = instantOf(startW, zone)
        observe(start)
        const recW = wallOf(ev.recurrenceId, comp.getFirstProperty('recurrence-id'))
        const original = instantOf(recW, recW.zone ?? zone)
        const endT = endTime(ev)
        const endW = endT ? wallOf(endT, comp.getFirstProperty('dtend') ?? comp.getFirstProperty('dtstart')) : undefined
        const endI = endW ? instantOf(endW, endW.zone ?? zone) : undefined
        if (!overlaps(start, endI?.isValid ? endI : undefined, startW.isDate)) continue
        const raw = build(comp, uid, startW, endW, original.toUTC().toISO()!, startW.zone)
        if (raw) {
          raw.seriesKey = uid
          events.push(raw)
        } else dropped++
      } catch {
        dropped++
      }
    }
  }

  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.externalId.localeCompare(b.externalId)))

  const window: ParseIcsResult['window'] = {}
  if (observedFrom) window.from = observedFrom.toJSDate()
  if (observedTo) window.to = openEnded ? new Date(Math.max(observedTo.toMillis(), windowTo.toMillis())) : observedTo.toJSDate()

  return { events, meta, complete: dropped === 0, window, dropped }
}
