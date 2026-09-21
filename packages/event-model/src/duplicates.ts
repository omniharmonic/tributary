/**
 * Cross-source duplicate grouping (architecture §7, PRD F18): the same event arriving
 * from two sources shows as one card with "also on" links. Group by canonical source
 * URL first, then by (local date, normalized title) with community-calendar's guards:
 * exact keys first, prefix match only above 12 characters and under a 75% length
 * ratio. No model-based fuzzy matching. The primary source wins: a host-connected
 * source over a curator listing, then the earliest published.
 */
import { DateTime } from 'luxon'
import { normalizeTitle } from './hash.js'

export interface Dupable {
  key: string
  name: string
  startsAt: string
  timezone: string
  sourceUrl: string
  platform: string
  /** Lower ranks win. */
  rank?: number
  /** Tie-break: earlier wins. */
  publishedAt?: string
}

export interface AlsoOn {
  platform: string
  sourceUrl: string
  key: string
}

const AGGREGATORS = new Set(['web', 'api', 'manual', 'file', 'extract'])

export function groupDuplicates<T extends Dupable>(items: T[]): Array<T & { alsoOn: AlsoOn[] }> {
  const byUrl = new Map<string, T[]>()
  const order: string[] = []
  for (const it of items) {
    const k = it.sourceUrl.toLowerCase()
    if (!byUrl.has(k)) {
      byUrl.set(k, [])
      order.push(k)
    }
    byUrl.get(k)!.push(it)
  }
  // Second pass: (date, title) buckets across different URLs.
  const groups: T[][] = []
  const bucketOf = new Map<string, number>()
  const titleIndex: Array<{ date: string; title: string; group: number }> = []
  for (const k of order) {
    const members = byUrl.get(k)!
    const first = members[0]!
    const date = DateTime.fromISO(first.startsAt, { zone: 'utc' }).setZone(first.timezone).toISODate() ?? first.startsAt.slice(0, 10)
    const title = normalizeTitle(first.name)
    const exact = bucketOf.get(`${date}|${title}`)
    let g = exact
    if (g === undefined && title.length > 12) {
      const hit = titleIndex.find((t) => t.date === date && t.title.length > 12 && (t.title.startsWith(title) || title.startsWith(t.title)) && Math.min(t.title.length, title.length) / Math.max(t.title.length, title.length) >= 0.75)
      g = hit?.group
    }
    if (g === undefined) {
      g = groups.length
      groups.push([])
      bucketOf.set(`${date}|${title}`, g)
      titleIndex.push({ date, title, group: g })
    }
    groups[g]!.push(...members)
  }
  return groups.map((members) => {
    const sorted = [...members].sort((a, b) => (a.rank ?? rankOf(a)) - (b.rank ?? rankOf(b)) || (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
    const primary = sorted[0]!
    const alsoOn: AlsoOn[] = []
    const seen = new Set([primary.sourceUrl.toLowerCase()])
    for (const m of sorted.slice(1)) {
      const u = m.sourceUrl.toLowerCase()
      if (seen.has(u)) continue
      seen.add(u)
      alsoOn.push({ platform: m.platform, sourceUrl: m.sourceUrl, key: m.key })
    }
    return { ...primary, alsoOn }
  })
}

function rankOf(d: Dupable): number {
  return AGGREGATORS.has(d.platform) ? 1 : 0
}
