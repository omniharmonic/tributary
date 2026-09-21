import { describe, expect, it } from 'vitest'
import { findCalendarLink, icsConnector } from '../src/ics/index.js'
import { ConnectorError } from '../src/sdk.js'
import { MINIMAL_ICS, ctxWith, mockHttp } from './helpers.js'

const u = (s: string) => new URL(s)

describe('ics detect', () => {
  it('matches webcal, .ics and ical paths, but steps back for specific hosts', async () => {
    expect((await icsConnector.detect!({ text: 'webcal://example.org/feed.ics' }, ctxWith(mockHttp({}))))?.hint).toEqual({ url: 'https://example.org/feed.ics' })
    expect((await icsConnector.detect!({ url: u('https://example.org/events/?ical=1'), text: '' }, ctxWith(mockHttp({}))))?.type).toBeUndefined()
    expect((await icsConnector.detect!({ url: u('https://example.org/events.ics'), text: '' }, ctxWith(mockHttp({}))))?.type).toBe('ics')
    expect((await icsConnector.detect!({ url: u('https://example.org/calendar/ical/'), text: '' }, ctxWith(mockHttp({}))))?.type).toBe('ics')
    expect(await icsConnector.detect!({ url: u('https://calendar.google.com/calendar/ical/x/public/basic.ics'), text: '' }, ctxWith(mockHttp({})))).toBeNull()
    expect(await icsConnector.detect!({ url: u('https://www.meetup.com/g/events/ical/'), text: '' }, ctxWith(mockHttp({})))).toBeNull()
  })
  it('matches by fetched content type or body, and by calendar autodiscovery link', async () => {
    const byType = await icsConnector.detect!({ url: u('https://x.org/feed'), fetched: { contentType: 'text/calendar', body: MINIMAL_ICS, finalUrl: 'https://x.org/feed' } }, ctxWith(mockHttp({})))
    expect(byType?.confidence).toBeGreaterThan(0.9)
    const html = '<html><head><link rel="alternate" type="text/calendar" title="x" href="/events/?ical=1"></head></html>'
    const byLink = await icsConnector.detect!({ url: u('https://x.org/'), fetched: { contentType: 'text/html', body: html, finalUrl: 'https://x.org/' } }, ctxWith(mockHttp({})))
    expect(byLink?.hint).toEqual({ url: 'https://x.org/events/?ical=1' })
    expect(findCalendarLink('<a href="webcal://x.org/a.ics">sub</a>', 'https://x.org')).toBe('https://x.org/a.ics')
  })
})

describe('ics configure + fetch', () => {
  it('configures from a live probe and picks up the feed zone and title', async () => {
    const http = mockHttp({ 'https://example.org/feed.ics': { body: MINIMAL_ICS, etag: '"a"' } })
    const cfg = await icsConnector.configure({ type: 'ics', confidence: 1, platform: 'ics', hint: { url: 'webcal://example.org/feed.ics' } }, ctxWith(http))
    expect(cfg).toEqual({ url: 'https://example.org/feed.ics', tz: 'America/Denver', title: 'Test Feed' })
    expect(icsConnector.fingerprint(cfg)).toBe('ics:https://example.org/feed.ics')
    expect(icsConnector.label(cfg)).toContain('Test Feed')
  })
  it('fetches, returns etag, and answers notModified on a 304', async () => {
    const http = mockHttp({ 'https://example.org/feed.ics': { body: MINIMAL_ICS, etag: '"v1"', notModifiedFor: '"v1"' } })
    const first = await icsConnector.fetch({ url: 'https://example.org/feed.ics' }, null, ctxWith(http))
    expect(first.events.map((e) => e.externalId)).toEqual(['one@test'])
    expect(first.etag).toBe('"v1"')
    expect(first.complete).toBe(true)
    const second = await icsConnector.fetch({ url: 'https://example.org/feed.ics' }, null, ctxWith(http, { etag: '"v1"' }))
    expect(second.notModified).toBe(true)
    expect(second.events).toEqual([])
    expect(second.complete).toBe(false)
    expect(http.calls[1]?.opts.etag).toBe('"v1"')
  })
  it('maps HTTP failures to plain-language connector errors', async () => {
    const http = mockHttp({ 'https://gone.org/f.ics': { status: 404, body: 'nope', contentType: 'text/plain' }, 'https://html.org/f.ics': { body: '<html>not a feed</html>' } })
    await expect(icsConnector.fetch({ url: 'https://gone.org/f.ics' }, null, ctxWith(http))).rejects.toMatchObject({ code: 'NotFound' })
    await expect(icsConnector.fetch({ url: 'https://html.org/f.ics' }, null, ctxWith(http))).rejects.toBeInstanceOf(ConnectorError)
    await expect(icsConnector.fetch({ url: 'https://html.org/f.ics' }, null, ctxWith(http))).rejects.toMatchObject({ code: 'Unparseable', retryable: false })
  })
})
