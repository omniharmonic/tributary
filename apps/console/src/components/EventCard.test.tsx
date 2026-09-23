import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EventCard as Model } from '../lib/types'
import { EventCard } from './EventCard'

const base: Model = {
  key: 'k',
  name: 'Seed Swap',
  startsAt: '2026-10-04T16:00:00.000Z',
  endsAt: '2026-10-04T19:00:00.000Z',
  timezone: 'America/Denver',
  allDay: false,
  when: 'Sun, Oct 4 · 10 AM – 1 PM MDT',
  status: 'scheduled',
  mode: 'inperson',
  place: 'Boulder Public Library',
  placeCoarse: false,
  imageUrl: 'https://example.org/x.jpg',
  imageOrigin: 'source',
  sourceUrl: 'https://lu.ma/x',
  platform: 'luma',
  tags: [],
  visibility: 'public',
  missing: [],
  complete: true,
}

describe('EventCard', () => {
  it('renders a complete card with image, when, place and source badge', () => {
    render(<EventCard card={base} provenance="domain" />)
    expect(screen.getByRole('article', { name: 'Seed Swap' })).toBeInTheDocument()
    expect(screen.getByText('Sun, Oct 4 · 10 AM – 1 PM MDT')).toBeInTheDocument()
    expect(screen.getByText(/Boulder Public Library/)).toBeInTheDocument()
    expect(screen.getByText('via Luma')).toBeInTheDocument()
    expect(screen.getByText('Verified domain')).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://example.org/x.jpg')
  })
  it('falls back to a placeholder and lists what is missing', () => {
    render(<EventCard card={{ ...base, imageUrl: undefined, imageOrigin: undefined, missing: ['image'], complete: false }} showMissing />)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText(/Missing: image/)).toBeInTheDocument()
  })
  it('marks cancelled events and coarse locations', () => {
    render(<EventCard card={{ ...base, status: 'cancelled', placeCoarse: true, place: 'Boulder, CO', visibility: 'gated' }} />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText(/exact location shared with confirmed guests/)).toBeInTheDocument()
  })
  it('names the real audience on a gated event when we know it', () => {
    render(<EventCard card={{ ...base, placeCoarse: true, place: 'Boulder, CO', visibility: 'members' }} audienceName="Wednesday Sangha" />)
    expect(screen.getByText(/exact location shared with Wednesday Sangha/)).toBeInTheDocument()
  })
  it('does not claim a secret on a public event we merely failed to geocode', () => {
    // A coarse place on a public event means the geocoder stopped at the city centroid,
    // not that anyone is withholding the address.
    render(<EventCard card={{ ...base, placeCoarse: true, place: 'Boulder, CO', visibility: 'public' }} />)
    expect(screen.queryByText(/confirmed guests/)).toBeNull()
    expect(screen.getByText(/approximate location/)).toBeInTheDocument()
  })
})
