/**
 * The directory: what is on, in three shapes.
 *
 * One query feeds all three views, so the list, the month and the map always agree —
 * switching shape never changes which events you are looking at, only how they are
 * arranged. The filters live in the URL, which means any view a visitor has arrived at
 * is a link they can send to somebody, and the subscription button hands the same
 * filters to their calendar app.
 */
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { BUCKET_LABEL, bucketFor, dayKey, dayParts, dayWindow, gridWindow, monthGrid, thisMonth, windowFor, type Bucket } from '../lib/dates'
import { keys, useConfig, useMe } from '../lib/queries'
import type { PublicEvent } from '../lib/types'
import { EventCard } from '../components/EventCard'
import { Empty, PageState } from '../components/PageState'
import { Flatirons, Footer, Page } from '../components/Shell'
import { SubscribeMenu } from '../components/Subscribe'
import { WeekStrip } from '../components/WeekStrip'
import { CalendarGrid } from '../components/CalendarGrid'

const EventMap = lazy(() => import('../components/EventMap').then((m) => ({ default: m.EventMap })))

const CATEGORIES = ['music', 'art', 'film', 'community', 'gardening', 'outdoors', 'food', 'learning', 'kids', 'civic']
const VIEWS = [
  { id: 'list', label: 'List' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'map', label: 'Map' },
] as const
type View = (typeof VIEWS)[number]['id']

/** Boulder's rough middle, for the map's first frame. Replaced by the pins themselves. */
const REGION_CENTER = { lat: 40.015, lon: -105.2705 }
/** The calendar wants a whole month at once; the list is read a page at a time. */
const PAGE = { list: 100, calendar: 500, map: 500 } as const

interface HomeSearchState {
  q?: string
  category?: string
  when?: Bucket
  view?: View
  day?: string
  month?: string
  near?: string
  radiusKm?: string
}

export function HomeRoute() {
  const cfg = useConfig()
  const { me } = useMe()
  const search = useSearch({ strict: false }) as HomeSearchState
  const navigate = useNavigate()
  const [q, setQ] = useState(search.q ?? '')
  const [locating, setLocating] = useState(false)
  const tz = cfg.region.tz
  const view: View = search.view ?? 'list'
  const month = search.month ?? thisMonth(tz)

  const go = (next: Partial<HomeSearchState>) => void navigate({ to: '/', search: { ...search, ...next } })

  // Which window the server should answer with. A picked day beats a chip; the calendar
  // asks for the whole visible grid so its cells are never half-filled.
  const win = useMemo(() => {
    if (search.day) return dayWindow(search.day, tz)
    if (view === 'calendar') return gridWindow(monthGrid(month, tz), tz)
    if (search.when) return windowFor(search.when, tz)
    return undefined
  }, [search.day, search.when, view, month, tz])

  const params = { region: cfg.region.slug, q: search.q, category: search.category, from: win?.from, to: win?.to, near: search.near, radiusKm: search.radiusKm, limit: PAGE[view] }
  const query = useInfiniteQuery({
    queryKey: keys.publicEvents(params as never),
    queryFn: ({ pageParam }) => api.publicEvents({ ...params, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
  })
  const events = useMemo(() => query.data?.pages.flatMap((p) => p.events) ?? [], [query.data])

  // Day counts are asked for separately and counted over the whole ledger. Deriving them
  // from `events` made the strip claim a day was empty whenever the page had not paged
  // that far yet — the one thing a count must never do. A text or radius search is the
  // exception: those are ranked result sets rather than a window, so there the strip
  // falls back to what was returned, which for a search is the whole answer.
  const countWindow = search.day || view === 'calendar' ? win : undefined
  const isSearch = !!(search.q || search.near)
  const countsQuery = useQuery({
    queryKey: keys.publicEventCounts({ region: cfg.region.slug, category: search.category, from: countWindow?.from, to: countWindow?.to }),
    queryFn: () => api.publicEventCounts({ region: cfg.region.slug, category: search.category, from: countWindow?.from, to: countWindow?.to }),
    enabled: !isSearch,
    staleTime: 120_000,
  })
  const counts = useMemo(() => {
    if (!isSearch && countsQuery.data) return countsQuery.data.days
    const out: Record<string, number> = {}
    for (const e of events) {
      const k = dayKey(e.card.startsAt, tz)
      out[k] = (out[k] ?? 0) + 1
    }
    return out
  }, [isSearch, countsQuery.data, events, tz])

  const hrefFor = (e: PublicEvent) => `/e/${encodeURIComponent(e.did)}/${encodeURIComponent(e.rkey ?? '')}`
  const feedPath = useMemo(() => {
    const p = new URLSearchParams()
    if (search.category) p.set('category', search.category)
    if (search.q) p.set('q', search.q)
    if (search.near) p.set('near', search.near)
    if (search.radiusKm) p.set('radiusKm', search.radiusKm)
    const qs = p.toString()
    return `/api/public/regions/${cfg.region.slug}/calendar.ics${qs ? `?${qs}` : ''}`
  }, [search.category, search.q, search.near, search.radiusKm, cfg.region.slug])

  const nearMe = () => {
    if (search.near) return go({ near: undefined, radiusKm: undefined })
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        go({ near: `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`, radiusKm: search.radiusKm ?? '15' })
      },
      () => setLocating(false),
      { maximumAge: 300_000, timeout: 8000 },
    )
  }

  const subscribeWhat = [search.category, search.q ? `“${search.q}”` : null].filter(Boolean).join(' ') || `everything in ${cfg.region.name}`

  return (
    <>
      <Page wide>
        <section className="mb-6 grid gap-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-2">
              <h1 className="max-w-[16ch]">What&rsquo;s happening in {cfg.region.name}</h1>
              <p className="max-w-[52ch] text-ink-soft">From the calendars that already exist. Every listing links back to where it came from, and you never need an account to look.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SubscribeMenu path={feedPath} what={subscribeWhat} />
              <Link to="/add" className="btn btn-primary">
                Add your events
              </Link>
            </div>
          </div>
          <WeekStrip counts={counts} tz={tz} selected={search.day} onDay={(day) => go({ day, when: undefined })} />
        </section>

        <div className="filters">
          <form
            role="search"
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              go({ q: q || undefined })
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
          <div className="seg" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className="seg-btn" aria-pressed={view === v.id} onClick={() => go({ view: v.id === 'list' ? undefined : v.id })}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* When and where sit on their own row in the bordered chip; what it is, on a
            quieter second row. Two kinds of filter that looked identical apart from a
            divider now read as two kinds of filter. */}
        <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="When">
          {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
            <button key={b} type="button" className="chip" aria-pressed={search.when === b} onClick={() => go({ when: search.when === b ? undefined : b, day: undefined })}>
              {BUCKET_LABEL[b]}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={!!search.near} onClick={nearMe} disabled={locating}>
            {locating ? 'Finding you…' : search.near ? `Within ${search.radiusKm ?? 15} km` : 'Near me'}
          </button>
          {search.day || search.when || search.category || search.q || search.near ? (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void navigate({ to: '/', search: { view: search.view } })}>
              Clear filters
            </button>
          ) : null}
        </div>
        {/* Ten categories stacked four rows deep pushed the events off a phone screen.
            One scrolling row keeps them reachable without spending the fold on them. */}
        <div className="chip-rail mb-6" role="group" aria-label="Kind of event">
          {CATEGORIES.map((cat) => (
            <button key={cat} type="button" className="chip chip-quiet" aria-pressed={search.category === cat} onClick={() => go({ category: search.category === cat ? undefined : cat })}>
              {cat}
            </button>
          ))}
        </div>

        <PageState
          isPending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          empty={
            !query.isPending && events.length === 0 ? (
              <Empty title="Nothing listed yet for that" action={<Link to="/add" className="btn btn-primary">Add your events</Link>}>
                Try another filter, or be the first to list something.
              </Empty>
            ) : null
          }
        >
          {view === 'calendar' ? (
            <CalendarGrid month={month} tz={tz} events={events} counts={counts} selected={search.day} loading={query.isFetching} onMonth={(m) => go({ month: m, day: undefined })} onDay={(day) => go({ day })} />
          ) : view === 'map' ? (
            <Suspense fallback={<div className="map-holder map-holder-loading" aria-label="Loading the map" />}>
              <EventMap events={events} center={REGION_CENTER} hrefFor={hrefFor} onPick={(ids) => go({ q: undefined, day: undefined, ...pickOne(events, ids) })} />
            </Suspense>
          ) : null}

          {/* The list is the list view. Under the month, only a picked day opens — a grid
              with five hundred cards stacked under it is a list with extra steps. */}
          {view === 'list' ? <Listing events={events} tz={tz} signedIn={!!me} grouped={!search.day} /> : null}
          {view === 'calendar' && search.day ? (
            <div className="mt-8">
              <Listing events={events.filter((e) => dayKey(e.card.startsAt, tz) === search.day)} tz={tz} signedIn={!!me} grouped={false} />
            </div>
          ) : null}

          {view === 'list' && query.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <button type="button" className="btn" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? 'Loading…' : 'Show more events'}
              </button>
            </div>
          ) : view === 'list' && events.length > 0 ? (
            <p className="mt-8 text-center text-sm text-ink-faint">That is everything we know about for now.</p>
          ) : null}
        </PageState>

        <section className="mt-14 grid gap-3 rounded-[var(--r-md)] bg-surface-2 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <Flatirons className="text-ochre" />
          <div>
            <h2>Host something? Paste your calendar once.</h2>
            <p className="mt-1 max-w-[56ch] text-ink-soft">Google Calendar, Luma, Meetup, your website, a flyer, an email, or the calendar already in your AT Protocol repo. Your events stay yours, under your own name, and update by themselves.</p>
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

/** Clicking a pin that holds one event opens it; several, and the day is filtered instead. */
function pickOne(events: PublicEvent[], ids: string[]): Partial<HomeSearchState> {
  const hit = events.find((e) => e.card.key === ids[0])
  if (!hit) return {}
  if (ids.length === 1) {
    window.location.href = `/e/${encodeURIComponent(hit.did)}/${encodeURIComponent(hit.rkey ?? '')}`
    return {}
  }
  return { q: hit.card.place ?? undefined }
}

function Listing({ events, tz, signedIn, grouped }: { events: PublicEvent[]; tz: string; signedIn: boolean; grouped: boolean }) {
  const buckets = useMemo(() => {
    const out: Record<Bucket, PublicEvent[]> = { tonight: [], weekend: [], week: [], later: [] }
    for (const e of [...events].sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt))) out[bucketFor(e.card.startsAt, tz)].push(e)
    return out
  }, [events, tz])

  if (!grouped) return <DayLedger events={[...events].sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt))} tz={tz} signedIn={signedIn} />
  const shown = (Object.keys(BUCKET_LABEL) as Bucket[]).filter((b) => buckets[b].length > 0)
  return (
    <div className="grid gap-10">
      {shown.map((b) => (
        <section key={b} aria-labelledby={`h-${b}`}>
          <h2 id={`h-${b}`} className="mb-3 text-ink-soft">
            {BUCKET_LABEL[b]}
          </h2>
          <DayLedger events={buckets[b]} tz={tz} signedIn={signedIn} />
        </section>
      ))}
    </div>
  )
}

export function DayLedger({ events, tz, signedIn }: { events: PublicEvent[]; tz: string; signedIn: boolean }) {
  const days: Array<{ key: string; items: PublicEvent[] }> = []
  for (const e of events) {
    const k = dayKey(e.card.startsAt, tz)
    const last = days[days.length - 1]
    if (last && last.key === k) last.items.push(e)
    else days.push({ key: k, items: [e] })
  }
  return (
    <div className="grid gap-6">
      {days.map(({ key, items }) => {
        const { num, dow, month } = dayParts(key, tz)
        return (
          <div key={key} className="grid gap-3 sm:grid-cols-[3.5rem_1fr] sm:gap-5">
            <div className="day-rail sm:sticky sm:top-4 sm:self-start">
              <div className="dow">{dow}</div>
              <div className="num">{num}</div>
              <div className="dow">{month}</div>
            </div>
            <div className="grid gap-5">
              {items.map((e) => (
                <EventCard
                  key={`${e.did}/${e.rkey ?? e.card.key}`}
                  card={e.card}
                  // The curator publishes all 55 listed calendars, so its name on every
                  // card is a word that never varies. The source badge already says where
                  // the listing came from.
                  hostName={e.host.provenanceLevel === 'listed' ? undefined : e.host.displayName}
                  provenance={e.host.provenanceLevel}
                  audienceName={e.audienceName}
                  href={`/e/${encodeURIComponent(e.did)}/${encodeURIComponent(e.rkey ?? '')}`}
                  showMissing={signedIn}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
