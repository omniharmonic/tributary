import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeMatch, detect, findUrl, googleCalendarId } from '../src/index.js'
import { mockHttp, type MockRoute } from './mock-http.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../../fixtures')
const page = (name: string) => readFileSync(path.join(fixtures, 'pages', name), 'utf8')

const routes: Record<string, MockRoute> = {
  'https://seedlibrary.example/events/': { body: page('tribe-site.html') },
  'https://seedlibrary.example/wp-json/tribe/events/v1/events?per_page=1': { contentType: 'application/json', body: page('tribe-events.json') },
  'https://rayback.example/events': { body: page('squarespace-events.html') },
  'https://rayback.example/events?format=json': { contentType: 'application/json', body: page('squarespace-events.json') },
  'https://thedairy.example/whats-on': { body: page('plain.html') },
  'https://thedairy.example/upcoming': { body: page('list-page.html') },
  'https://community.example/calendar': { body: page('autodiscovery.html') },
  'https://community.example/feed.ics': { contentType: 'text/calendar', body: page('feed.ics') },
  'https://community.example/plain-feed': { contentType: 'text/plain', body: page('feed.ics') },
  'https://calendar.colorado.example/': { body: page('localist-site.html') },
  'https://calendar.colorado.example/api/2/events?pp=1': { contentType: 'application/json', body: page('localist-events.json') },
  'https://repair.example/events/repair': { body: page('microdata.html') },
}

const log = { info: () => {}, warn: () => {} }

interface Case {
  input: string
  expectedType: string
  expectedPlatform: string
  expectedNote?: boolean
  expectedHint?: Record<string, unknown>
}

const cases = JSON.parse(readFileSync(path.join(fixtures, 'detect', 'inputs.json'), 'utf8')) as Case[]

describe('F1: one-box detection over 40 fixture inputs', () => {
  it('has forty cases', () => expect(cases.length).toBe(40))
  for (const c of cases) {
    it(`${c.input.slice(0, 70)} → ${c.expectedType}/${c.expectedPlatform}`, async () => {
      const http = mockHttp(routes)
      const matches = await detect({ text: c.input }, { http, log })
      expect(matches.length).toBeGreaterThan(0)
      const top = matches[0]!
      expect(top.type).toBe(c.expectedType)
      expect(top.platform).toBe(c.expectedPlatform)
      if (c.expectedNote) expect(top.note).toBeTruthy()
      if (c.expectedHint) for (const [k, v] of Object.entries(c.expectedHint)) expect(top.hint[k]).toEqual(v)
      expect(describeMatch(top)).toBeTruthy()
    })
  }
})

describe('detect: files', () => {
  it('sniffs ics, csv, images and pdf', async () => {
    const http = mockHttp({})
    const ics = await detect({ file: { name: 'cal.ics', mime: 'application/octet-stream', bytes: Buffer.from('BEGIN:VCALENDAR') } }, { http, log })
    expect(ics[0]).toMatchObject({ type: 'upload', hint: { kind: 'ics' } })
    const csv = await detect({ file: { name: 'events.csv', mime: 'text/csv', bytes: Buffer.from('name,start') } }, { http, log })
    expect(csv[0]).toMatchObject({ type: 'upload', hint: { kind: 'csv' } })
    const png = await detect({ file: { name: 'flyer', mime: '', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } }, { http, log })
    expect(png[0]).toMatchObject({ type: 'extract', hint: { kind: 'flyer' } })
    const pdf = await detect({ file: { name: 'flyer.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') } }, { http, log })
    expect(pdf[0]).toMatchObject({ type: 'extract', hint: { kind: 'flyer' } })
  })
})

describe('detect: helpers', () => {
  it('finds URLs in embed code, bare hosts and webcal links', () => {
    expect(findUrl('<iframe src="https://calendar.google.com/calendar/embed?src=x"></iframe>')?.hostname).toBe('calendar.google.com')
    expect(findUrl('meetup.com/foo')?.toString()).toBe('https://meetup.com/foo')
    expect(findUrl('webcal://example.org/a.ics')?.protocol).toBe('https:')
    expect(findUrl('just words')).toBeUndefined()
  })
  it('decodes google cid links with and without padding', () => {
    const id = 'abc123@group.calendar.google.com'
    const b64 = Buffer.from(id).toString('base64url')
    expect(googleCalendarId(new URL(`https://calendar.google.com/calendar?cid=${b64}`))?.calendarId).toBe(id)
    expect(googleCalendarId(new URL(`https://calendar.google.com/calendar?cid=${b64}%3D`))?.calendarId).toBe(id)
    expect(googleCalendarId(new URL(`https://calendar.google.com/calendar?cid=${encodeURIComponent(id)}`))?.calendarId).toBe(id)
  })
  it('ranks and offers alternatives for a page with both a feed link and JSON-LD', async () => {
    const html = page('autodiscovery.html').replace('</head>', page('eventbrite-event.html').match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)![0] + '</head>')
    const http = mockHttp({ 'https://both.example/': { body: html } })
    const matches = await detect({ text: 'https://both.example/' }, { http, log })
    expect(matches.map((m) => m.type)).toEqual(['ics', 'jsonld-page'])
  })
  it('never throws on an unreachable url', async () => {
    const http = mockHttp({})
    const matches = await detect({ text: 'https://nowhere.invalid/x' }, { http, log })
    expect(matches[0]?.type).toBe('extract')
    expect(matches[0]?.note).toContain('could not reach')
  })
})
