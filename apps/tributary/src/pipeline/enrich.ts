/**
 * Enrich (pipeline stage 4): cover image recovery, venue matching and geocoding,
 * categories. Cached by source URL and by normalized address.
 */
import { eq, sql } from 'drizzle-orm'
import { categorize, geocodeBest, inFrontRange, normalizeAddress, recoverImage } from '@tributary/connectors/enrich'
import { rehash, type NormalizedEvent } from '@tributary/event-model'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { geocodeCache, pageCache } from '../db/schema.js'
import { httpClient } from '../lib/http-client.js'
import { describeError, log } from '../lib/logging.js'

const PAGE_TTL_MS = 7 * 86_400_000

/** og:image frequency per domain, from the page cache: ≥3 distinct events ⇒ the site's default share image. */
async function ogSeen(domain: string, url: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(pageCache)
    .where(sql`${pageCache.meta}->>'imageUrl' = ${url} and ${pageCache.url} like ${'%' + domain + '%'}`)
  return Number(rows[0]?.n ?? 0)
}

/**
 * Correct a zone label the feed got wrong, for an event we can see is local.
 *
 * Localist serves `X-WR-TIMEZONE:Eastern Time (US & Canada)` on CU Boulder's feeds while
 * writing every DTSTART in UTC. The instants are right, so nothing needs moving, but the
 * label rode along and a December concert at Macky Auditorium read "9:30 PM EST" to
 * everyone in Boulder. `startsAt` carries an offset and not a zone, so this label is what
 * the card renders.
 *
 * This only ever relabels: `instant` is returned untouched, so an event cannot move by
 * being enriched. It applies only once the event is pinned inside the region, where its
 * local time is the region's by definition. All-day events are left alone, because for
 * them the zone decides which date is shown, and virtual events are left alone because
 * they have no local time to be wrong about.
 */
export function localizeZone(e: NormalizedEvent, regionTz: string): NormalizedEvent {
  if (e.mode === 'virtual' || e.start.allDay || e.start.tz === regionTz) return e
  const l = e.locations[0]
  if (l?.lat === undefined || l.lon === undefined || !inFrontRange(l.lat, l.lon)) return e
  return { ...e, start: { ...e.start, tz: regionTz, tzInferred: true } }
}


export interface EnrichOptions {
  /** Skip page fetches (preview mode fetches at most this many pages). */
  pageBudget?: number
  hostLogoHash?: string | null
  /**
   * The venue this whole source belongs to, if it has one. A single-venue calendar often
   * publishes its rooms and nothing else: Nederland Community Library's feed gives
   * "Community Room" with no street and no town, which nothing on earth could geocode,
   * and all 199 of its events landed unpinned. The source's own name is the missing half
   * of that address, and it is usually already in the gazetteer.
   */
  venueHint?: string | null
}

export async function enrich(events: NormalizedEvent[], opts: EnrichOptions = {}): Promise<NormalizedEvent[]> {
  const c = config()
  const http = httpClient()
  let budget = opts.pageBudget ?? 200
  const out: NormalizedEvent[] = []
  // Pre-load the og:image frequency table once per run.
  const seenCounts = new Map<string, number>()
  const seen = (domain: string, url: string) => seenCounts.get(`${domain}|${url}`) ?? 0

  for (const e0 of events) {
    let e = e0
    try {
      // Images.
      if (!e.image?.url || e.provenance.method === 'luma' || e.provenance.method === 'meetup' || e.provenance.method === 'ics') {
        const cached = await getDb().select().from(pageCache).where(eq(pageCache.url, e.sourceUrl)).limit(1)
        const fresh = cached[0] && Date.now() - cached[0].fetchedAt.getTime() < PAGE_TTL_MS
        let imageUrl: string | undefined = fresh ? (cached[0]!.meta.imageUrl as string | undefined) : undefined
        let alt: string | undefined = fresh ? (cached[0]!.meta.imageAlt as string | undefined) : undefined
        if (!fresh && budget > 0 && /^https?:\/\//.test(e.sourceUrl)) {
          budget--
          const domain = new URL(e.sourceUrl).hostname
          for (const [k] of seenCounts) void k
          const r = await recoverImage({ sourceUrl: e.sourceUrl, platform: e.provenance.platform, existing: e.image?.url }, { http, seen: (d, u) => seen(d, u), log })
          if (r?.via === 'og') {
            const n = await ogSeen(domain, r.url)
            seenCounts.set(`${domain}|${r.url}`, n)
            if (n >= 3) imageUrl = undefined
            else imageUrl = r.url
          } else imageUrl = r?.url
          alt = r?.alt
          await getDb()
            .insert(pageCache)
            .values({ url: e.sourceUrl, meta: { imageUrl: imageUrl ?? null, imageAlt: alt ?? null, via: r?.via ?? null }, fetchedAt: new Date() })
            .onConflictDoUpdate({ target: pageCache.url, set: { meta: { imageUrl: imageUrl ?? null, imageAlt: alt ?? null, via: r?.via ?? null }, fetchedAt: new Date() } })
        }
        if (imageUrl && (!e.image?.url || imageUrl !== e.image.url)) e = { ...e, image: { url: imageUrl, alt, origin: 'source' } }
      }
      if (!e.image && opts.hostLogoHash) e = { ...e, image: { bytesRef: opts.hostLogoHash, origin: 'host-logo' } }

      // Places: the gazetteer first because it is free and also corrects the name and
      // address, then Photon on the parsed street, then Photon on the raw string.
      if (e.mode !== 'virtual' && e.locations.length > 0) {
        const l = e.locations[0]!
        const text = [l.name, l.street, l.locality].filter(Boolean).join(', ')
        if (text) {
          const key = normalizeAddress(text)
          const cached = await getDb().select().from(geocodeCache).where(eq(geocodeCache.key, key)).limit(1)
          // The gazetteer always runs: it is offline, free, and also corrects the venue
          // name and address. Photon only runs when the gazetteer missed AND we have no
          // cached answer for this address.
          const best = await geocodeBest(text, { photonUrl: cached[0] ? '' : c.PHOTON_URL, http }).catch(() => undefined)
          if (!cached[0] && best && best.via !== 'venue') {
            await getDb()
              .insert(geocodeCache)
              .values({ key, lat: String(best.result.lat), lon: String(best.result.lon), precision: best.result.precision })
              .onConflictDoNothing()
          }
          // Only when the event gave a bare room name: no street, no town, and nothing
          // resolved. Never enough to override a place the event actually stated.
          let fallback: Awaited<ReturnType<typeof geocodeBest>> | undefined
          if (!best?.venue && !l.street && !l.locality && l.lat === undefined && opts.venueHint) {
            fallback = await geocodeBest(opts.venueHint, { photonUrl: '', http }).catch(() => undefined)
            if (fallback?.venue) {
              const room = l.name
              const hall = fallback.venue
              e = { ...e, locations: [{ ...l, name: room && room !== hall.name ? `${hall.name}, ${room}` : hall.name, street: hall.street, locality: hall.locality, region: hall.region, postalCode: hall.postalCode, country: hall.country, lat: hall.lat, lon: hall.lon }, ...e.locations.slice(1)] }
            }
          }
          const v = fallback?.venue ? undefined : best?.venue
          if (v) {
            e = { ...e, locations: [{ ...l, name: v.name, street: l.street ?? v.street, locality: l.locality ?? v.locality, region: l.region ?? v.region, postalCode: l.postalCode ?? v.postalCode, country: l.country ?? v.country, lat: l.lat ?? v.lat, lon: l.lon ?? v.lon, precision: v.precision === 'exact' ? l.precision : 'neighborhood' }, ...e.locations.slice(1)] }
          }
          const r = fallback?.venue ? undefined : best?.result ?? (cached[0]?.lat ? { lat: Number(cached[0].lat), lon: Number(cached[0].lon), precision: (cached[0].precision ?? 'exact') as 'exact' | 'city' } : undefined)
          if (r && e.locations[0]!.lat === undefined) {
            // A city centroid is not a pin. Record it as a coarse location instead.
            e = r.precision === 'exact'
              ? { ...e, locations: [{ ...e.locations[0]!, lat: r.lat, lon: r.lon }, ...e.locations.slice(1)] }
              : { ...e, locations: [{ ...e.locations[0]!, lat: r.lat, lon: r.lon, precision: 'city' }, ...e.locations.slice(1)] }
          }
          if (r?.locality && !e.locations[0]!.locality) e = { ...e, locations: [{ ...e.locations[0]!, locality: r.locality, region: r.region ?? e.locations[0]!.region, postalCode: r.postalCode ?? e.locations[0]!.postalCode }, ...e.locations.slice(1)] }
        }
        // A bare locality still helps the region filter even with no coordinates.
        if (!e.locations[0]!.locality && /boulder/i.test(text || '')) e = { ...e, locations: [{ ...e.locations[0]!, locality: 'Boulder', region: 'CO' }, ...e.locations.slice(1)] }
      }

      e = localizeZone(e, c.REGION_TZ)

      // Categories.
      if (!e.category) {
        const cat = categorize(e.name, e.descriptionMd, e.tags)
        if (cat) e = { ...e, category: cat }
      }
    } catch (err) {
      log.warn('enrichment failed for an event; publishing without it', { detail: describeError(err) })
    }
    out.push(rehash(e))
  }
  return out
}
