import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CATEGORIES, categorize, geocode, matchVenue, pickImageFromPage, recoverImage } from '../src/enrich/index.js'
import { mockHttp } from './mock-http.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = (name: string) => readFileSync(path.resolve(here, '../../../fixtures/pages', name), 'utf8')
const never = () => 0

describe('image recovery order', () => {
  it('native wins without a fetch', async () => {
    const calls: string[] = []
    const http = mockHttp({}, calls)
    const r = await recoverImage({ sourceUrl: 'https://x.example/e', platform: 'web', existing: 'https://cdn.example/a.jpg' }, { http, seen: never })
    expect(r).toEqual({ url: 'https://cdn.example/a.jpg', via: 'native' })
    expect(calls).toHaveLength(0)
  })
  it('JSON-LD image beats og:image', () => {
    const r = pickImageFromPage(page('eventbrite-event.html'), 'https://www.eventbrite.com/e/x', 'eventbrite', never)
    expect(r).toMatchObject({ url: 'https://img.evbuc.com/orig/456.jpg', via: 'jsonld' })
  })
  it('Luma page data cover beats og:image when JSON-LD has no image', () => {
    const r = pickImageFromPage(page('luma-event.html'), 'https://lu.ma/abcd1234', 'luma', never)
    expect(r).toMatchObject({ url: 'https://images.lumacdn.com/event-covers/abc/cover.jpg', via: 'page-data' })
  })
  it('Meetup event pages carry their image in JSON-LD', () => {
    const r = pickImageFromPage(page('meetup-event.html'), 'https://www.meetup.com/boulder-python/events/301234567/', 'meetup', never)
    expect(r).toMatchObject({ url: 'https://secure.meetupstatic.com/photos/event/8/9/highres_999.jpeg', via: 'jsonld' })
  })
  it('og:image is last, and rejected when the site reuses it', async () => {
    const http = mockHttp({ 'https://venue.example/gala': { body: page('og-only.html') } })
    const ok = await recoverImage({ sourceUrl: 'https://venue.example/gala', platform: 'web' }, { http, seen: () => 1 })
    expect(ok).toMatchObject({ url: 'https://venue.example/uploads/gala-2026.jpg', alt: 'Fall Gala at the Dairy', via: 'og' })
    const reused = await recoverImage({ sourceUrl: 'https://venue.example/gala', platform: 'web' }, { http, seen: (d, u) => (d === 'venue.example' && u.includes('gala') ? 3 : 0) })
    expect(reused).toBeUndefined()
    const placeholder = pickImageFromPage(page('default-share.html'), 'https://venue.example/yoga', 'web', never)
    expect(placeholder).toBeUndefined()
  })
  it('swallows fetch failures', async () => {
    const http = mockHttp({})
    expect(await recoverImage({ sourceUrl: 'https://nowhere.invalid/x', platform: 'web' }, { http, seen: never })).toBeUndefined()
  })
})

describe('venues', () => {
  it('matches names and aliases, longest key wins', () => {
    expect(matchVenue('Join us at eTown for music')?.name).toBe('eTown Hall')
    expect(matchVenue('The Dairy, 2590 Walnut')?.name).toBe('Dairy Arts Center')
    expect(matchVenue('Boulder Public Library, Main — Canyon Theater')?.name).toBe('Boulder Public Library, Main')
    expect(matchVenue('Reynolds Branch community room')?.name).toBe('Boulder Public Library, George Reynolds Branch')
    expect(matchVenue('Trident Booksellers & Cafe')?.name).toBe('Trident Booksellers & Cafe')
    expect(matchVenue('123 Nowhere St')).toBeUndefined()
    expect(matchVenue('')).toBeUndefined()
  })
})

describe('geocode', () => {
  it('answers undefined without Photon and parses Photon results', async () => {
    const http = mockHttp({
      'http://photon:2322/api?q=1001+Arapahoe+Ave%2C+Boulder&limit=5&lat=40.015&lon=-105.27&bbox=-105.8%2C39.5%2C-104.8%2C40.4': {
        contentType: 'application/json',
        body: JSON.stringify({ features: [{ geometry: { coordinates: [-105.2816, 40.0139] }, properties: { housenumber: '1001', street: 'Arapahoe Ave', city: 'Boulder', state: 'Colorado', postcode: '80302', countrycode: 'us' } }] }),
      },
    })
    expect(await geocode('1001 Arapahoe Ave, Boulder', { http })).toBeUndefined()
    const r = await geocode('1001 Arapahoe Ave, Boulder', { http, photonUrl: 'http://photon:2322' })
    expect(r).toMatchObject({ lat: 40.0139, lon: -105.2816, precision: 'exact', locality: 'Boulder', postalCode: '80302', country: 'US' })
  })
})

describe('categories', () => {
  it('has a fixed vocabulary of twenty', () => expect(CATEGORIES).toHaveLength(20))
  it('assigns by source tag, then title, then description', () => {
    expect(categorize('Anything', undefined, ['Music'])).toBe('music')
    expect(categorize('Seed Swap and Garden Planning')).toBe('markets')
    expect(categorize('Compost Workshop for the Garden')).toBe('sustainability')
    expect(categorize('Monthly Meetup', 'We talk about Python and software')).toBe('community')
    expect(categorize('Show and Tell', 'We talk about Python and software')).toBe('tech')
    expect(categorize('Repair Café', 'Volunteers fix your things')).toBe('volunteering')
    expect(categorize('Trivia Night')).toBe('nightlife')
    expect(categorize('Board Meeting')).toBeUndefined()
    expect(categorize('Story Time for toddlers')).toBe('family')
  })
})
