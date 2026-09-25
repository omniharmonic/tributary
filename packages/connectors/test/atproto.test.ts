/**
 * Reading somebody's own calendar out of their repo.
 *
 * The case that matters most is the loop: the directory publishes into the same repo it
 * reads, so a record we wrote must never come back as a new event. Every record the
 * writer produces carries `additionalData.externalSource`, and that is the discriminator.
 */
import { describe, expect, it } from 'vitest'
import { atprotoConnector } from '../src/atproto/index.js'
import { cleanHandle, isDid, pdsFromDocument, resolveRepo } from '../src/atproto/identity.js'
import { parseLocations, toRawEvent } from '../src/atproto/record.js'
import type { FetchCtx } from '../src/sdk.js'

function ctx(routes: Record<string, { status?: number; body: unknown }>): FetchCtx {
  const find = (url: string) => Object.entries(routes).find(([k]) => url.startsWith(k))?.[1]
  const mk = async (url: string) => {
    const r = find(url)
    if (!r) return { url, status: 404, headers: {}, body: Buffer.alloc(0), text: () => '', contentType: 'application/json', notModified: false }
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    return { url, status: r.status ?? 200, headers: {}, body: Buffer.from(text), text: () => text, contentType: 'application/json', notModified: false }
  }
  return { http: { get: mk, head: mk, getPage: mk } as never, secrets: {}, log: { info() {}, warn() {} }, window: { from: new Date('2026-09-01'), to: new Date('2026-12-01') }, defaultTz: 'America/Denver' }
}

const DID = 'did:plc:ym5zg5gdppfg3h55hgqgvrqe'
const PDS = 'https://pds.example.com'
const rec = (rkey: string, value: Record<string, unknown>) => ({ uri: `at://${DID}/community.lexicon.calendar.event/${rkey}`, cid: 'bafy', value })

const FULL = {
  $type: 'community.lexicon.calendar.event',
  name: 'Repair cafe',
  description: 'Bring the broken thing.',
  createdAt: '2026-09-01T00:00:00.000Z',
  startsAt: '2026-10-04T10:00:00-06:00',
  endsAt: '2026-10-04T13:00:00-06:00',
  timezone: 'America/Denver',
  mode: 'community.lexicon.calendar.event#inperson',
  status: 'community.lexicon.calendar.event#scheduled',
  locations: [
    { $type: 'community.lexicon.location.address', name: 'Boulder Public Library', street: '1001 Arapahoe Ave', locality: 'Boulder', region: 'CO', country: 'US' },
    { $type: 'community.lexicon.location.geo', latitude: '40.0141', longitude: '-105.2836' },
  ],
  uris: [{ uri: 'https://example.org/repair', name: 'Details' }, { uri: 'https://example.org/rsvp' }],
  media: [{ role: 'thumbnail', alt: 'A soldering iron', content: { $type: 'blob', ref: { $link: 'bafkreiabc' }, mimeType: 'image/jpeg', size: 1 } }],
  preferences: { showInDiscovery: true },
  additionalData: { tags: ['repair', 'community'], category: 'community', isFree: true, organizerName: 'Repair Collective' },
}

describe('record → RawEvent', () => {
  it('reads the whole lexicon record, including the geo pair carried as strings', () => {
    const e = toRawEvent(rec('3abc', FULL), { pdsUrl: PDS, did: DID })!
    expect(e).toMatchObject({ externalId: '3abc', name: 'Repair cafe', start: '2026-10-04T10:00:00-06:00', end: '2026-10-04T13:00:00-06:00', tz: 'America/Denver', mode: 'inperson', status: 'scheduled', isFree: true, category: 'community', organizerName: 'Repair Collective' })
    expect(e.tags).toEqual(['repair', 'community'])
    expect(e.locations?.[0]).toMatchObject({ name: 'Boulder Public Library', street: '1001 Arapahoe Ave', lat: 40.0141, lon: -105.2836 })
    expect(e.url).toBe('https://example.org/repair')
    expect(e.imageUrl).toBe(`${PDS}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(DID)}&cid=bafkreiabc`)
    expect(e.imageAlt).toBe('A soldering iron')
  })

  it('skips a record an adapter mirrored, so reading a repo we publish into cannot loop', () => {
    const mirrored = { ...FULL, additionalData: { ...FULL.additionalData, externalSource: { platform: 'luma', url: 'https://lu.ma/x', method: 'luma' } } }
    expect(toRawEvent(rec('3zzz', mirrored), { pdsUrl: PDS, did: DID })).toBeNull()
  })

  it('carries the author’s own "not in discovery" through as unlisted', () => {
    const quiet = { ...FULL, preferences: { showInDiscovery: false } }
    expect(toRawEvent(rec('3q', quiet), { pdsUrl: PDS, did: DID })!.sourcePrivacy).toBe('unlisted')
    expect(toRawEvent(rec('3p', FULL), { pdsUrl: PDS, did: DID })!.sourcePrivacy).toBeUndefined()
  })

  it('refuses a record that is not an event', () => {
    expect(toRawEvent(rec('3n', { name: 'No date' }), { pdsUrl: PDS, did: DID })).toBeNull()
    expect(toRawEvent(rec('3m', { startsAt: '2026-10-04T10:00:00Z' }), { pdsUrl: PDS, did: DID })).toBeNull()
  })

  it('keeps an H3 cell as a label and never invents a pin inside it', () => {
    const { locations, geo } = parseLocations([{ $type: 'community.lexicon.location.hthree', value: '871f0d4ffffffff', name: 'Nederland' }])
    expect(geo).toBeUndefined()
    expect(locations?.[0]).toMatchObject({ name: 'Nederland' })
    expect(locations?.[0]?.lat).toBeUndefined()
  })
})

describe('identity', () => {
  it('accepts handles and DIDs and rejects everything else', () => {
    expect(cleanHandle('@Alice.Example.com')).toBe('alice.example.com')
    expect(cleanHandle('at://alice.example.com/foo')).toBe('alice.example.com')
    expect(cleanHandle('not a handle')).toBeNull()
    expect(cleanHandle('localhost')).toBeNull()
    expect(isDid(DID)).toBe(true)
    expect(isDid('did:plc:short')).toBe(false)
  })

  it('reads the PDS out of a DID document', () => {
    expect(pdsFromDocument({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: `${PDS}/` }] })).toBe(PDS)
    expect(pdsFromDocument({ service: [{ id: '#other', serviceEndpoint: PDS }] })).toBeNull()
    // A serviceEndpoint is a string a stranger chose; a non-URL is not one we will fetch.
    expect(pdsFromDocument({ service: [{ id: '#atproto_pds', serviceEndpoint: 'file:///etc/passwd' }] })).toBeNull()
  })

  it('prefers the handle’s own well-known over a third-party resolver', async () => {
    const c = ctx({ 'https://alice.example.com/.well-known/atproto-did': { body: DID }, 'https://plc.directory/': { body: { alsoKnownAs: ['at://alice.example.com'], service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] } } })
    expect(await resolveRepo('@alice.example.com', c.http)).toEqual({ did: DID, handle: 'alice.example.com', pdsUrl: PDS })
  })
})

describe('connector', () => {
  it('detects a handle only when it is marked as one, and always detects a DID', async () => {
    const c = ctx({})
    expect(await atprotoConnector.detect!({ text: '@alice.example.com' }, c)).toMatchObject({ type: 'atproto', hint: { actor: 'alice.example.com' } })
    expect(await atprotoConnector.detect!({ text: DID }, c)).toMatchObject({ hint: { actor: DID } })
    // A bare domain is a website until somebody says otherwise.
    expect(await atprotoConnector.detect!({ text: 'alice.example.com' }, c)).toBeNull()
  })

  it('pages the collection and reports the repo as a complete set', async () => {
    const base = `${PDS}/xrpc/com.atproto.repo.listRecords`
    const c = ctx({ [base]: { body: { records: [rec('3a', FULL), rec('3b', { ...FULL, name: 'Second' })] } } })
    const out = await atprotoConnector.fetch({ did: DID, pdsUrl: PDS, handle: 'alice.example.com', collection: 'community.lexicon.calendar.event' }, null, c)
    expect(out.events.map((e) => e.name)).toEqual(['Repair cafe', 'Second'])
    // Deletions are unambiguous here: we read the whole collection every time.
    expect(out.complete).toBe(true)
  })

  it('treats a repo with no calendar as empty rather than broken', async () => {
    const c = ctx({ [`${PDS}/xrpc/com.atproto.repo.listRecords`]: { status: 400, body: { error: 'InvalidRequest', message: 'Could not find collection' } } })
    const out = await atprotoConnector.fetch({ did: DID, pdsUrl: PDS, collection: 'community.lexicon.calendar.event' }, null, c)
    expect(out.events).toEqual([])
  })
})
