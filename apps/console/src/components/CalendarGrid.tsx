/**
 * The month, as a month looks.
 *
 * Six rows of seven, Monday first, always the same height. A cell shows the three
 * soonest things and a count for the rest, because a Saturday in Boulder can hold
 * thirty and a cell that grows to fit them turns the grid into a list with extra steps.
 *
 * The grid is a set of buttons rather than a table of links: picking a day filters the
 * page under it, which is a control, not navigation.
 */
import { DateTime } from 'luxon'
import { dayKey, monthGrid, monthLabel, shiftMonth, type GridDay } from '../lib/dates'
import type { PublicEvent } from '../lib/types'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SHOWN_PER_DAY = 3

export interface CalendarGridProps {
  month: string
  tz: string
  events: PublicEvent[]
  /** `YYYY-MM-DD` to a count over the whole ledger, so a cell's total is never short. */
  counts: Record<string, number>
  selected?: string
  onMonth: (month: string) => void
  onDay: (iso: string | undefined) => void
  loading?: boolean
}

export function CalendarGrid({ month, tz, events, counts, selected, onMonth, onDay, loading }: CalendarGridProps) {
  const days = monthGrid(month, tz)
  const byDay = new Map<string, PublicEvent[]>()
  for (const e of events) {
    const k = dayKey(e.card.startsAt, tz)
    const list = byDay.get(k)
    if (list) list.push(e)
    else byDay.set(k, [e])
  }
  for (const list of byDay.values()) list.sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt))

  return (
    <section aria-label={`Events in ${monthLabel(month, tz)}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[1.5rem]">{monthLabel(month, tz)}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => onMonth(shiftMonth(month, -1, tz))} aria-label={`Show ${monthLabel(shiftMonth(month, -1, tz), tz)}`}>
            ←
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => onMonth(shiftMonth(month, 1, tz))} aria-label={`Show ${monthLabel(shiftMonth(month, 1, tz), tz)}`}>
            →
          </button>
        </div>
      </div>

      <div className="cal-grid" aria-busy={loading || undefined}>
        {DOW.map((d) => (
          <div key={d} className="cal-dow" aria-hidden="true">
            {d}
          </div>
        ))}
        {days.map((d) => (
          <Cell key={d.iso} day={d} tz={tz} events={byDay.get(d.iso) ?? []} total={counts[d.iso] ?? (byDay.get(d.iso)?.length ?? 0)} selected={selected === d.iso} onDay={onDay} />
        ))}
      </div>
    </section>
  )
}

function Cell({ day, tz, events, total, selected, onDay }: { day: GridDay; tz: string; events: PublicEvent[]; total: number; selected: boolean; onDay: (iso: string | undefined) => void }) {
  const shown = events.slice(0, SHOWN_PER_DAY)
  const rest = Math.max(total, events.length) - shown.length
  const label = DateTime.fromISO(day.iso, { zone: tz }).toFormat('cccc d LLLL')
  return (
    <button
      type="button"
      className="cal-cell"
      data-out={!day.inMonth || undefined}
      data-today={day.isToday || undefined}
      data-weekend={day.isWeekend || undefined}
      data-past={day.isPast || undefined}
      data-selected={selected || undefined}
      data-empty={total === 0 || undefined}
      aria-pressed={selected}
      aria-label={total ? `${label}, ${total} events` : `${label}, nothing listed`}
      onClick={() => onDay(selected ? undefined : day.iso)}
    >
      <span className="cal-num">{day.day}</span>
      <span className="cal-items" aria-hidden="true">
        {shown.map((e) => (
          <span key={e.card.key} className="cal-item">
            <span className="cal-time">{timeOf(e.card.startsAt, tz, e.card.allDay)}</span> {e.card.name}
          </span>
        ))}
        {rest > 0 ? <span className="cal-more">{rest} more</span> : null}
      </span>
    </button>
  )
}

function timeOf(startsAt: string, tz: string, allDay: boolean): string {
  if (allDay) return 'all day'
  const d = DateTime.fromISO(startsAt, { zone: 'utc' }).setZone(tz)
  return d.toFormat(d.minute === 0 ? 'ha' : 'h:mma').toLowerCase()
}
