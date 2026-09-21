/**
 * Localist (universities, cities): the public `/api/2/events` endpoint, paged, with
 * native photos, venues and geo. Instances are published individually (a Localist
 * event with several instances is a series).
 */
import { ConnectorError, HOUR, type Connector, type DetectInput, type DetectMatch, type RawEvent } from '../sdk.js'

export interface LocalistConfig {
  origin: string
  tz?: string
  title?: string
}

interface LocalistEvent {
  id: number
  title?: string
  description?: string
  description_text?: string
  localist_url?: string
  url?: string
  photo_url?: string
  location_name?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  geo?: { latitude?: string; longitude?: string }
  free?: boolean
  cost?: string
  experience?: string
  status?: string
  updated_at?: string
  event_instances?: Array<{ event_instance: { id: number; start?: string; end?: string; all_day?: boolean } }>
  filters?: { event_types?: Array<{ name?: string }>; departments?: Array<{ name?: string }> }
  private?: boolean
}

/**
 * Localist's `location_name` often repeats the street and city ("Hellems, 1550 Central
 * Campus Mall, Boulder, CO 80309"); keep the venue name only, and drop a city that the
 * address already ends with.
 */
function placeOf(e: LocalistEvent): NonNullable<RawEvent['locations']>[number] {
  let name = e.location_name?.trim()
  const street = e.address?.trim()
  if (name && street) {
    const i = name.toLowerCase().indexOf(street.toLowerCase().split(',')[0]!)
    if (i > 0) name = name.slice(0, i).replace(/[,\s]+$/, '')
    else if (i === 0) name = undefined
  }
  if (name && e.city && name.toLowerCase().endsWith(`, ${e.city.toLowerCase()}`)) name = name.slice(0, -(e.city.length + 2))
  return { name: name || undefined, street, locality: e.city, region: e.state, postalCode: e.zip, lat: e.geo?.latitude ? Number(e.geo.latitude) : undefined, lon: e.geo?.longitude ? Number(e.geo.longitude) : undefined }
}

export function toRawEvents(e: LocalistEvent): RawEvent[] {
  const name = e.title?.trim()
  if (!name || !e.id) return []
  const out: RawEvent[] = []
  const instances = e.event_instances?.map((i) => i.event_instance).filter((i) => i.start) ?? []
  const mode: RawEvent['mode'] = e.experience === 'virtual' ? 'virtual' : e.experience === 'hybrid' ? 'hybrid' : 'inperson'
  const base = {
    name,
    description: e.description ?? e.description_text,
    descriptionIsHtml: !!e.description,
    url: e.localist_url ?? e.url,
    imageUrl: e.photo_url,
    mode,
    locations: e.location_name || e.address ? [placeOf(e)] : undefined,
    isFree: e.free,
    priceText: e.free ? 'Free' : e.cost,
    tags: [...(e.filters?.event_types ?? []), ...(e.filters?.departments ?? [])].map((t) => t.name).filter((x): x is string => !!x),
    status: (e.status === 'canceled' ? 'cancelled' : 'scheduled') as RawEvent['status'],
    sourcePrivacy: e.private ? ('private' as const) : undefined,
    lastModified: e.updated_at,
  }
  for (const i of instances) {
    out.push({ ...base, externalId: `localist:${e.id}`, occurrence: instances.length > 1 ? new Date(i.start!).toISOString() : undefined, start: i.start!, end: i.end ?? undefined, allDay: !!i.all_day, seriesKey: instances.length > 1 ? `localist:${e.id}` : undefined })
  }
  return out
}

export const localistConnector: Connector<LocalistConfig, null> = {
  type: 'localist',
  platform: 'localist',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'native', requiresAuth: 'none' },
  defaultInterval: HOUR,
  async detect(input: DetectInput): Promise<DetectMatch | null> {
    if (!input.url) return null
    if (/(^|\.)localist\.com$/.test(input.url.hostname)) return { type: 'localist', confidence: 0.9, platform: 'localist', hint: { origin: input.url.origin, pageUrl: input.url.toString() } }
    return null
  },
  async configure(input, ctx) {
    const h = ('hint' in input ? (input as DetectMatch).hint : input) as Partial<LocalistConfig> & { pageUrl?: string }
    const origin = h.origin ? String(h.origin).replace(/\/$/, '') : h.pageUrl ? new URL(String(h.pageUrl)).origin : ''
    if (!origin) throw new ConnectorError('a Localist site is required', 'Unsupported', false)
    const res = await ctx.http.get(`${origin}/api/2/events?pp=1`, { headers: { accept: 'application/json' } })
    if (res.status !== 200 || !res.contentType?.includes('json')) throw new ConnectorError('that site does not answer the Localist API', 'Unsupported', false)
    return { origin, tz: h.tz, title: h.title }
  },
  async fetch(cfg, _cursor, ctx) {
    const events: RawEvent[] = []
    let page = 1
    let total = 1
    do {
      const res = await ctx.http.get(`${cfg.origin}/api/2/events?days=90&pp=100&page=${page}`, { headers: { accept: 'application/json' }, maxBytes: 8 * 1024 * 1024 })
      if (res.status === 404) throw new ConnectorError('the Localist calendar is gone', 'NotFound', false)
      if (res.status !== 200) throw new ConnectorError(`Localist answered ${res.status}`, 'Other')
      let json: { events?: Array<{ event: LocalistEvent }>; page?: { current?: number; total?: number } }
      try {
        json = JSON.parse(res.text())
      } catch {
        throw new ConnectorError('Localist sent something we could not read', 'Unparseable')
      }
      for (const w of json.events ?? []) events.push(...toRawEvents(w.event))
      total = json.page?.total ?? 1
      page++
    } while (page <= total && page <= 20)
    return { events, cursor: null, complete: true, window: { from: new Date(), to: new Date(Date.now() + 90 * 86_400_000) }, meta: { url: cfg.origin } }
  },
  fingerprint: (cfg) => `localist:${new URL(cfg.origin).hostname}`,
  label: (cfg) => `Localist calendar at ${new URL(cfg.origin).hostname}`,
}
