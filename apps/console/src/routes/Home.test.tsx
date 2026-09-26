import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gridWindow, monthGrid } from '../lib/dates'

const state = vi.hoisted(() => ({ search: {} as Record<string, string>, navigate: vi.fn(), params: undefined as unknown }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useSearch: () => state.search,
  useNavigate: () => state.navigate,
}))
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: ({ queryKey }: { queryKey: unknown }) => { state.params = queryKey; return { data: { pages: [{ events: [] }] }, isPending: false, error: null } },
  useQuery: () => ({ data: { days: {} } }),
}))
vi.mock('../lib/api', () => ({ api: {} }))
vi.mock('../lib/queries', () => ({ useConfig: () => ({ region: { slug: 'boulder', name: 'Boulder', tz: 'America/Denver' } }), useMe: () => ({}), keys: { publicEvents: (p: unknown) => p, publicEventCounts: (p: unknown) => p } }))
vi.mock('../components/Shell', () => ({ Page: ({ children }: { children: React.ReactNode }) => <main>{children}</main>, Footer: () => null, Flatirons: () => null }))
vi.mock('../components/Subscribe', () => ({ SubscribeMenu: () => null }))

import { HomeRoute } from './Home'

beforeEach(() => { state.search = {}; state.navigate.mockReset() })
describe('directory interactions', () => {
  it('keeps the full month and calendar controls when an empty day is selected', () => {
    state.search = { view: 'calendar', month: '2026-09', day: '2026-09-27' }
    render(<HomeRoute />)
    expect(state.params).toMatchObject(gridWindow(monthGrid('2026-09', 'America/Denver'), 'America/Denver'))
    expect(screen.getByRole('button', { name: 'This month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A little room in your calendar' })).toBeInTheDocument()
  })
  it('updates the search input on browser navigation and clears it with the filters', () => {
    state.search = { q: 'music' }
    const view = render(<HomeRoute />)
    expect(screen.getByRole('searchbox')).toHaveValue('music')
    state.search = { q: 'garden' }
    view.rerender(<HomeRoute />)
    expect(screen.getByRole('searchbox')).toHaveValue('garden')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(state.navigate).toHaveBeenCalledWith({ to: '/', search: { view: undefined } })
  })
  it('explains how to recover when geolocation is unavailable', () => {
    render(<HomeRoute />)
    fireEvent.click(screen.getByRole('button', { name: 'Near me' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Search for a place or explore the map instead')
  })
})
