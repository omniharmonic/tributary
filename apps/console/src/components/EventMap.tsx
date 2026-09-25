/**
 * Where things are.
 *
 * Only events whose place is exact and public carry coordinates — `toCard` decides that
 * once, with the same test that decides whether the card prints a street address — so a
 * pin on this map can never be a location somebody chose to withhold. Events without a
 * pin are counted underneath rather than dropped silently, because "nothing near you"
 * and "we could not place forty of these" are different answers.
 *
 * MapLibre and the basemap load only when this view is opened; the list and calendar
 * never pay for them.
 */
import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { PublicEvent } from '../lib/types'

/** CARTO's Positron: grey land, quiet labels — it lets the pins be the only colour. */
const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export interface EventMapProps {
  events: PublicEvent[]
  /** The region's rough middle, for the first frame before any pin is known. */
  center: { lat: number; lon: number }
  onPick: (ids: string[]) => void
  hrefFor: (e: PublicEvent) => string
}

interface Feature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { key: string; name: string; when: string; href: string }
}

function toFeatures(events: PublicEvent[], hrefFor: (e: PublicEvent) => string): Feature[] {
  const out: Feature[] = []
  for (const e of events) {
    const g = e.card.geo
    if (!g) continue
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: { key: e.card.key, name: e.card.name, when: e.card.when, href: hrefFor(e) } })
  }
  return out
}

/**
 * The box to frame, ignoring outliers.
 *
 * Fitting to the extremes means one stray pin decides the whole view: twenty-six events
 * carrying a Squarespace placeholder in Manhattan once zoomed this map out to the
 * continent, with Boulder as a dot. The pipeline drops those pins now, but a map whose
 * usefulness depends on every coordinate being right is a map that will break again.
 *
 * So the frame is the 5th to 95th percentile in each axis, widened a little. Genuine
 * far-flung events still get a pin; they just do not get to choose the zoom.
 */
export function frameFor(features: Feature[]): [[number, number], [number, number]] | null {
  if (features.length === 0) return null
  const lons = features.map((f) => f.geometry.coordinates[0]).sort((a, b) => a - b)
  const lats = features.map((f) => f.geometry.coordinates[1]).sort((a, b) => a - b)
  const at = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * p)))]!
  // Under about twenty pins a percentile is not a percentile; use the extremes.
  const [lo, hi] = features.length < 20 ? [0, 1] : [0.05, 0.95]
  const west = at(lons, lo)
  const east = at(lons, hi)
  const south = at(lats, lo)
  const north = at(lats, hi)
  // A single point, or a row of points on one street, has no area to fit.
  const pad = 0.01
  return [
    [west - pad, south - pad],
    [east + pad, north + pad],
  ]
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function EventMap({ events, center, onPick, hrefFor }: EventMapProps) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const pinned = events.filter((e) => e.card.geo)
  const unplaced = events.length - pinned.length

  // Load the library and the basemap once, on first render of this view.
  useEffect(() => {
    let cancelled = false
    let created: MapLibreMap | null = null
    void (async () => {
      try {
        const [maplibre, workerUrl] = await Promise.all([
          import('maplibre-gl'),
          // MapLibre resolves its worker relative to its own module URL, which after
          // bundling points at a file that was never emitted. The request then fell
          // through to the SPA's index.html and the worker died parsing HTML. Letting
          // Vite build the worker and handing MapLibre the real URL is the whole fix.
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url').then((m) => m.default as string),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ])
        const { Map, NavigationControl, setWorkerUrl } = maplibre
        setWorkerUrl(workerUrl)
        if (cancelled || !holder.current) return
        created = new Map({
          container: holder.current,
          style: prefersDark() ? DARK_STYLE : LIGHT_STYLE,
          center: [center.lon, center.lat],
          zoom: 10.5,
          attributionControl: { compact: true },
        })
        created.addControl(new NavigationControl({ showCompass: false }), 'top-right')
        created.on('load', () => {
          if (cancelled) return
          created!.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 })
          created!.addLayer({ id: 'clusters', type: 'circle', source: 'events', filter: ['has', 'point_count'], paint: { 'circle-color': '#b8641a', 'circle-opacity': 0.9, 'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 40, 27], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } })
          created!.addLayer({ id: 'cluster-count', type: 'symbol', source: 'events', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#ffffff' } })
          created!.addLayer({ id: 'pin', type: 'circle', source: 'events', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#2e5e48', 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } })

          // A cluster zooms in; a pin opens whatever shares that spot.
          created!.on('click', 'clusters', (ev) => {
            const f = created!.queryRenderedFeatures(ev.point, { layers: ['clusters'] })[0]
            const id = f?.properties?.cluster_id
            if (id === undefined) return
            void (created!.getSource('events') as GeoJSONSource).getClusterExpansionZoom(Number(id)).then((zoom) => {
              created!.easeTo({ center: (f!.geometry as { coordinates: [number, number] }).coordinates, zoom })
            })
          })
          created!.on('click', 'pin', (ev) => {
            const here = created!.queryRenderedFeatures(ev.point, { layers: ['pin'] })
            onPick(here.map((f) => String(f.properties?.key ?? '')).filter(Boolean))
          })
          for (const layer of ['clusters', 'pin']) {
            created!.on('mouseenter', layer, () => (created!.getCanvas().style.cursor = 'pointer'))
            created!.on('mouseleave', layer, () => (created!.getCanvas().style.cursor = ''))
          }
          map.current = created
          setReady(true)
        })
        created.on('error', () => setFailed(true))
      } catch {
        setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      created?.remove()
      map.current = null
    }
    // The map is created once; pins and framing are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pins follow the filtered list.
  useEffect(() => {
    if (!ready || !map.current) return
    const features = toFeatures(events, hrefFor)
    const src = map.current.getSource('events') as GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features } as never)
    if (features.length === 0) return
    const bounds = frameFor(features)
    if (!bounds) return
    map.current.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 })
  }, [events, ready, hrefFor])

  if (failed) {
    return (
      <div className="panel p-6 text-center">
        <h3>The map could not load</h3>
        <p className="mt-1 text-ink-soft">The basemap comes from another server, which may be blocked or unreachable. The list and calendar views have the same events.</p>
      </div>
    )
  }

  return (
    <div>
      <div ref={holder} className="map-holder" role="application" aria-label={`Map of ${pinned.length} events`} />
      <p className="mt-2 text-sm text-ink-soft">
        {pinned.length} {pinned.length === 1 ? 'event' : 'events'} on the map
        {unplaced > 0 ? <span className="text-ink-faint">. {unplaced} more have no exact address yet, so they are only in the list.</span> : null}
      </p>
    </div>
  )
}
