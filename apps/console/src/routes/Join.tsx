import { Link, useParams, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { useMe } from '../lib/queries'
import { EventCard } from '../components/EventCard'
import { Loading } from '../components/PageState'
import { Footer, Page } from '../components/Shell'

/** `e` is `<did>/<rkey>`; the token is the invite. */
export function JoinRoute() {
  const { token } = useParams({ strict: false }) as { token: string }
  const search = useSearch({ strict: false }) as { e?: string }
  const { me } = useMe()
  const qc = useQueryClient()
  const [did, rkey] = (search.e ?? '').split('/')
  const hasEvent = !!did && !!rkey

  const teaser = useQuery({ queryKey: ['public-event', did, rkey], queryFn: () => api.publicEvent(did!, rkey!), enabled: hasEvent, retry: false })
  const redeem = useMutation({
    mutationFn: () => api.redeemInvite(token),
    onSuccess: () => {
      if (hasEvent) void qc.invalidateQueries({ queryKey: ['public-event', did, rkey] })
    },
  })

  // Signed in: redeem once, straight away. Signed out: explain and offer the doors.
  useEffect(() => {
    if (me && redeem.isIdle) redeem.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  const here = `/join/${encodeURIComponent(token)}${search.e ? `?e=${encodeURIComponent(search.e)}` : ''}`

  return (
    <>
      <Page title="You've been invited" lede={me === undefined ? undefined : me ? undefined : 'Sign in or create an account to see the details and RSVP.'}>
        <div className="grid gap-5">
          {hasEvent ? (
            teaser.isPending ? (
              <Loading label="Finding the event" />
            ) : teaser.data ? (
              <EventCard card={teaser.data.card} hostName={teaser.data.host.displayName} provenance={teaser.data.host.provenanceLevel} href={`/e/${encodeURIComponent(did!)}/${encodeURIComponent(rkey!)}`} />
            ) : (
              <p className="notice">The event this link belongs to is not public. The details show once you are in.</p>
            )
          ) : null}

          {me === undefined ? (
            <Loading label="Checking your session" />
          ) : me ? (
            <section className="panel grid gap-3 p-4" aria-live="polite">
              {redeem.isPending || redeem.isIdle ? (
                <p className="text-ink-soft">Opening your invitation…</p>
              ) : redeem.error ? (
                <>
                  <p className="notice notice-warn" role="alert">
                    {plainError(redeem.error)}
                  </p>
                  <p className="text-sm text-ink-soft">Signed in as @{me.host.handle}. If this invitation was for a different account, sign out and try the link again.</p>
                </>
              ) : (
                <>
                  <h2>You&rsquo;re in</h2>
                  <p className="max-w-[56ch]">
                    {redeem.data?.kind === 'read' ? 'You can now see the details of this event.' : 'You are on the guest list. The exact details are yours to see, and only guests can see them.'}
                  </p>
                  {hasEvent ? (
                    <div>
                      <Link to="/e/$did/$rkey" params={{ did: did!, rkey: rkey! }} className="btn btn-primary">
                        See the event
                      </Link>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-soft">The host will send you the event page.</p>
                  )}
                </>
              )}
            </section>
          ) : (
            <section className="panel grid gap-3 p-4">
              <p className="max-w-[56ch]">The host shared this link with you. To see the exact location and RSVP, you need an account, so the host knows who is coming. It takes one email.</p>
              <div className="flex flex-wrap gap-2">
                <Link to="/connect" search={{ next: here }} className="btn btn-primary">
                  Create an account
                </Link>
                <Link to="/login" search={{ next: here }} className="btn">
                  I already have one
                </Link>
              </div>
              <p className="hint">Access control, not secrecy: the host and the servers involved can see what guests write. We never call it private or encrypted.</p>
            </section>
          )}
        </div>
      </Page>
      <Footer />
    </>
  )
}
