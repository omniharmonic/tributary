import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { eventIdFromUid, groupFrom, meetupConnector, meetupIcalUrl } from '../src/meetup/index.js'
import { ctxWith, mockHttp } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const MEETUP_ICS = readFileSync(path.resolve(here, '../../../fixtures/ics/meetup-group.ics'), 'utf8')

describe('meetup urls', () => {
  it('finds the group in group, event-list and event urls, including localized paths', () => {
    expect(groupFrom(new URL('https://www.meetup.com/boulder-python/'))).toBe('boulder-python')
    expect(groupFrom(new URL('https://www.meetup.com/boulder-python/events/'))).toBe('boulder-python')
    expect(groupFrom(new URL('https://www.meetup.com/boulder-python/events/312345678/'))).toBe('boulder-python')
    expect(groupFrom(new URL('https://www.meetup.com/en-AU/boulder-python/events/'))).toBe('boulder-python')
    expect(groupFrom(new URL('https://www.meetup.com/find/?keywords=x'))).toBeUndefined()
    expect(groupFrom(new URL('https://lu.ma/x'))).toBeUndefined()
    expect(eventIdFromUid('event_312345678@meetup.com')).toBe('312345678')
    expect(eventIdFromUid('other@x')).toBeUndefined()
    expect(meetupIcalUrl('boulder-python')).toBe('https://www.meetup.com/boulder-python/events/ical/')
  })
  it('detects, with a note on single events', async () => {
    const m = await meetupConnector.detect!({ url: new URL('https://www.meetup.com/boulder-python/events/312345678/') }, ctxWith(mockHttp({})))
    expect(m).toMatchObject({ type: 'meetup', hint: { group: 'boulder-python' } })
    expect(m?.note).toMatch(/whole group/)
  })
})

describe('meetup configure + fetch', () => {
  it('configures by reading the feed title and maps a missing group to NotFound', async () => {
    const http = mockHttp({
      [meetupIcalUrl('boulder-python')]: { body: MEETUP_ICS },
      [meetupIcalUrl('nope')]: { status: 404, body: '{"message":"Group not found"}', contentType: 'text/plain' },
    })
    const cfg = await meetupConnector.configure({ type: 'meetup', confidence: 1, platform: 'meetup', hint: { group: 'boulder-python' } }, ctxWith(http))
    expect(cfg).toEqual({ group: 'boulder-python', title: 'Boulder Python' })
    expect(meetupConnector.fingerprint({ group: 'Boulder-Python' })).toBe('meetup:boulder-python')
    await expect(meetupConnector.configure({ type: 'meetup', confidence: 1, platform: 'meetup', hint: { group: 'nope' } }, ctxWith(http))).rejects.toMatchObject({ code: 'NotFound', retryable: false })
  })
  it('fetches and derives event urls from the UID when the feed has none', async () => {
    const stripped = MEETUP_ICS.replace(/^URL:.*\n/m, '')
    const http = mockHttp({ [meetupIcalUrl('boulder-python')]: { body: stripped } })
    const r = await meetupConnector.fetch({ group: 'boulder-python' }, null, ctxWith(http))
    expect(r.events).toHaveLength(1)
    expect(r.events[0]!.url).toBe('https://www.meetup.com/boulder-python/events/312345678/')
    expect(r.events[0]!.tz).toBe('America/Denver')
    expect(r.events[0]!.start).toBe('2026-10-14T18:00:00')
    expect(r.events[0]!.imageUrl).toBeUndefined()
  })
})
