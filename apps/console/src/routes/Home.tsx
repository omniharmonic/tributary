import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { BUCKET_LABEL, bucketFor, dayKey, dayParts, windowFor, type Bucket } from '../lib/dates'
import { keys, useConfig, useMe } from '../lib/queries'
import type { PublicEvent } from '../lib/types'
import { EventCard } from '../components/EventCard'
import { Empty, PageState } from '../components/PageState'
import { Flatirons, Footer, Page } from '../components/Shell'

const CATEGORIES = ['music', 'art', 'film', 'community', 'gardening', 'outdoors', 'food', 'learning', 'kids', 'civic']

export function HomeRoute() {
  const cfg = useConfig()
  const { me } = useMe()
  const search = useSearch({ strict: false }) as { q?: string; category?: string; when?: Bucket }
  const navigate = useNavigate()
  const [q, setQ] = useState(search.q ?? '')
  // A chosen chip fetches its own window; the unfiltered page keeps asking for the
  // soonest events, which is what "this week" should show.
  const win = search.when ? windowFor(search.when, cfg.region.tz) : undefined
  const params = { region: cfg.region.slug, q: search.q, category: search.category, from: win?.from, to: win?.to }
  const query = useQuery({ queryKey: keys.publicEvents(params), queryFn: () => api.publicEvents(params) })

  const grouped = useMemo(() => groupByBucket(query.data?.events ?? [], cfg.region.tz), [query.data, cfg.region.tz])
  const buckets = (Object.keys(BUCKET_LABEL) as Bucket[]).filter((b) => grouped[b].length > 0 && (!search.when || search.when === b))

  return (
    <>
      <Page wide>
        <section className="mb-8 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-2">
            <h1 className="max-w-[18ch]">What&rsquo;s happening in {cfg.region.name} this week</h1>
            <p className="max-w-[52ch] text-ink-soft">From the calendars that already exist. Every listing links back to where it came from, and you never need an account to look.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href={`webcal://${window.location.host}/api/public/regions/${cfg.region.slug}/calendar.ics`}>
              Subscribe
            </a>
            <Link to="/add" className="btn btn-primary">
              Add your events
            </Link>
          </div>
        </section>

        <form
          role="search"
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ to: '/', search: { ...search, q: q || undefined } })
          }}
        >
          <label className="sr-only" htmlFor="q">
            Search events
          </label>
          <input id="q" className="input" placeholder="Search by name, place or host" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" type="submit">
            Search
          </button>
        </form>

        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="When">
          {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
            <button key={b} type="button" className="chip" aria-pressed={search.when === b} onClick={() => void navigate({ to: '/', search: { ...search, when: search.when === b ? undefined : b } })}>
              {BUCKET_LABEL[b]}
            </button>
          ))}
          <span className="mx-1 self-center text-rule">|</span>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={search.category === c} onClick={() => void navigate({ to: '/', search: { ...search, category: search.category === c ? undefined : c } })}>
              {c}
            </button>
          ))}
        </div>

        <PageState
          isPending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          empty={
            query.data && query.data.events.length === 0 ? (
              <Empty title="Nothing listed yet for that" action={<Link to="/add" className="btn btn-primary">Add your events</Link>}>
                Try another filter, or be the first to list something.
              </Empty>
            ) : null
          }
        >
          <div className="grid gap-10">
            {buckets.map((b) => (
              <section key={b} aria-labelledby={`h-${b}`}>
                <h2 id={`h-${b}`} className="mb-3 text-ink-soft">
                  {BUCKET_LABEL[b]}
                </h2>
                <DayLedger events={grouped[b]} tz={cfg.region.tz} signedIn={!!me} />
              </section>
            ))}
          </div>
        </PageState>

        <section className="mt-14 grid gap-3 rounded-[var(--r-md)] bg-surface-2 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <Flatirons className="text-ochre" />
          <div>
            <h2>Host something? Paste your calendar once.</h2>
            <p className="mt-1 max-w-[56ch] text-ink-soft">Google Calendar, Luma, Meetup, your website, a flyer, an email. Your events stay yours, under your own name, and update by themselves.</p>
            <Link to="/add" className="btn btn-primary mt-3">
              Add your events
            </Link>
          </div>
        </section>
      </Page>
      <Footer />
    </>
  )
}

function groupByBucket(events: PublicEvent[], tz: string): Record<Bucket, PublicEvent[]> {
  const out: Record<Bucket, PublicEvent[]> = { tonight: [], weekend: [], week: [], later: [] }
  for (const e of [...events].sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt))) out[bucketFor(e.card.startsAt, tz)].push(e)
  return out
}

/** The day rail: one big serif date per day, events beside it. */
export function DayLedger({ events, tz, signedIn }: { events: PublicEvent[]; tz: string; signedIn: boolean }) {
  const days = new Map<string, PublicEvent[]>()
  for (const e of events) {
    const k = dayKey(e.card.startsAt, tz)
    days.set(k, [...(days.get(k) ?? []), e])
  }
  return (
    <div className="grid gap-6">
      {[...days.entries()].map(([day, list]) => {
        const p = dayParts(day, tz)
        return (
          <div key={day} className="grid grid-cols-[3.5rem_1fr] gap-4 sm:grid-cols-[5rem_1fr]">
            <div className="day-rail sticky top-2 self-start pt-1">
              <div className="dow">{p.dow}</div>
              <div className="num">{p.num}</div>
              <div className="dow">{p.month}</div>
            </div>
            <ul className="grid gap-5">
              {list.map((e) => (
                <li key={`${e.did}/${e.rkey}`}>
                  <EventCard
                    card={e.card}
                    hostName={e.host.displayName}
                    provenance={e.host.provenanceLevel}
                    audienceName={signedIn ? e.audienceName : undefined}
                    href={`/e/${encodeURIComponent(e.did)}/${encodeURIComponent(e.rkey)}`}
                    action={
                      e.card.sourceUrl ? (
                        <a className="btn btn-sm" href={e.card.sourceUrl} target="_blank" rel="noreferrer noopener">
                          RSVP at the source
                        </a>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
