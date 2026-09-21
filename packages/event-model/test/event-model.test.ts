import { describe, expect, it } from 'vitest'
import {
  assertValidEventRecord,
  buildEventRecord,
  canonicalUrl,
  contentHash,
  extractJoinUrl,
  isConferenceUrl,
  linkFacets,
  normalize,
  normalizeTitle,
  toCard,
  toMarkdown,
  type RawEvent,
} from '../src/index.js'

const ctx = { sourceId: 'src1', sourceType: 'ics' as const, platform: 'luma', defaultTz: 'America/Denver', fallbackUrl: 'https://lu.ma/example' }

const raw: RawEvent = {
  externalId: 'evt-abc@events.lu.ma',
  name: 'Seed Swap and Garden Planning',
  description: '<p>Bring seeds, take seeds. RSVP at <a href="https://lu.ma/abcd1234?utm_source=x">https://lu.ma/abcd1234?utm_source=x</a></p><p>Join: https://zoom.us/j/123456</p>',
  descriptionIsHtml: true,
  start: '2026-10-04T10:00:00',
  end: '2026-10-04T13:00:00',
  tz: 'America/Denver',
  location: 'Boulder Public Library, 1001 Arapahoe Ave, Boulder, CO 80302',
  url: 'https://lu.ma/abcd1234',
  organizerName: 'Front Range Seed Library',
  priceText: 'Free',
}

describe('normalize', () => {
  it('resolves wall-clock times in the source zone and keeps the zone', () => {
    const e = normalize(raw, ctx)
    expect(e.start.instant).toBe('2026-10-04T16:00:00.000Z')
    expect(e.start.tz).toBe('America/Denver')
    expect(e.start.tzInferred).toBe(false)
    expect(e.end?.instant).toBe('2026-10-04T19:00:00.000Z')
  })
  it('flags inferred zones and honours explicit offsets', () => {
    const e = normalize({ ...raw, tz: undefined, start: '2026-10-04T10:00:00-05:00' }, ctx)
    expect(e.start.tzInferred).toBe(true)
    expect(e.start.instant).toBe('2026-10-04T15:00:00.000Z')
  })
  it('handles all-day events as local midnight to midnight', () => {
    const e = normalize({ ...raw, allDay: true, start: '2026-10-04', end: undefined }, ctx)
    expect(e.start.allDay).toBe(true)
    expect(e.start.instant).toBe('2026-10-04T06:00:00.000Z')
    expect(e.end?.instant).toBe('2026-10-05T06:00:00.000Z')
  })
  it('extracts and scrubs the conference link, and infers hybrid mode', () => {
    const e = normalize(raw, ctx)
    expect(e.joinUrl).toBe('https://zoom.us/j/123456')
    expect(e.descriptionMd).not.toContain('zoom.us')
    expect(e.mode).toBe('hybrid')
  })
  it('canonicalises the source url', () => {
    const e = normalize(raw, ctx)
    expect(e.sourceUrl).toBe('https://lu.ma/abcd1234')
  })
  it('hashes stably and changes on content change', () => {
    const a = normalize(raw, ctx)
    const b = normalize(raw, { ...ctx, fetchedAt: '2020-01-01T00:00:00Z' })
    expect(a.contentHash).toBe(b.contentHash)
    const c = normalize({ ...raw, name: 'Seed Swap' }, ctx)
    expect(c.contentHash).not.toBe(a.contentHash)
  })
  it('redacts phone numbers and emails from descriptions', () => {
    const e = normalize({ ...raw, description: 'Call 303-555-1234 or mail jane@example.org', descriptionIsHtml: false }, ctx)
    expect(e.descriptionMd).not.toContain('303-555-1234')
    expect(e.descriptionMd).not.toContain('jane@example.org')
  })
})

describe('record', () => {
  it('builds a record that validates against the base lexicon', () => {
    const e = normalize(raw, ctx)
    const r = buildEventRecord(e, { createdWith: 'https://tributary.example' })
    expect(() => assertValidEventRecord(r)).not.toThrow()
    expect(r.startsAt).toBe('2026-10-04T10:00:00.000-06:00')
    expect(r.timezone).toBe('America/Denver')
    expect(r.mode).toBe('community.lexicon.calendar.event#hybrid')
    expect(r.uris[0]).toEqual({ uri: 'https://lu.ma/abcd1234', name: 'RSVP on Luma' })
    expect(r.uris.some((u) => u.uri.includes('zoom'))).toBe(false)
    expect((r.additionalData.externalSource as { externalId: string }).externalId).toBe('evt-abc@events.lu.ma')
    expect(r.preferences.showInDiscovery).toBe(true)
  })
  it('publishes a coarse teaser for gated events', () => {
    const e = normalize({ ...raw, locations: [{ name: 'Home', street: '123 Elm St', locality: 'Boulder', region: 'CO' }], geo: { lat: 40.01, lon: -105.27 } }, ctx)
    const r = buildEventRecord({ ...e, visibility: 'gated' }, { createdWith: 'x' })
    const json = JSON.stringify(r.locations)
    expect(json).not.toContain('Elm St')
    expect(json).toContain('hthree')
    expect(r.additionalData.gated).toBe(true)
    expect(r.preferences.showInDiscovery).toBe(false)
  })
  it('rejects records without attribution', () => {
    expect(() => assertValidEventRecord({ $type: 'community.lexicon.calendar.event', name: 'x', createdAt: new Date().toISOString(), startsAt: new Date().toISOString(), timezone: 'UTC' })).toThrow()
  })
})

describe('text', () => {
  it('converts html to markdown and strips tracking params', () => {
    expect(toMarkdown('<p>Hi <b>there</b></p>')).toBe('Hi **there**')
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=z&x=1#frag')).toBe('https://example.com/a/?x=1')
    expect(canonicalUrl('webcal://calendar.google.com/x.ics')).toBe('https://calendar.google.com/x.ics')
  })
  it('detects conference urls', () => {
    expect(isConferenceUrl('https://us02web.zoom.us/j/1')).toBe(true)
    expect(isConferenceUrl('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(isConferenceUrl('https://lu.ma/x')).toBe(false)
    expect(extractJoinUrl(['see https://meet.google.com/abc-defg-hij now']).joinUrl).toBe('https://meet.google.com/abc-defg-hij')
  })
  it('computes byte-offset facets', () => {
    const f = linkFacets('café https://a.b/c!')
    expect(f[0]?.index).toEqual({ byteStart: 6, byteEnd: 19 })
  })
  it('normalizes titles for duplicate grouping', () => {
    expect(normalizeTitle('The Seed-Swap & Garden Planning!')).toBe('seed swap garden planning')
  })
})

describe('card', () => {
  it('reports completeness', () => {
    const e = normalize(raw, ctx)
    const c = toCard(e)
    expect(c.missing).toContain('image')
    expect(c.complete).toBe(false)
    expect(c.when).toMatch(/Sun, Oct 4 · 10 AM – 1 PM MDT/)
    const c2 = toCard({ ...e, image: { url: 'https://x/y.jpg', origin: 'source' } })
    expect(c2.complete).toBe(true)
  })
  it('hashes exclude provenance timestamps', () => {
    const e = normalize(raw, ctx)
    const { contentHash: _h, ...rest } = e
    expect(contentHash({ ...rest, provenance: { ...rest.provenance, fetchedAt: 'other' } })).toBe(e.contentHash)
  })
})
