import { useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { shortDateTime } from '../lib/dates'
import { keys, useConfig } from '../lib/queries'
import type { Confirmation, RawEvent } from '../lib/types'
import { EventCard } from '../components/EventCard'
import { Empty, PageState } from '../components/PageState'
import { Footer, Page } from '../components/Shell'

export function ConfirmationsRoute() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: keys.confirmations, queryFn: () => api.confirmations() })
  return (
    <Page title="To confirm" lede="Anything we inferred, and anything that would make an event more visible, waits here for you.">
      <PageState isPending={q.isPending} error={q.error} retry={() => void q.refetch()} empty={q.data && q.data.items.length === 0 ? <Empty title="Nothing to confirm">Extracted events and visibility changes will show up here.</Empty> : null}>
        <ul className="grid gap-5">
          {q.data?.items.map((c) => (
            <li key={c.id}>
              <ConfirmationItem item={c} onDone={() => void qc.invalidateQueries({ queryKey: keys.confirmations })} />
            </li>
          ))}
        </ul>
      </PageState>
    </Page>
  )
}

/** The email deep link: one item, preloaded. */
export function ConfirmDeepLinkRoute() {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['confirmation', id], queryFn: () => api.confirmation(id), retry: false })
  return (
    <>
      <Page title="Confirm this event">
        <PageState isPending={q.isPending} error={q.error}>
          {q.data ? <ConfirmationItem item={q.data} onDone={() => void navigate({ to: '/dashboard/confirmations' })} /> : null}
        </PageState>
      </Page>
      <Footer />
    </>
  )
}

export function ConfirmationItem({ item, onDone }: { item: Confirmation; onDone: () => void }) {
  const cfg = useConfig()
  const [edits, setEdits] = useState<Record<string, Partial<RawEvent>>>({})
  const resolve = useMutation({ mutationFn: (action: 'confirm' | 'reject') => api.resolveConfirmation(item.id, action, action === 'confirm' ? edits : undefined), onSuccess: onDone })
  const proposed = item.proposed as { recurrenceText?: string; rrule?: string; year?: number; timezone?: string; from?: string; to?: string; reason?: string }
  const c0 = item.cards[0]

  return (
    <article className="panel grid gap-4 p-4" aria-label={item.kind === 'widen' ? 'Visibility change' : 'Extracted event'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">
          {item.kind === 'extracted' ? `Read from ${item.channel === 'email' ? 'an email' : item.channel === 'telegram' ? 'a message' : 'what you gave us'}` : item.kind === 'widen' ? 'Would become more visible' : 'Claim'} · {shortDateTime(item.createdAt)}
        </p>
        <p className="text-xs text-ink-faint">Expires {shortDateTime(item.expiresAt)}</p>
      </div>

      {item.kind === 'widen' ? <p className="notice notice-held">{proposed.reason ?? `From ${proposed.from} to ${proposed.to}.`}</p> : null}

      <ul className="grid gap-4">
        {item.cards.map((card) => (
          <li key={card.key} className="grid gap-3">
            <EventCard card={card} showMissing />
            {item.kind === 'extracted' ? (
              <details open className="grid gap-2 rounded-[var(--r-md)] bg-surface-2 p-3">
                <summary className="cursor-pointer text-sm">Check our guesses</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Guess label="Name" confidence={card.confidence?.name} evidence={item.evidence.name}>
                    <input className="input" defaultValue={card.name} onChange={(e) => setEdits({ ...edits, [card.key]: { ...edits[card.key], name: e.target.value } })} />
                  </Guess>
                  <Guess label="Starts" confidence={card.confidence?.start} evidence={item.evidence.start}>
                    <input className="input" type="datetime-local" defaultValue={toLocalInput(card.startsAt, card.timezone)} onChange={(e) => setEdits({ ...edits, [card.key]: { ...edits[card.key], start: e.target.value } })} />
                  </Guess>
                  <Guess label="Ends" confidence={card.confidence?.end} evidence={item.evidence.end}>
                    <input className="input" type="datetime-local" defaultValue={card.endsAt ? toLocalInput(card.endsAt, card.timezone) : ''} onChange={(e) => setEdits({ ...edits, [card.key]: { ...edits[card.key], end: e.target.value } })} />
                  </Guess>
                  <Guess label="Timezone" confidence={card.confidence?.timezone ?? 0.5} evidence={proposed.timezone ? `assumed ${proposed.timezone}` : undefined}>
                    <input className="input" defaultValue={card.timezone || cfg.region.tz} onChange={(e) => setEdits({ ...edits, [card.key]: { ...edits[card.key], tz: e.target.value } })} />
                  </Guess>
                  <Guess label="Where" confidence={card.confidence?.place} evidence={item.evidence.place}>
                    <input className="input" defaultValue={card.place ?? ''} onChange={(e) => setEdits({ ...edits, [card.key]: { ...edits[card.key], location: e.target.value } })} />
                  </Guess>
                  <Guess label="Year" confidence={card.confidence?.year ?? 0.6} evidence={proposed.year ? `no year written; assumed ${proposed.year}` : undefined}>
                    <p className="text-sm">{proposed.year ?? new Date(card.startsAt).getFullYear()}</p>
                  </Guess>
                  {proposed.recurrenceText ? (
                    <Guess label="Repeats" confidence={card.confidence?.recurrence} evidence={proposed.recurrenceText} wide>
                      <p className="text-sm">
                        {proposed.recurrenceText} <span className="text-ink-faint">({proposed.rrule})</span>
                      </p>
                      {item.nextDates?.length ? <p className="text-sm text-ink-soft">Next: {item.nextDates.map((d) => shortDateTime(d, card.timezone)).join(' · ')}</p> : null}
                    </Guess>
                  ) : null}
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      {c0 && c0.needsConfirmation === false && item.kind === 'extracted' ? null : null}
      {resolve.error ? (
        <p className="notice notice-warn" role="alert">
          {plainError(resolve.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => resolve.mutate('confirm')} disabled={resolve.isPending}>
          {item.kind === 'widen' ? 'Yes, make it more visible' : 'Confirm and publish'}
        </button>
        <button type="button" className="btn" onClick={() => resolve.mutate('reject')} disabled={resolve.isPending}>
          {item.kind === 'widen' ? 'Keep it as it is' : 'Discard'}
        </button>
      </div>
    </article>
  )
}

function Guess({ label, confidence, evidence, children, wide }: { label: string; confidence?: number; evidence?: string; children: React.ReactNode; wide?: boolean }) {
  const pct = confidence === undefined ? undefined : Math.round(confidence * 100)
  const tone = pct === undefined ? '' : pct >= 85 ? 'badge-pine' : pct >= 60 ? 'badge-held' : 'badge-warn'
  return (
    <label className={`field ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="flex items-center gap-2">
        {label}
        {pct !== undefined ? (
          <span className={`badge ${tone}`} title="How sure we are">
            {pct}% sure
          </span>
        ) : null}
      </span>
      {children}
      {evidence ? <span className="hint">From: &ldquo;{evidence}&rdquo;</span> : null}
    </label>
  )
}

function toLocalInput(iso: string, tz: string): string {
  try {
    const d = new Date(iso)
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
  } catch {
    return iso.slice(0, 16)
  }
}
