import { DateTime } from 'luxon'

export type Bucket = 'tonight' | 'weekend' | 'week' | 'later'

export const BUCKET_LABEL: Record<Bucket, string> = {
  tonight: 'Tonight',
  weekend: 'This weekend',
  week: 'This week',
  later: 'Later',
}

/** Which time-first bucket an instant belongs to, in the region's zone. */
export function bucketFor(startsAt: string, tz: string, now = DateTime.now()): Bucket {
  const n = now.setZone(tz)
  const s = DateTime.fromISO(startsAt, { zone: 'utc' }).setZone(tz)
  if (s.hasSame(n, 'day')) return 'tonight'
  const endOfWeek = n.endOf('week') // Sunday
  const sat = n.startOf('week').plus({ days: 5 })
  const isWeekendDay = s.weekday === 6 || s.weekday === 7
  if (s <= endOfWeek && isWeekendDay && s >= sat.startOf('day')) return 'weekend'
  if (s <= endOfWeek) return 'week'
  return 'later'
}

/**
 * The server window a bucket needs, as ISO instants.
 *
 * The page asks for one chronological page and sorts it into buckets in the browser.
 * That was fine when the directory held a few dozen events; at a thousand the page fills
 * with the next five days and "Later" is empty not because nothing is planned but
 * because the rows never arrived. So a chosen chip fetches its own window.
 *
 * These must stay a superset of what `bucketFor` assigns, or the section would request
 * rows and then drop them. `bucketFor` tests `tonight` first, so on a Saturday the
 * weekend window still yields only Sunday, which is what the reader sees either way.
 */
export function windowFor(bucket: Bucket, tz: string, now = DateTime.now()): { from: string; to: string } {
  const n = now.setZone(tz)
  const iso = (d: DateTime) => d.toUTC().toISO() ?? ''
  // Something that began within the last three hours is still on.
  const onNow = n.minus({ hours: 3 })
  switch (bucket) {
    case 'tonight':
      return { from: iso(onNow), to: iso(n.endOf('day')) }
    case 'weekend': {
      const sat = n.startOf('week').plus({ days: 5 }).startOf('day')
      return { from: iso(sat < onNow ? onNow : sat), to: iso(n.endOf('week')) }
    }
    case 'week':
      return { from: iso(onNow), to: iso(n.endOf('week')) }
    case 'later':
      return { from: iso(n.endOf('week')), to: iso(n.endOf('week').plus({ days: 120 })) }
  }
}

export function dayKey(startsAt: string, tz: string): string {
  return DateTime.fromISO(startsAt, { zone: 'utc' }).setZone(tz).toISODate() ?? ''
}

export function dayParts(iso: string, tz: string): { num: string; dow: string; month: string } {
  const d = DateTime.fromISO(iso, { zone: tz })
  return { num: d.toFormat('d'), dow: d.toFormat('ccc'), month: d.toFormat('LLL') }
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = DateTime.fromISO(iso)
  return d.toRelative({ style: 'short' }) ?? d.toLocaleString(DateTime.DATETIME_SHORT)
}

export function shortDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return ''
  const d = tz ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz) : DateTime.fromISO(iso)
  return d.toFormat('ccc, LLL d, h:mm a')
}
