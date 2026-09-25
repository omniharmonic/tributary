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
        const [{ Map, NavigationControl }] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
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
    let west = 180
    let south = 90
    let east = -180
    let north = -90
    for (const f of features) {
      const [lon, lat] = f.geometry.coordinates
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
    map.current.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 56, maxZoom: 14, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 },
    )
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
