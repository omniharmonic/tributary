import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { calendarFromPage, canonicalLumaUrl, classifyLumaUrl, lumaConnector, lumaIcsUrl } from '../src/luma/index.js'
import { ctxWith, mockHttp } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const LUMA_ICS = readFileSync(path.resolve(here, '../../../fixtures/ics/luma-calendar.ics'), 'utf8')
const CAL = 'cal-8ACK0vjqOfKpHXl'

function nextData(data: unknown): string {
  return `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { data } } } })}</script></body></html>`
}

describe('luma url classification', () => {
  it('recognises calendar pages, event pages and the ICS itself', () => {
    expect(classifyLumaUrl(new URL('https://lu.ma/boulder-builders'))).toEqual({ kind: 'page', path: '/boulder-builders' })
    expect(classifyLumaUrl(new URL('https://luma.com/j14jqq0f'))).toEqual({ kind: 'page', path: '/j14jqq0f' })
    expect(classifyLumaUrl(new URL(`https://luma.com/calendar/${CAL}`))).toEqual({ kind: 'calendar', calendarId: CAL })
    expect(classifyLumaUrl(new URL(lumaIcsUrl(CAL)))).toEqual({ kind: 'ics', calendarId: CAL })
    expect(classifyLumaUrl(new URL('https://www.meetup.com/x'))).toBeNull()
  })
  it('detects with a note for single events', async () => {
    const ctx = ctxWith(mockHttp({}))
    const ev = await lumaConnector.detect!({ url: new URL('https://lu.ma/j14jqq0f') }, ctx)
    expect(ev?.note).toMatch(/single Luma event/)
    const cal = await lumaConnector.detect!({ url: new URL(`https://luma.com/calendar/${CAL}`) }, ctx)
    expect(cal?.hint).toEqual({ calendarId: CAL })
  })
})

describe('luma page data', () => {
  it('reads the calendar id, slug and name from a calendar page and an event page', () => {
    expect(calendarFromPage(nextData({ calendar: { api_id: CAL, slug: 'claudeworkshops', name: 'Claude Workshops' } }))).toEqual({ calendarId: CAL, slug: 'claudeworkshops', title: 'Claude Workshops' })
    expect(calendarFromPage(nextData({ event: { calendar_api_id: CAL, url: 'j14jqq0f' } }))).toEqual({ calendarId: CAL, slug: undefined, title: undefined })
    expect(calendarFromPage(nextData({ events: [] }))).toBeUndefined()
    expect(calendarFromPage(`<html>"calendar_api_id":"${CAL}"</html>`)).toEqual({ calendarId: CAL })
  })
  it('configures from a page and refuses discover pages', async () => {
    const http = mockHttp({
      'https://lu.ma/boulder-builders': { body: nextData({ calendar: { api_id: CAL, slug: 'boulder-builders', name: 'Boulder Builders' } }) },
      'https://lu.ma/sf': { body: nextData({ events: [{ calendar: { api_id: 'cal-other' } }] }) },
    })
    const cfg = await lumaConnector.configure({ type: 'luma', confidence: 1, platform: 'luma', hint: { pageUrl: 'https://lu.ma/boulder-builders' } }, ctxWith(http))
    expect(cfg).toEqual({ calendarId: CAL, slug: 'boulder-builders', title: 'Boulder Builders' })
    expect(lumaConnector.fingerprint(cfg)).toBe(`luma:${CAL}`)
    expect(lumaConnector.label(cfg)).toBe('Boulder Builders (Luma)')
    await expect(lumaConnector.configure({ type: 'luma', confidence: 1, platform: 'luma', hint: { pageUrl: 'https://lu.ma/sf' } }, ctxWith(http))).rejects.toMatchObject({ code: 'Unsupported' })
  })
})

describe('luma fetch', () => {
  it('reads the calendar ICS and canonicalises event urls to lu.ma short slugs', async () => {
    const http = mockHttp({ [lumaIcsUrl(CAL)]: { body: LUMA_ICS, etag: '"l1"' } })
    const r = await lumaConnector.fetch({ calendarId: CAL }, null, ctxWith(http))
    expect(r.events.map((e) => e.url)).toEqual(['https://lu.ma/abcd1234', 'https://lu.ma/efgh5678'])
    expect(r.events.every((e) => e.imageUrl === undefined)).toBe(true)
    expect(r.events[0]!.organizerName).toBe('Boulder Builders')
    expect(r.events[0]!.geo).toEqual({ lat: 40.0176, lon: -105.2811 })
    expect(r.meta?.title).toBe('Boulder Builders')
  })
  it('falls back to the UID slug when the description has no short link', () => {
    expect(canonicalLumaUrl({ externalId: 'evt-WubTRLpINkKUFc7@events.lu.ma', name: 'x', start: '2026-10-01' })).toBe('https://lu.ma/evt-WubTRLpINkKUFc7')
    expect(canonicalLumaUrl({ externalId: 'x', name: 'x', start: '2026-10-01', url: 'https://www.luma.com/zzz' })).toBe('https://lu.ma/zzz')
  })
})
