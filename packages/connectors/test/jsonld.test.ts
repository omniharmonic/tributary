import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractJsonLdEvents, extractPageMeta } from '../src/jsonld-page/extract.js'
import { jsonldPageConnector } from '../src/jsonld-page/index.js'
import { fetchCtx, log, mockHttp } from './mock-http.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = (name: string) => readFileSync(path.resolve(here, '../../../fixtures/pages', name), 'utf8')

describe('extractJsonLdEvents', () => {
  it('maps an Eventbrite event fully', () => {
    const [e] = extractJsonLdEvents(page('eventbrite-event.html'), 'https://www.eventbrite.com/e/x')
    expect(e).toMatchObject({
      name: 'Repair Café Boulder',
      start: '2026-10-10T10:00:00-06:00',
      end: '2026-10-10T13:00:00-06:00',
      url: 'https://www.eventbrite.com/e/repair-cafe-boulder-tickets-1234567890',
      imageUrl: 'https://img.evbuc.com/orig/456.jpg',
      organizerName: 'Repair Café Boulder',
      priceText: 'Free',
      isFree: true,
      status: 'scheduled',
      mode: 'inperson',
      geo: { lat: 40.0139, lon: -105.2816 },
    })
    expect(e?.locations?.[0]).toMatchObject({ name: 'Boulder Public Library', street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US' })
    expect(e?.externalId).toBe(e?.url)
  })
  it('walks @graph / ItemList, resolves relative images, maps status, mode, virtual location and keywords', () => {
    const events = extractJsonLdEvents(page('list-page.html'), 'https://thedairy.example/upcoming')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ name: 'Hamlet', imageUrl: 'https://thedairy.example/img/hamlet.jpg', priceText: '$25', isFree: false })
    expect(events[0]?.locations?.[0]).toMatchObject({ name: 'Dairy Arts Center', street: '2590 Walnut St, Boulder, CO' })
    expect(events[1]).toMatchObject({ name: 'Jazz Night', status: 'cancelled', mode: 'hybrid', tags: ['jazz', 'music'] })
    expect(events[1]?.links?.[0]?.uri).toBe('https://thedairy.example/live')
  })
  it('falls back to microdata', () => {
    const [e] = extractJsonLdEvents(page('microdata.html'), 'https://repair.example/events/repair')
    expect(e).toMatchObject({ name: 'Repair Cafe', start: '2026-11-01T10:00:00-06:00', url: 'https://repair.example/events/repair' })
    expect(e?.locations?.[0]).toMatchObject({ name: 'Boulder Public Library', locality: 'Boulder' })
  })
  it('returns nothing for a page with no structure', () => {
    expect(extractJsonLdEvents(page('plain.html'), 'https://x.example/')).toEqual([])
  })
})

describe('extractPageMeta', () => {
  it('finds calendar links, generator, og:image, hints and Luma cover data', () => {
    const auto = extractPageMeta(page('autodiscovery.html'), 'https://community.example/calendar')
    expect(auto.calendarLinks).toEqual(['https://community.example/calendar/feed.ics'])
    const tribe = extractPageMeta(page('tribe-site.html'), 'https://seedlibrary.example/events/')
    expect(tribe.platformHints).toEqual(expect.arrayContaining(['tribe', 'wordpress']))
    expect(tribe.generator).toContain('WordPress')
    const sq = extractPageMeta(page('squarespace-events.html'), 'https://rayback.example/events')
    expect(sq.platformHints).toContain('squarespace')
    expect(sq.ogImage).toBe('https://images.squarespace-cdn.com/content/rayback/share.jpg')
    const luma = extractPageMeta(page('luma-calendar.html'), 'https://lu.ma/x')
    expect(luma.lumaCoverUrl).toBe('https://images.lumacdn.com/calendars/abc/cover.jpg')
    expect(luma.platformHints).toContain('luma')
    const list = extractPageMeta(page('list-page.html'), 'https://thedairy.example/upcoming')
    expect(list.jsonLdEventCount).toBe(2)
  })
})

describe('jsonldPageConnector', () => {
  it('detects, configures and fetches a single event page', async () => {
    const url = 'https://www.eventbrite.com/e/repair-cafe-boulder-tickets-1234567890'
    const http = mockHttp({ [url]: { body: page('eventbrite-event.html') } })
    const match = await jsonldPageConnector.detect!({ url: new URL(url), text: url, fetched: { body: page('eventbrite-event.html'), finalUrl: url, contentType: 'text/html' } }, { http, log })
    expect(match).toMatchObject({ type: 'jsonld-page', platform: 'eventbrite', confidence: 0.8 })
    const cfg = await jsonldPageConnector.configure(match!, { http, log })
    expect(cfg.url).toBe(url)
    expect(jsonldPageConnector.fingerprint(cfg)).toBe(`page:${url}`)
    const res = await jsonldPageConnector.fetch(cfg, null, fetchCtx(http))
    expect(res.events).toHaveLength(1)
    expect(res.complete).toBe(true)
    expect(res.window?.from?.toISOString()).toBe('2026-10-10T16:00:00.000Z')
  })
  it('marks list pages and uses the rolling window', async () => {
    const url = 'https://thedairy.example/upcoming'
    const http = mockHttp({ [url]: { body: page('list-page.html') } })
    const match = await jsonldPageConnector.detect!({ url: new URL(url), text: url, fetched: { body: page('list-page.html'), finalUrl: url } }, { http, log })
    expect(match?.note).toContain('lists 2 events')
    const cfg = await jsonldPageConnector.configure(match!, { http, log })
    const ctx = fetchCtx(http)
    const res = await jsonldPageConnector.fetch(cfg, null, ctx)
    expect(res.events).toHaveLength(2)
    expect(res.window).toEqual(ctx.window)
  })
  it('surfaces gone pages as a ConnectorError', async () => {
    const http = mockHttp({ 'https://x.example/e': { body: '', status: 404 } })
    await expect(jsonldPageConnector.fetch({ url: 'https://x.example/e' }, null, fetchCtx(http))).rejects.toMatchObject({ code: 'NotFound' })
  })
})
