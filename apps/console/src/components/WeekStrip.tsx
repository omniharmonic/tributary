/**
 * The week ahead, as the page's opening image.
 *
 * A directory's most characteristic object is not its logo, it is the week: seven days
 * with a different amount of life in each. So the hero is the real thing, with real
 * counts, and it doubles as the fastest control on the page — the question most visitors
 * arrive with is "what is on Thursday", and this answers it in one click.
 *
 * The counts are asked for on their own and counted over the whole ledger. Deriving them
 * from the loaded page made the strip say "nothing on Wednesday" while thirty things were
 * listed, simply because the page had not reached Wednesday — which is the one thing a
 * count must never do.
 */
import { weekAhead } from '../lib/dates'

export interface WeekStripProps {
  /** `YYYY-MM-DD` to a count, from the server. */
  counts: Record<string, number>
  tz: string
  selected?: string
  onDay: (iso: string | undefined) => void
}

export function WeekStrip({ counts, tz, selected, onDay }: WeekStripProps) {
  const days = weekAhead(tz)
  const busiest = Math.max(1, ...days.map((d) => counts[d.iso] ?? 0))

  return (
    <div className="week-strip" role="group" aria-label="The week ahead">
      {days.map((d) => {
        const n = counts[d.iso] ?? 0
        return (
          <button
            key={d.iso}
            type="button"
            className="week-day"
            data-today={d.isToday || undefined}
            data-selected={selected === d.iso || undefined}
            aria-pressed={selected === d.iso}
            aria-label={`${d.dow} ${d.num}, ${n === 0 ? 'nothing listed' : `${n} ${n === 1 ? 'event' : 'events'}`}`}
            onClick={() => onDay(selected === d.iso ? undefined : d.iso)}
          >
            <span className="week-dow">{d.isToday ? 'Today' : d.dow}</span>
            <span className="week-num">{d.num}</span>
            {/* The bar is the count: a week you can read at a glance before any number. */}
            <span className="week-bar" aria-hidden="true">
              <span style={{ height: `${n === 0 ? 0 : Math.max(12, Math.round((n / busiest) * 100))}%` }} />
            </span>
            <span className="week-count" aria-hidden="true">
              {n || '–'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
