import { describe, expect, it } from 'vitest'
import { eventbriteConnector, toRaw } from '../src/eventbrite/index.js'
import type { FetchCtx } from '../src/sdk.js'

const ORGS = { organizations: [{ id: '123', name: 'Dairy Arts' }] }
const EVENTS = {
  events: [
    { id: '9', name: { text: 'Opening Night' }, description: { html: '<p>Hi</p>' }, url: 'https://www.eventbrite.com/e/9', start: { timezone: 'America/Denver', utc: '2026-10-04T01:00:00Z' }, end: { utc: '2026-10-04T03:00:00Z' }, status: 'live', online_event: false, listed: true, is_free: true, logo: { original: { url: 'https://img/x.jpg' } }, venue: { name: 'The Dairy', address: { address_1: '2590 Walnut St', city: 'Boulder', region: 'CO', postal_code: '80302', country: 'US', latitude: '40.02', longitude: '-105.26' } }, organizer: { name: 'Dairy Arts Center' }, category: { name: 'Arts' } },
    { id: '10', name: { text: 'Members Only' }, start: { utc: '2026-10-05T01:00:00Z' }, status: 'live', listed: false },
  ],
  pagination: { has_more_items: false },
}

function ctx(token = 'tok'): FetchCtx {
  const http = {
    get: async (url: string, opts?: { headers?: Record<string, string> }) => {
      if (opts?.headers?.authorization !== 'Bearer tok') return { url, status: 401, headers: {}, body: Buffer.alloc(0), text: () => '{}', contentType: 'application/json', notModified: false }
      const body = JSON.stringify(url.includes('/users/me/organizations') ? ORGS : EVENTS)
      return { url, status: 200, headers: {}, body: Buffer.from(body), text: () => body, contentType: 'application/json', notModified: false }
    },
    head: async () => { throw new Error('no') },
    getPage: async () => { throw new Error('no') },
  }
  return { http: http as never, secrets: { EVENTBRITE_TOKEN: token }, log: { info() {}, warn() {} }, window: { from: new Date(), to: new Date() }, defaultTz: 'America/Denver' }
}

describe('eventbrite connector', () => {
  it('configures from the token and fetches the organisation events', async () => {
    const c = ctx()
    const cfg = await eventbriteConnector.configure({ secrets: c.secrets }, c)
    expect(cfg).toMatchObject({ organizationId: '123', organizationName: 'Dairy Arts' })
    const res = await eventbriteConnector.fetch(cfg, null, c)
    expect(res.complete).toBe(true)
    expect(res.events).toHaveLength(2)
    expect(res.events[0]).toMatchObject({ externalId: 'eventbrite:9', tz: 'America/Denver', imageUrl: 'https://img/x.jpg', organizerName: 'Dairy Arts Center', isFree: true, mode: 'inperson' })
    expect(res.events[0]!.locations?.[0]).toMatchObject({ name: 'The Dairy', street: '2590 Walnut St', lat: 40.02 })
    expect(res.events[1]!.sourcePrivacy).toBe('unlisted')
  })
  it('reports a bad token plainly', async () => {
    await expect(eventbriteConnector.configure({}, ctx('bad'))).rejects.toMatchObject({ code: 'Forbidden' })
  })
  it('drops events without a name or start', () => {
    expect(toRaw({ id: '1' })).toBeNull()
  })
})
