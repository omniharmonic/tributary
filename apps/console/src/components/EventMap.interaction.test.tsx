import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicEvent } from '../lib/types'

const mock = vi.hoisted(() => ({ load: undefined as (() => void) | undefined, fit: vi.fn(), ease: vi.fn(), data: vi.fn() }))
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(), NavigationControl: class {},
  Map: class {
    addControl() {}
    on(type: string, callback: unknown) { if (type === 'load') mock.load = callback as () => void }
    addSource() {} addLayer() {} remove() {} resize() {} setFilter() {}
    getSource() { return { setData: mock.data } }
    getZoom() { return 12 }
    fitBounds = mock.fit
    easeTo = mock.ease
  },
}))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/test-worker.js' }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
import { EventMap } from './EventMap'

const events = [{ did: 'did:example:one', rkey: 'a', card: { key: 'a', name: 'Library workshop', when: 'Tomorrow at 10', startsAt: '2026-09-27T10:00:00Z', geo: { lat: 40, lon: -105 }, place: 'Main library', platform: 'google', visibility: 'public', missing: [] } }] as unknown as PublicEvent[]
beforeEach(() => {
  mock.load = undefined
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => vi.unstubAllGlobals())

describe('map browsing', () => {
  it('preserves a place selected while the basemap is loading', async () => {
    render(<EventMap events={events} center={{ lat: 40, lon: -105 }} hrefFor={() => '/event/a'} />)
    fireEvent.click(screen.getByRole('button', { name: /Main library/ }))
    expect(screen.getByRole('link', { name: 'View event' })).toHaveAttribute('href', '/event/a')
    await vi.waitFor(() => expect(mock.load).toBeDefined())
    await act(async () => mock.load!())
    expect(screen.getByRole('link', { name: 'View event' })).toBeInTheDocument()
    expect(mock.ease).toHaveBeenCalledWith(expect.objectContaining({ center: [-105, 40] }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset map' }))
    expect(screen.getByRole('button', { name: /Main library/ })).toBeInTheDocument()
  })
  it('does not refit the map when only the parent rerenders', async () => {
    const view = render(<EventMap events={events} center={{ lat: 40, lon: -105 }} hrefFor={() => '/event/a'} />)
    await vi.waitFor(() => expect(mock.load).toBeDefined())
    await act(async () => mock.load!())
    const fits = mock.fit.mock.calls.length
    view.rerender(<EventMap events={events} center={{ lat: 40, lon: -105 }} hrefFor={() => '/event/a'} />)
    expect(mock.fit).toHaveBeenCalledTimes(fits)
  })
})
