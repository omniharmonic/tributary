import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { useMe } from '../lib/queries'
import { LockIcon, ProvenanceBadge, SourceBadge, StatusBadge, platformLabel } from '../components/Badges'
import { Placeholder } from '../components/EventCard'
import { PageState } from '../components/PageState'
import { Footer, Page } from '../components/Shell'
import { NotFoundRoute } from './Misc'

export function EventRoute() {
  const { did, rkey } = useParams({ strict: false }) as { did: string; rkey: string }
  const { me } = useMe()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['public-event', did, rkey], queryFn: () => api.publicEvent(did, rkey), retry: false })
  const request = useMutation({ mutationFn: () => api.requestPlace(did, rkey), onSuccess: () => void qc.invalidateQueries({ queryKey: ['public-event', did, rkey] }) })

  if (q.error) return <NotFoundRoute />
  return (
    <>
      <Page>
        <PageState isPending={q.isPending} error={null}>
          {q.data ? <EventBody e={q.data} signedIn={!!me} onRequest={() => request.mutate()} requesting={request.isPending} requestError={request.error} /> : null}
        </PageState>
      </Page>
      <Footer />
    </>
  )
}

function EventBody({ e, signedIn, onRequest, requesting, requestError }: { e: Awaited<ReturnType<typeof api.publicEvent>>; signedIn: boolean; onRequest: () => void; requesting: boolean; requestError: unknown }) {
  const c = e.card
  const gated = c.visibility === 'gated'
  return (
    <article className="grid gap-5">
      <div className="aspect-[16/9] overflow-hidden rounded-[var(--r-md)] bg-surface-2">{c.imageUrl ? <img src={c.imageUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder name={c.name} />}</div>
      <div className="grid gap-2">
        <p className="text-ink-soft">{c.when}</p>
        <h1 className={c.status === 'cancelled' ? 'line-through' : ''}>{c.name}</h1>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={c.status} />
          <SourceBadge platform={c.platform} />
          {e.audienceName ? (
            <span className="badge badge-slate">
              <LockIcon /> {e.audienceName}
            </span>
          ) : null}
          {c.priceText ? <span className="badge">{c.priceText}</span> : null}
        </div>
        <p>
          Hosted by{' '}
          <Link to="/h/$handle" params={{ handle: e.host.handle }} className="underline underline-offset-2">
            {e.host.displayName}
          </Link>{' '}
          <ProvenanceBadge level={e.host.provenanceLevel} />
        </p>
      </div>

      {c.status === 'cancelled' ? <p className="notice notice-warn">This event was cancelled at the source.</p> : null}
      {c.status === 'postponed' ? <p className="notice notice-held">Postponed. A new date has not been set yet.</p> : null}

      <section className="grid gap-1">
        <h2>Where</h2>
        {(e.locations && e.locations.length > 0 ? e.locations : [{ name: c.place, coarse: c.placeCoarse }]).map((l, i) => (
          <p key={i}>{[l.name, l.street, l.locality, l.region].filter(Boolean).join(', ') || (c.mode === 'virtual' ? 'Online' : 'To be announced')}</p>
        ))}
        {gated ? (
          <div className="notice mt-2 grid gap-2">
            {e.revealed ? (
              <>
                <p className="font-medium">You are confirmed. Details for guests:</p>
                {e.revealed.exactLocation ? <p>{e.revealed.exactLocation}</p> : null}
                {e.revealed.joinUrl ? (
                  <p>
                    <a href={e.revealed.joinUrl}>{e.revealed.joinUrl}</a>
                  </p>
                ) : null}
                {e.revealed.attendeeNotes ? <p>{e.revealed.attendeeNotes}</p> : null}
              </>
            ) : (
              <>
                <p>Exact location shared with confirmed guests.</p>
                {e.requestState === 'pending' ? (
                  <p className="text-sm text-ink-soft">Your request is with the host.</p>
                ) : signedIn ? (
                  <div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={onRequest} disabled={requesting}>
                      {requesting ? 'Sending…' : 'Request a place'}
                    </button>
                    {requestError ? <p className="mt-1 text-sm text-warn">{plainError(requestError)}</p> : null}
                  </div>
                ) : (
                  <p className="text-sm">
                    <Link to="/login" className="underline underline-offset-2">
                      Sign in
                    </Link>{' '}
                    to request a place.
                  </p>
                )}
              </>
            )}
          </div>
        ) : null}
      </section>

      {e.descriptionMd ? (
        <section className="prose grid gap-1">
          <h2>About</h2>
          <Markdownish text={e.descriptionMd} />
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {c.sourceUrl ? (
          <a className="btn btn-primary" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
            RSVP at the source ({platformLabel(c.platform)})
          </a>
        ) : null}
        <a className="btn" href={`/api/public/events/${encodeURIComponent(e.did)}/${encodeURIComponent(e.rkey)}.ics`}>
          Add to calendar
        </a>
      </div>
      <p className="hint">Listed from {platformLabel(c.platform)}. The source is the truth: to change it, edit it there.</p>
    </article>
  )
}

/** Paragraphs and bare links; enough for imported descriptions without a markdown dependency. */
export function Markdownish({ text }: { text: string }) {
  const paras = text.split(/\n{2,}/)
  return (
    <>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split(/(https?:\/\/[^\s)]+)/g).map((part, j) =>
            /^https?:\/\//.test(part) ? (
              <a key={j} href={part} rel="noreferrer noopener" target="_blank">
                {part}
              </a>
            ) : (
              <span key={j}>{part.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '')}</span>
            ),
          )}
        </p>
      ))}
    </>
  )
}
