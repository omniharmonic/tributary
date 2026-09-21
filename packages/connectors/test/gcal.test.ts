import { describe, expect, it } from 'vitest'
import { calendarIdFrom, decodeCid, gcalPublicConnector, publicIcsUrl } from '../src/gcal-public/index.js'
import { MINIMAL_ICS, ctxWith, mockHttp } from './helpers.js'

const ID = 'abc123@group.calendar.google.com'
const cidUnpadded = Buffer.from(ID).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

describe('calendar id resolution', () => {
  it('reads every spelling a host might paste', () => {
    expect(calendarIdFrom(`https://calendar.google.com/calendar/ical/${encodeURIComponent(ID)}/public/basic.ics`)).toBe(ID)
    expect(calendarIdFrom(`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(ID)}&ctz=America%2FDenver`)).toBe(ID)
    expect(calendarIdFrom(`<iframe src="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(ID)}" style="border:0"></iframe>`)).toBe(ID)
    expect(calendarIdFrom(`https://calendar.google.com/calendar/u/0?cid=${cidUnpadded}`)).toBe(ID)
    expect(calendarIdFrom(`https://calendar.google.com/calendar/u/0/r?cid=${cidUnpadded}`)).toBe(ID)
    expect(calendarIdFrom(ID)).toBe(ID)
    expect(calendarIdFrom('someone@gmail.com')).toBe('someone@gmail.com')
    expect(calendarIdFrom('https://lu.ma/x')).toBeUndefined()
    expect(calendarIdFrom('hello there')).toBeUndefined()
  })
  it('decodes unpadded base64url cids and refuses binary junk', () => {
    expect(decodeCid(cidUnpadded)).toBe(ID)
    expect(decodeCid('////')).toBeUndefined()
  })
  it('builds the public ICS url', () => {
    expect(publicIcsUrl(ID)).toBe('https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics')
  })
})

describe('gcal connector', () => {
  it('detects and configures by probing the public feed', async () => {
    const http = mockHttp({ [publicIcsUrl(ID)]: { body: MINIMAL_ICS } })
    const m = await gcalPublicConnector.detect!({ text: `https://calendar.google.com/calendar/u/0?cid=${cidUnpadded}` }, ctxWith(http))
    expect(m?.hint).toEqual({ calendarId: ID })
    const cfg = await gcalPublicConnector.configure(m!, ctxWith(http))
    expect(cfg).toEqual({ calendarId: ID, tz: 'America/Denver', title: 'Test Feed' })
    expect(gcalPublicConnector.fingerprint(cfg)).toBe(`gcal:${ID}`)
  })
  it('falls back to the ICS feed without an API key', async () => {
    const http = mockHttp({ [publicIcsUrl(ID)]: { body: MINIMAL_ICS, etag: '"e"' } })
    const r = await gcalPublicConnector.fetch({ calendarId: ID }, null, ctxWith(http))
    expect(r.events).toHaveLength(1)
    expect(r.cursor).toBeNull()
    expect(r.etag).toBe('"e"')
  })
  it('uses the Calendar API with a key: sync tokens, cancellations, privacy, and a 410 resync', async () => {
    const page1 = {
      timeZone: 'America/Denver',
      items: [
        { id: 'e1', summary: 'Talk', start: { dateTime: '2026-10-01T10:00:00-06:00', timeZone: 'America/Denver' }, end: { dateTime: '2026-10-01T11:00:00-06:00' }, htmlLink: 'https://www.google.com/calendar/event?eid=1', visibility: 'private', hangoutLink: 'https://meet.google.com/abc-defg-hij', sequence: 2 },
        { id: 'e2_20261005T160000Z', recurringEventId: 'e2', originalStartTime: { dateTime: '2026-10-05T10:00:00-06:00' }, summary: 'Weekly', start: { dateTime: '2026-10-05T10:00:00-06:00' }, end: { dateTime: '2026-10-05T11:00:00-06:00' } },
        { id: 'e3', status: 'cancelled', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
        { id: 'e4', summary: 'All day', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } },
      ],
      nextSyncToken: 'tok1',
    }
    let calls = 0
    const http = mockHttp({
      'https://www.googleapis.com/calendar/v3/calendars/*': (url) => {
        calls++
        const u = new URL(url)
        if (u.searchParams.get('syncToken') === 'expired') return { status: 410, body: '{}', contentType: 'application/json' }
        if (u.searchParams.get('syncToken') === 'tok1') return { body: JSON.stringify({ items: [{ id: 'e1', status: 'cancelled', start: { dateTime: '2026-10-01T10:00:00-06:00' } }], nextSyncToken: 'tok2' }), contentType: 'application/json' }
        expect(u.searchParams.get('singleEvents')).toBe('true')
        expect(u.searchParams.get('showDeleted')).toBe('true')
        expect(u.searchParams.get('timeMin')).toBeTruthy()
        return { body: JSON.stringify(page1), contentType: 'application/json' }
      },
    })
    const ctx = ctxWith(http, { secrets: { GOOGLE_API_KEY: 'k' } })
    const full = await gcalPublicConnector.fetch({ calendarId: ID }, null, ctx)
    expect(full.complete).toBe(true)
    expect(full.cursor).toEqual({ syncToken: 'tok1' })
    expect(full.events.map((e) => e.externalId)).toEqual(['e1', 'e2', 'e3', 'e4'])
    const e1 = full.events[0]!
    expect(e1.sourcePrivacy).toBe('private')
    expect(e1.description).toContain('https://meet.google.com/abc-defg-hij')
    expect(e1.tz).toBe('America/Denver')
    expect(e1.url).toBe('https://www.google.com/calendar/event?eid=1')
    const e2 = full.events[1]!
    expect(e2.occurrence).toBe('2026-10-05T16:00:00.000Z')
    expect(e2.seriesKey).toBe('e2')
    expect(full.events[2]!.status).toBe('cancelled')
    expect(full.events[3]!.allDay).toBe(true)

    const delta = await gcalPublicConnector.fetch({ calendarId: ID }, { syncToken: 'tok1' }, ctx)
    expect(delta.complete).toBe(false)
    expect(delta.events.map((e) => [e.externalId, e.status])).toEqual([['e1', 'cancelled']])
    expect(delta.cursor).toEqual({ syncToken: 'tok2' })

    const resync = await gcalPublicConnector.fetch({ calendarId: ID }, { syncToken: 'expired' }, ctx)
    expect(resync.complete).toBe(true)
    expect(resync.events).toHaveLength(4)
    expect(calls).toBeGreaterThanOrEqual(4)
  })
})
