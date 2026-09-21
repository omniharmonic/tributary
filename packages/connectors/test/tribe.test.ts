import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tribeConnector } from '../src/tribe/index.js'
import { fetchCtx, log, mockHttp } from './mock-http.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = (name: string) => readFileSync(path.resolve(here, '../../../fixtures/pages', name), 'utf8')

const origin = 'https://seedlibrary.example'
const list = `${origin}/wp-json/tribe/events/v1/events?per_page=50&page=1&start_date=2026-09-20&end_date=2026-12-20`

describe('tribeConnector', () => {
  it('detects by probing the REST API', async () => {
    const calls: string[] = []
    const http = mockHttp({ [`${origin}/wp-json/tribe/events/v1/events?per_page=1`]: { contentType: 'application/json', body: page('tribe-events.json') } }, calls)
    const m = await tribeConnector.detect!({ url: new URL(`${origin}/events/`), fetched: { body: page('tribe-site.html'), finalUrl: `${origin}/events/` } }, { http, log })
    expect(m).toMatchObject({ type: 'tribe', platform: 'wordpress', hint: { origin } })
    expect(calls).toHaveLength(1)
  })
  it('does not probe a page with no WordPress markers', async () => {
    const http = mockHttp({})
    expect(await tribeConnector.detect!({ url: new URL('https://x.example/'), fetched: { body: '<html></html>', finalUrl: 'https://x.example/' } }, { http, log })).toBeNull()
  })
  it('fetches and maps events within the window', async () => {
    const http = mockHttp({ [list]: { contentType: 'application/json', body: page('tribe-events.json') } })
    const cfg = await tribeConnector.configure({ type: 'tribe', confidence: 1, platform: 'wordpress', hint: { origin } }, { http, log })
    const res = await tribeConnector.fetch(cfg, null, fetchCtx(http))
    expect(res.complete).toBe(true)
    expect(res.events).toHaveLength(2)
    const [a, b] = res.events
    expect(a).toMatchObject({
      externalId: 'tribe_412',
      name: 'Seed Swap & Garden Planning',
      start: '2026-10-04T10:00:00',
      end: '2026-10-04T13:00:00',
      tz: 'America/Denver',
      descriptionIsHtml: true,
      imageUrl: 'https://seedlibrary.example/wp-content/uploads/seeds.jpg',
      priceText: 'Free',
      isFree: true,
      organizerName: 'Front Range Seed Library',
      tags: ['Gardening', 'mutual aid'],
      lastModified: '2026-09-01 12:00:00',
    })
    expect(a?.locations?.[0]).toMatchObject({ name: 'Boulder Public Library', street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', postalCode: '80302', country: 'US', lat: 40.0139, lon: -105.2816 })
    expect(b).toMatchObject({ externalId: 'tribe_413', name: 'Board Meeting' })
    expect(b?.locations).toBeUndefined()
    expect(b?.imageUrl).toBeUndefined()
    expect(tribeConnector.fingerprint(cfg)).toBe('tribe:https://seedlibrary.example')
    expect(tribeConnector.label(cfg)).toContain('seedlibrary.example')
  })
})
