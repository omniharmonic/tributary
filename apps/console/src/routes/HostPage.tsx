import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useConfig, useMe } from '../lib/queries'
import { ProvenanceBadge } from '../components/Badges'
import { PageState } from '../components/PageState'
import { Footer, Page } from '../components/Shell'
import { DayLedger } from './Home'
import { NotFoundRoute } from './Misc'

export function HostRoute() {
  const { handle } = useParams({ strict: false }) as { handle: string }
  const cfg = useConfig()
  const { me } = useMe()
  const q = useQuery({ queryKey: ['public-host', handle], queryFn: () => api.publicHost(handle), retry: false })
  if (q.error) return <NotFoundRoute />
  return (
    <>
      <Page>
        <PageState isPending={q.isPending} error={null}>
          {q.data ? (
            <div className="grid gap-6">
              <div className="grid gap-2">
                <h1>{q.data.host.displayName}</h1>
                <p className="flex flex-wrap items-center gap-2 text-ink-soft">
                  <span>@{q.data.host.handle}</span>
                  <ProvenanceBadge level={q.data.host.provenanceLevel} />
                </p>
                {q.data.host.about ? <p className="max-w-[60ch]">{q.data.host.about}</p> : null}
                <div>
                  <a className="btn btn-sm" href={`webcal://${window.location.host}/api/public/hosts/${encodeURIComponent(handle)}/calendar.ics`}>
                    Subscribe to this host
                  </a>
                </div>
              </div>
              {q.data.events.length ? <DayLedger events={q.data.events} tz={cfg.region.tz} signedIn={!!me} /> : <p className="text-ink-soft">No upcoming public events.</p>}
              {q.data.host.provenanceLevel === 'listed' ? (
                <p className="notice">
                  This host was added by a curator and has not claimed these listings. Is this yours?{' '}
                  <a href="/add" className="underline underline-offset-2">
                    Claim it
                  </a>{' '}
                  by connecting the calendar under your own name.
                </p>
              ) : null}
            </div>
          ) : null}
        </PageState>
      </Page>
      <Footer />
    </>
  )
}
