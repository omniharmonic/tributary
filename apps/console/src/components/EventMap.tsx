import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { PublicEvent } from '../lib/types'
import { Icon } from './Icon'
import { EventCard } from './EventCard'

export interface EventMapProps {
  events: PublicEvent[]
  center: { lat: number; lon: number }
  hrefFor: (e: PublicEvent) => string
}
interface Feature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { key: string; name: string; when: string; href: string }
}
export interface MapPlace {
  key: string
  name: string
  coordinates: [number, number]
  events: PublicEvent[]
}

/** One selectable place per coordinate, including every event sharing that address.
 * Only the public coordinates provided by the API are used. */
export function placesFor(events: PublicEvent[]): MapPlace[] {
  const places = new Map<string, MapPlace>()
  for (const event of events) {
    const geo = event.card.geo
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon) || Math.abs(geo.lat) > 90 || Math.abs(geo.lon) > 180) continue
    const key = `${geo.lon},${geo.lat}`
    const place = places.get(key) ?? { key, name: event.card.place ?? 'Event location', coordinates: [geo.lon, geo.lat], events: [] }
    place.events.push(event)
    places.set(key, place)
  }
  for (const place of places.values()) place.events.sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt))
  return [...places.values()].sort((a, b) => a.events[0]!.card.startsAt.localeCompare(b.events[0]!.card.startsAt))
}

/** Keep stray geocoding outliers from choosing the initial zoom. */
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

const duration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450

export function EventMap({ events, center, hrefFor }: EventMapProps) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const resultsScroll = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selection, setSelection] = useState<string | null>(null)
  const [showUnplaced, setShowUnplaced] = useState(false)
  const places = useMemo(() => placesFor(events), [events])
  const features = useMemo(() => places.map((p): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.coordinates }, properties: { key: p.key, name: p.name, when: '', href: '' } })), [places])
  const selected = places.find((p) => p.key === selection)
  const pinned = places.reduce((n, p) => n + p.events.length, 0)
  const placedEvents = new Set(places.flatMap((p) => p.events))
  const unplaced = events.filter((e) => !placedEvents.has(e))

  const fit = () => {
    const bounds = frameFor(features)
    if (bounds && map.current) map.current.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: duration() })
  }

  useEffect(() => {
    let cancelled = false
    let created: MapLibreMap | null = null
    let styleLoaded = false
    let resize: ResizeObserver | undefined
    setReady(false)
    setFailed(false)
    const timeout = window.setTimeout(() => { if (!cancelled && !styleLoaded) setFailed(true) }, 15000)
    void (async () => {
      try {
        const [lib, workerUrl] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url').then((m) => m.default as string),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ])
        if (cancelled || !holder.current) return
        lib.setWorkerUrl(workerUrl)
        created = new lib.Map({
          container: holder.current,
          style: `/api/public/basemap/style.json${window.matchMedia('(prefers-color-scheme: dark)').matches ? '?theme=dark' : ''}`,
          center: [center.lon, center.lat], zoom: 10.5,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        })
        created.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right')
        resize = new ResizeObserver(() => created?.resize())
        resize.observe(holder.current)
        created.on('load', () => {
          if (cancelled) return
          styleLoaded = true
          window.clearTimeout(timeout)
          setFailed(false)
          created!.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 })
          created!.addLayer({ id: 'clusters', type: 'circle', source: 'events', filter: ['has', 'point_count'], paint: { 'circle-color': '#245a73', 'circle-radius': ['step', ['get', 'point_count'], 20, 10, 25, 40, 30], 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } })
          created!.addLayer({ id: 'cluster-count', type: 'symbol', source: 'events', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#ffffff' } })
          created!.addLayer({ id: 'pin', type: 'circle', source: 'events', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#347465', 'circle-radius': 11, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } })
          created!.addLayer({ id: 'selected', type: 'circle', source: 'events', filter: ['==', ['get', 'key'], ''], paint: { 'circle-color': '#245a73', 'circle-radius': 17, 'circle-opacity': 0.25, 'circle-stroke-width': 3, 'circle-stroke-color': '#245a73' } })
          created!.on('click', 'clusters', (ev) => {
            const f = created!.queryRenderedFeatures(ev.point, { layers: ['clusters'] })[0]
            const id = f?.properties?.cluster_id
            if (id === undefined) return
            void (created!.getSource('events') as GeoJSONSource).getClusterExpansionZoom(Number(id)).then((zoom) => {
              if (!cancelled) created!.easeTo({ center: (f!.geometry as { coordinates: [number, number] }).coordinates, zoom, duration: duration() })
            }).catch(() => { /* A filter may replace the source while expansion is pending. */ })
          })
          created!.on('click', 'pin', (ev) => {
            const f = created!.queryRenderedFeatures(ev.point, { layers: ['pin'] })[0]
            if (f?.properties?.key) { setSelection(String(f.properties.key)); setShowUnplaced(false) }
          })
          for (const layer of ['clusters', 'pin']) {
            created!.on('mouseenter', layer, () => { created!.getCanvas().style.cursor = 'pointer' })
            created!.on('mouseleave', layer, () => { created!.getCanvas().style.cursor = '' })
          }
          map.current = created
          setReady(true)
        })
        created.on('error', () => { if (!cancelled && !styleLoaded) setFailed(true) })
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true; window.clearTimeout(timeout); resize?.disconnect(); created?.remove(); map.current = null }
    // The initial center is a regional fallback; event bounds control subsequent framing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  useEffect(() => {
    if (!ready || !map.current) return
    ;(map.current.getSource('events') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features })
    fit()
    // Features change only when event results change, never while typing or selecting a place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, ready])

  useEffect(() => { setSelection(null); setShowUnplaced(false) }, [features])

  useEffect(() => {
    if (!ready || !map.current) return
    map.current.setFilter('selected', ['==', ['get', 'key'], selected?.key ?? ''])
    if (selected) {
      map.current.easeTo({ center: selected.coordinates, zoom: Math.max(map.current.getZoom(), 15.5), duration: duration() })
    }
  }, [selected, ready])

  useEffect(() => {
    if (resultsScroll.current) resultsScroll.current.scrollTop = 0
    if (selected || showUnplaced) detailHeading.current?.focus({ preventScroll: true })
  }, [selected, showUnplaced])

  const reset = () => { setSelection(null); setShowUnplaced(false); detailHeading.current?.focus({ preventScroll: true }); fit() }
  return (
    <section className="map-explorer" aria-label="Explore events by location">
      <div className="map-toolbar">
        <div><strong>{pinned} {pinned === 1 ? 'event' : 'events'} at {places.length} {places.length === 1 ? 'place' : 'places'}</strong><p>Choose a pin or a place. Numbers group nearby places.</p></div>
        <button type="button" className="btn btn-sm" onClick={reset} disabled={!ready || places.length === 0}><Icon name="map" />Reset map</button>
      </div>
      <div className="map-layout">
        <div className="map-stage">
          <div ref={holder} className="map-holder" role="region" aria-label="Event locations. Use the places list for keyboard access." />
          {!ready && !failed ? <div className="map-message" role="status">Loading the map…</div> : null}
          {failed ? <div className="map-message" role="alert"><h3>The map couldn’t load</h3><p>You can still browse all the places and events here.</p><button className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>Retry map</button></div> : null}
          {ready && places.length === 0 ? <div className="map-message"><h3>No exact locations to show</h3><p>Browse events without map pins in the list.</p></div> : null}
          <div className="map-legend"><span />Event location<span className="cluster-dot" />Nearby places</div>
        </div>
        <aside className="map-results" aria-label="Places and events">
          <div className="map-results-heading">
            {selected || showUnplaced ? <button type="button" className="text-sm text-slate underline underline-offset-4" onClick={reset}>Back to all places</button> : null}
            <h3 ref={detailHeading} tabIndex={-1}>{showUnplaced ? 'Events without map pins' : selected ? selected.name : 'Find your next stop'}</h3>
            <p className="text-sm text-ink-soft">{showUnplaced ? 'Online, private, or without an exact address.' : selected ? `${selected.events.length} ${selected.events.length === 1 ? 'event' : 'events'} at this location` : 'Select a place to see what’s happening.'}</p>
          </div>
          <div ref={resultsScroll} className="map-results-scroll">
            {selected || showUnplaced ? <div className="map-event-list">{(showUnplaced ? unplaced : selected!.events).map((e) => <EventCard key={`${e.did}/${e.rkey ?? e.card.key}`} card={e.card} compact href={hrefFor(e)} action={<a className="map-detail-link" href={hrefFor(e)}>View event<Icon name="arrow" /></a>} />)}</div> : <ul className="map-place-list">{places.map((place) => <li key={place.key}><button type="button" className="map-place" onClick={() => { setSelection(place.key); setShowUnplaced(false) }}><span className="place-icon"><Icon name="pin" /></span><span><strong>{place.name}</strong><span>{place.events[0]!.card.name}</span><small>{place.events.length} {place.events.length === 1 ? 'event' : 'events'}</small></span><Icon name="arrow" /></button></li>)}</ul>}
            {!selected && !showUnplaced && unplaced.length > 0 ? <button type="button" className="unplaced-button" onClick={() => setShowUnplaced(true)}>{unplaced.length} more {unplaced.length === 1 ? 'event' : 'events'} without map pins<Icon name="arrow" /></button> : null}
          </div>
        </aside>
      </div>
    </section>
  )
}
