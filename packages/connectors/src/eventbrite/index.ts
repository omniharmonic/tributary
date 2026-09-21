/**
 * Eventbrite (A2): an organiser's private token reads their organisation's events with
 * venue, logo, organizer and category expanded. The token lives in the source's
 * encrypted secrets and never leaves the box. Single Eventbrite pages already work
 * through `jsonld-page`; this is for live sync of everything the organisation runs.
 */
import { ConnectorError, HOUR, type Connector, type FetchCtx, type RawEvent } from '../sdk.js'

export interface EventbriteConfig {
  organizationId: string
  organizationName?: string
  tz?: string
}

const API = 'https://www.eventbriteapi.com/v3'

interface EbEvent {
  id: string
  name?: { text?: string }
  description?: { html?: string; text?: string }
  summary?: string
  url?: string
  start?: { timezone?: string; local?: string; utc?: string }
  end?: { timezone?: string; local?: string; utc?: string }
  status?: string
  online_event?: boolean
  listed?: boolean
  is_free?: boolean
  changed?: string
  logo?: { original?: { url?: string }; url?: string }
  venue?: { name?: string; address?: { address_1?: string; address_2?: string; city?: string; region?: string; postal_code?: string; country?: string; latitude?: string; longitude?: string } }
  organizer?: { name?: string }
  category?: { name?: string }
  subcategory?: { name?: string }
  series_id?: string
}

async function ebGet<T>(ctx: Pick<FetchCtx, 'http' | 'secrets'>, path: string): Promise<T> {
  const token = ctx.secrets.EVENTBRITE_TOKEN
  if (!token) throw new ConnectorError('no Eventbrite token for this source', 'Forbidden', false)
  const res = await ctx.http.get(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, maxBytes: 8 * 1024 * 1024 })
  if (res.status === 401 || res.status === 403) throw new ConnectorError('Eventbrite rejected the token', 'Forbidden', false)
  if (res.status === 404) throw new ConnectorError('Eventbrite could not find that organisation', 'NotFound', false)
  if (res.status === 429) throw new ConnectorError('Eventbrite asked us to slow down', 'RateLimited')
  if (res.status !== 200) throw new ConnectorError(`Eventbrite answered ${res.status}`, 'Other')
  try {
    return JSON.parse(res.text()) as T
  } catch {
    throw new ConnectorError('Eventbrite sent something we could not read', 'Unparseable')
  }
}

export function toRaw(e: EbEvent): RawEvent | null {
  const name = e.name?.text?.trim()
  const start = e.start?.utc ?? e.start?.local
  if (!name || !start || !e.id) return null
  const a = e.venue?.address
  const locations = e.venue
    ? [{ name: e.venue.name, street: [a?.address_1, a?.address_2].filter(Boolean).join(', ') || undefined, locality: a?.city, region: a?.region, postalCode: a?.postal_code, country: a?.country, lat: a?.latitude ? Number(a.latitude) : undefined, lon: a?.longitude ? Number(a.longitude) : undefined }]
    : undefined
  const status: RawEvent['status'] = e.status === 'canceled' ? 'cancelled' : e.status === 'draft' ? 'planned' : 'scheduled'
  return {
    externalId: `eventbrite:${e.id}`,
    name,
    description: e.description?.html ?? e.description?.text ?? e.summary,
    descriptionIsHtml: !!e.description?.html,
    start,
    end: e.end?.utc ?? e.end?.local,
    tz: e.start?.timezone,
    status,
    mode: e.online_event ? 'virtual' : 'inperson',
    locations,
    url: e.url,
    imageUrl: e.logo?.original?.url ?? e.logo?.url,
    organizerName: e.organizer?.name,
    isFree: e.is_free,
    priceText: e.is_free ? 'Free' : undefined,
    tags: [e.category?.name, e.subcategory?.name].filter((x): x is string => !!x),
    seriesKey: e.series_id,
    sourcePrivacy: e.listed === false ? 'unlisted' : undefined,
    lastModified: e.changed,
  }
}

export const eventbriteConnector: Connector<EventbriteConfig, null> = {
  type: 'eventbrite',
  platform: 'eventbrite',
  capabilities: { live: 'poll', delta: false, explicitDeletes: true, images: 'native', requiresAuth: 'apiKey' },
  defaultInterval: HOUR,
  async configure(input, ctx) {
    const h = ('hint' in input ? (input as { hint: Partial<EventbriteConfig> }).hint : input) as Partial<EventbriteConfig> & { secrets?: Record<string, string> }
    const secrets = (ctx as FetchCtx).secrets ?? h.secrets ?? {}
    const list = await ebGet<{ organizations?: Array<{ id: string; name?: string }> }>({ http: ctx.http, secrets }, '/users/me/organizations/')
    const orgs = list.organizations ?? []
    if (orgs.length === 0) throw new ConnectorError('that token has no organisation', 'NotFound', false)
    const org = (h.organizationId && orgs.find((o) => o.id === h.organizationId)) || orgs[0]!
    return { organizationId: org.id, organizationName: org.name, tz: h.tz }
  },
  async fetch(cfg, _cursor, ctx) {
    const events: RawEvent[] = []
    let page = 1
    for (let i = 0; i < 20; i++) {
      const res = await ebGet<{ events?: EbEvent[]; pagination?: { has_more_items?: boolean; continuation?: string } }>(ctx, `/organizations/${cfg.organizationId}/events/?expand=venue,logo,organizer,category,subcategory&status=live,started,canceled&order_by=start_asc&time_filter=current_future&page_size=100&page=${page}`)
      for (const e of res.events ?? []) {
        const raw = toRaw(e)
        if (raw) events.push(raw)
      }
      if (!res.pagination?.has_more_items) break
      page++
    }
    return { events, cursor: null, complete: true, window: { from: new Date() }, meta: { title: cfg.organizationName, url: `https://www.eventbrite.com/o/${cfg.organizationId}` } }
  },
  fingerprint: (cfg) => `eventbrite:${cfg.organizationId}`,
  label: (cfg) => `Eventbrite: ${cfg.organizationName ?? cfg.organizationId}`,
}
