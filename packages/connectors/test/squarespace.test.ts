import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { squarespaceConnector } from '../src/squarespace/index.js'
import { fetchCtx, log, mockHttp } from './mock-http.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = (name: string) => readFileSync(path.resolve(here, '../../../fixtures/pages', name), 'utf8')

const url = 'https://rayback.example/events'

describe('squarespaceConnector', () => {
  it('detects an events collection and picks up the site timezone', async () => {
    const http = mockHttp({ [`${url}?format=json`]: { contentType: 'application/json', body: page('squarespace-events.json') } })
    const m = await squarespaceConnector.detect!({ url: new URL(url), fetched: { body: page('squarespace-events.html'), finalUrl: url } }, { http, log })
    expect(m).toMatchObject({ type: 'squarespace', confidence: 0.95, hint: { url, tz: 'America/Denver' } })
  })
  it('flags a non-events Squarespace page', async () => {
    const http = mockHttp({ 'https://rayback.example/about?format=json': { contentType: 'application/json', body: '{"collection":{"typeName":"page"},"items":[]}' } })
    const m = await squarespaceConnector.detect!({ url: new URL('https://rayback.example/about'), fetched: { body: page('squarespace-events.html'), finalUrl: 'https://rayback.example/about' } }, { http, log })
    expect(m?.confidence).toBe(0.4)
    expect(m?.note).toContain('not its events collection')
  })
  it('maps items', async () => {
    const http = mockHttp({ [`${url}?format=json`]: { contentType: 'application/json', body: page('squarespace-events.json') } })
    const cfg = await squarespaceConnector.configure({ type: 'squarespace', confidence: 1, platform: 'squarespace', hint: { url: `${url}?x=1` } }, { http, log })
    expect(cfg.url).toBe(url)
    const res = await squarespaceConnector.fetch(cfg, null, fetchCtx(http))
    expect(res.events).toHaveLength(2)
    expect(res.events[0]).toMatchObject({
      externalId: 'sq_ev1',
      name: 'Trivia Night',
      start: new Date(1791000000000).toISOString(),
      end: new Date(1791007200000).toISOString(),
      tz: 'America/Denver',
      url: 'https://rayback.example/events/trivia-night',
      imageUrl: 'https://images.squarespace-cdn.com/content/rayback/trivia.jpg',
      descriptionIsHtml: true,
      tags: ['Community'],
    })
    expect(res.events[0]?.locations?.[0]).toMatchObject({ name: 'Rayback Collective', street: '2775 Valmont Rd', locality: 'Boulder', region: 'CO', postalCode: '80304', country: 'US', lat: 40.0301, lon: -105.2582 })
    expect(res.events[1]?.locations).toBeUndefined()
    expect(res.meta?.tz).toBe('America/Denver')
    expect(squarespaceConnector.fingerprint(cfg)).toBe('squarespace:https://rayback.example/events')
  })
})
