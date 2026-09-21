/**
 * Mobilize (organising and civic events): the public API lists an organisation's
 * events with timeslots; every timeslot is published as its own occurrence. The
 * numeric organisation id comes from the URL when it carries one, else from the
 * organisation page's embedded data.
 */
import { ConnectorError, HOUR, type Connector, type DetectInput, type DetectMatch, type RawEvent } from '../sdk.js'

export interface MobilizeConfig {
  organizationId: string
  slug?: string
  tz?: string
  title?: string
}

interface MobilizeEvent {
  id: number
  title?: string
  description?: string
  timezone?: string
  browser_url?: string
  featured_image_url?: string
  event_type?: string
  is_virtual?: boolean
  visibility?: string
  modified_date?: number
  sponsor?: { name?: string }
  location?: { venue?: string; address_lines?: string[]; locality?: string; region?: string; postal_code?: string; location?: { latitude?: number; longitude?: number } }
  timeslots?: Array<{ id: number; start_date?: number; end_date?: number }>
}

export function toRawEvents(e: MobilizeEvent): RawEvent[] {
  const name = e.title?.trim()
  if (!name || !e.id) return []
  const slots = (e.timeslots ?? []).filter((t) => typeof t.start_date === 'number')
  const l = e.location
  const out: RawEvent[] = []
  for (const t of slots) {
    out.push({
      externalId: `mobilize:${e.id}`,
      occurrence: slots.length > 1 ? new Date(t.start_date! * 1000).toISOString() : undefined,
      name,
      description: e.description,
      start: new Date(t.start_date! * 1000).toISOString(),
      end: typeof t.end_date === 'number' ? new Date(t.end_date * 1000).toISOString() : undefined,
      tz: e.timezone,
      mode: e.is_virtual ? 'virtual' : 'inperson',
      locations: l && (l.venue || l.address_lines?.length) ? [{ name: l.venue, street: l.address_lines?.filter(Boolean).join(', '), locality: l.locality, region: l.region, postalCode: l.postal_code, lat: l.location?.latitude, lon: l.location?.longitude }] : undefined,
      url: e.browser_url,
      imageUrl: e.featured_image_url,
      organizerName: e.sponsor?.name,
      tags: e.event_type ? [e.event_type.toLowerCase().replace(/_/g, ' ')] : undefined,
      seriesKey: slots.length > 1 ? `mobilize:${e.id}` : undefined,
      sourcePrivacy: e.visibility === 'PRIVATE' ? 'private' : undefined,
      lastModified: e.modified_date ? new Date(e.modified_date * 1000).toISOString() : undefined,
    })
  }
  return out
}

export const mobilizeConnector: Connector<MobilizeConfig, null> = {
  type: 'mobilize',
  platform: 'mobilize',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'native', requiresAuth: 'none' },
  defaultInterval: HOUR,
  async detect(input: DetectInput): Promise<DetectMatch | null> {
    if (!input.url || !/(^|\.)mobilize\.us$/.test(input.url.hostname)) return null
    const seg = input.url.pathname.split('/').filter(Boolean)
    const slug = seg[0]
    if (!slug) return null
    return { type: 'mobilize', confidence: 0.9, platform: 'mobilize', hint: { slug, pageUrl: input.url.toString(), organizationId: /^\d+$/.test(slug) ? slug : undefined } }
  },
  async configure(input, ctx) {
    const h = ('hint' in input ? (input as DetectMatch).hint : input) as Partial<MobilizeConfig> & { pageUrl?: string }
    let organizationId = h.organizationId ? String(h.organizationId) : ''
    if (!organizationId && h.pageUrl) {
      const page = await ctx.http.getPage(String(h.pageUrl))
      const m = /"organization_id"\s*:\s*(\d+)|organizations\/(\d+)\//.exec(page.text())
      organizationId = m?.[1] ?? m?.[2] ?? ''
    }
    if (!organizationId) throw new ConnectorError('we could not find the organisation id on that Mobilize page', 'Unsupported', false)
    const res = await ctx.http.get(`https://api.mobilize.us/v1/organizations/${organizationId}`, { headers: { accept: 'application/json' } })
    if (res.status === 404) throw new ConnectorError('no such Mobilize organisation', 'NotFound', false)
    let title: string | undefined
    try {
      title = (JSON.parse(res.text()) as { data?: { name?: string } }).data?.name
    } catch {
      /* optional */
    }
    return { organizationId, slug: h.slug, tz: h.tz, title }
  },
  async fetch(cfg, _cursor, ctx) {
    const events: RawEvent[] = []
    let url: string | null = `https://api.mobilize.us/v1/organizations/${cfg.organizationId}/events?timeslot_start=gte_now&per_page=100`
    for (let i = 0; url && i < 20; i++) {
      const res = await ctx.http.get(url, { headers: { accept: 'application/json' }, maxBytes: 8 * 1024 * 1024 })
      if (res.status === 404) throw new ConnectorError('the Mobilize organisation is gone', 'NotFound', false)
      if (res.status === 429) throw new ConnectorError('Mobilize asked us to slow down', 'RateLimited')
      if (res.status !== 200) throw new ConnectorError(`Mobilize answered ${res.status}`, 'Other')
      let json: { data?: MobilizeEvent[]; next?: string | null }
      try {
        json = JSON.parse(res.text())
      } catch {
        throw new ConnectorError('Mobilize sent something we could not read', 'Unparseable')
      }
      for (const e of json.data ?? []) events.push(...toRawEvents(e))
      url = json.next ?? null
    }
    return { events, cursor: null, complete: true, window: { from: new Date() }, meta: { title: cfg.title, url: cfg.slug ? `https://www.mobilize.us/${cfg.slug}/` : undefined } }
  },
  fingerprint: (cfg) => `mobilize:${cfg.organizationId}`,
  label: (cfg) => `Mobilize: ${cfg.title ?? cfg.slug ?? cfg.organizationId}`,
}
