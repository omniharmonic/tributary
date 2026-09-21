import { describe, expect, it } from 'vitest'
import { localistConnector, toRawEvents as localistRaw } from '../src/localist/index.js'
import { mobilizeConnector, toRawEvents as mobilizeRaw } from '../src/mobilize/index.js'
import type { FetchCtx } from '../src/sdk.js'

function ctx(routes: Record<string, { status?: number; body: unknown; contentType?: string }>): FetchCtx {
  const find = (url: string) => Object.entries(routes).find(([k]) => url.startsWith(k))?.[1]
  const mk = async (url: string) => {
    const r = find(url)
    if (!r) return { url, status: 404, headers: {}, body: Buffer.alloc(0), text: () => '', contentType: 'text/plain', notModified: false }
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    return { url, status: r.status ?? 200, headers: {}, body: Buffer.from(text), text: () => text, contentType: r.contentType ?? 'application/json', notModified: false }
  }
  return { http: { get: mk, head: mk, getPage: mk } as never, secrets: {}, log: { info() {}, warn() {} }, window: { from: new Date(), to: new Date() }, defaultTz: 'America/Denver' }
}

describe('localist', () => {
  const ev = { id: 7, title: 'Campus Farmers Market', description: '<p>Fresh</p>', localist_url: 'https://events.colorado.edu/event/market', photo_url: 'https://img/m.jpg', location_name: 'UMC Plaza', address: '1669 Euclid Ave', city: 'Boulder', state: 'CO', zip: '80309', geo: { latitude: '40.006', longitude: '-105.27' }, free: true, experience: 'inperson', status: 'live', event_instances: [{ event_instance: { id: 1, start: '2026-10-07T10:00:00-06:00', end: '2026-10-07T14:00:00-06:00' } }, { event_instance: { id: 2, start: '2026-10-14T10:00:00-06:00' } }], filters: { event_types: [{ name: 'Market' }] } }
  it('publishes each instance as an occurrence with native photo and place', () => {
    const raws = localistRaw(ev)
    expect(raws).toHaveLength(2)
    expect(raws[0]).toMatchObject({ externalId: 'localist:7', imageUrl: 'https://img/m.jpg', isFree: true, seriesKey: 'localist:7', tags: ['Market'] })
    expect(raws[0]!.locations?.[0]).toMatchObject({ name: 'UMC Plaza', lat: 40.006 })
    expect(raws[0]!.occurrence).toBe('2026-10-07T16:00:00.000Z')
  })
  it('configures against the API and pages through results', async () => {
    const c = ctx({ 'https://events.colorado.edu/api/2/events': { body: { events: [{ event: ev }], page: { current: 1, total: 1 } } } })
    const cfg = await localistConnector.configure({ type: 'localist', confidence: 1, platform: 'localist', hint: { origin: 'https://events.colorado.edu' } }, c)
    const res = await localistConnector.fetch(cfg, null, c)
    expect(res.events).toHaveLength(2)
    expect(localistConnector.fingerprint(cfg)).toBe('localist:events.colorado.edu')
  })
  it('refuses a site without the API', async () => {
    await expect(localistConnector.configure({ type: 'localist', confidence: 1, platform: 'localist', hint: { origin: 'https://nope.example' } }, ctx({}))).rejects.toMatchObject({ code: 'Unsupported' })
  })
})

describe('mobilize', () => {
  const ev = { id: 55, title: 'Canvass Launch', description: 'Knock doors', timezone: 'America/Denver', browser_url: 'https://www.mobilize.us/org/event/55/', featured_image_url: 'https://img/c.jpg', event_type: 'CANVASS', is_virtual: false, visibility: 'PUBLIC', sponsor: { name: 'Boulder Org' }, location: { venue: 'Library', address_lines: ['1001 Arapahoe Ave'], locality: 'Boulder', region: 'CO', postal_code: '80302', location: { latitude: 40.01, longitude: -105.28 } }, timeslots: [{ id: 1, start_date: 1791000000, end_date: 1791007200 }, { id: 2, start_date: 1791600000 }] }
  it('publishes each timeslot as an occurrence', () => {
    const raws = mobilizeRaw(ev)
    expect(raws).toHaveLength(2)
    expect(raws[0]).toMatchObject({ externalId: 'mobilize:55', tz: 'America/Denver', organizerName: 'Boulder Org', tags: ['canvass'], imageUrl: 'https://img/c.jpg' })
    expect(raws[0]!.locations?.[0]).toMatchObject({ street: '1001 Arapahoe Ave', lat: 40.01 })
  })
  it('finds the organisation id on the page and fetches', async () => {
    const c = ctx({
      'https://www.mobilize.us/boulderorg/': { body: '<html><script>window.__DATA__={"organization_id": 42}</script></html>', contentType: 'text/html' },
      'https://api.mobilize.us/v1/organizations/42/events': { body: { data: [ev], next: null } },
      'https://api.mobilize.us/v1/organizations/42': { body: { data: { name: 'Boulder Org' } } },
    })
    const cfg = await mobilizeConnector.configure({ type: 'mobilize', confidence: 1, platform: 'mobilize', hint: { slug: 'boulderorg', pageUrl: 'https://www.mobilize.us/boulderorg/' } }, c)
    expect(cfg.organizationId).toBe('42')
    const res = await mobilizeConnector.fetch(cfg, null, c)
    expect(res.events).toHaveLength(2)
    expect(mobilizeConnector.label(cfg)).toBe('Mobilize: Boulder Org')
  })
})
