import { describe, expect, it } from 'vitest'
import { groupDuplicates } from '../src/duplicates.js'

const base = { startsAt: '2026-10-04T16:00:00.000Z', timezone: 'America/Denver' }

describe('groupDuplicates', () => {
  it('groups by canonical source url and by (date, title)', () => {
    const out = groupDuplicates([
      { key: 'a', name: 'Seed Swap and Garden Planning', sourceUrl: 'https://lu.ma/x', platform: 'luma', ...base, publishedAt: '2026-09-01' },
      { key: 'b', name: 'Seed Swap & Garden Planning', sourceUrl: 'https://meetup.com/g/1', platform: 'meetup', ...base, publishedAt: '2026-09-02' },
      { key: 'c', name: 'Seed Swap', sourceUrl: 'https://other.org/e', platform: 'web', ...base },
      { key: 'd', name: 'Poetry Night', sourceUrl: 'https://lu.ma/y', platform: 'luma', ...base },
    ])
    expect(out).toHaveLength(3)
    const seed = out.find((x) => x.key === 'a')!
    expect(seed.alsoOn.map((x) => x.platform)).toEqual(['meetup'])
    // "Seed Swap" is too short a prefix (< 12 chars) to be merged.
    expect(out.some((x) => x.key === 'c')).toBe(true)
  })
  it('prefers a host-connected source over an aggregator', () => {
    const out = groupDuplicates([
      { key: 'agg', name: 'Community Repair Cafe Evening', sourceUrl: 'https://agg.org/1', platform: 'web', ...base, publishedAt: '2026-08-01' },
      { key: 'host', name: 'Community Repair Cafe Evening', sourceUrl: 'https://lu.ma/z', platform: 'luma', ...base, publishedAt: '2026-09-01' },
    ])
    expect(out[0]!.key).toBe('host')
    expect(out[0]!.alsoOn[0]!.key).toBe('agg')
  })
  it('does not merge different days', () => {
    const out = groupDuplicates([
      { key: 'a', name: 'Weekly Farmers Market Morning', sourceUrl: 'https://a/1', platform: 'web', ...base },
      { key: 'b', name: 'Weekly Farmers Market Morning', sourceUrl: 'https://b/1', platform: 'web', startsAt: '2026-10-11T16:00:00.000Z', timezone: 'America/Denver' },
    ])
    expect(out).toHaveLength(2)
  })
})
