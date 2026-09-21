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
