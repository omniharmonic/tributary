import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { useMe } from '../lib/queries'
import type { Visibility } from '../lib/types'
import { platformLabel } from '../components/Badges'
import { EventCard } from '../components/EventCard'
import { PublishingNotice } from '../components/HonestTermsNotice'
import { PageState } from '../components/PageState'
import { Footer, Page } from '../components/Shell'
import { VisibilityPicker } from '../components/VisibilityPicker'

export function PreviewRoute() {
  const { previewId } = useParams({ strict: false }) as { previewId: string }
  const navigate = useNavigate()
  const { me } = useMe()
  const q = useQuery({ queryKey: ['preview', previewId], queryFn: () => api.getPreview(previewId), retry: false })
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [group, setGroup] = useState('')
  useEffect(() => {
    if (q.data) setVisibility(q.data.defaultVisibility)
  }, [q.data])

  // A signed-in host connects directly; a stranger goes to the identity step.
  const connect = useMutation({
    mutationFn: () => api.addSource({ previewId, defaultVisibility: visibility, audience: visibility === 'members' && group ? { group } : undefined }),
    onSuccess: () => void navigate({ to: '/dashboard', search: { welcome: undefined } }),
  })

  const p = q.data
  const needsConfirm = p?.cards.some((c) => c.needsConfirmation)

  return (
    <>
      <Page>
        <PageState isPending={q.isPending} error={q.error}>
          {p ? (
            <div className="grid gap-6">
              <div className="grid gap-1">
                <p className="text-ink-soft">
                  {p.source.label} · {platformLabel(p.source.platform)} · times in {p.source.tz}
                </p>
                <h1>
                  {needsConfirm ? `We read ${p.count === 1 ? 'one event' : `${p.count} events`}` : `We found ${p.upcoming} upcoming ${p.upcoming === 1 ? 'event' : 'events'}`}
                </h1>
                <p className="max-w-[56ch] text-ink-soft">{needsConfirm ? 'These are our best guesses. You will check them before anything is published.' : 'This is exactly how they will appear. Changes at the source show up here on their own.'}</p>
              </div>

              {p.source.alreadyConnected ? <p className="notice notice-warn">This source is already connected by another host. If it is yours, sign in and claim it from the event page.</p> : null}
              {p.notes.length ? (
                <ul className="notice grid gap-1">
                  {p.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}

              <ul className="grid gap-5">
                {p.cards.map((c) => (
                  <li key={c.key}>
                    <EventCard card={c} showMissing />
                  </li>
                ))}
              </ul>
              {p.count > p.cards.length ? <p className="text-sm text-ink-soft">…and {p.count - p.cards.length} more.</p> : null}

              <div className="panel grid gap-4 p-4">
                <VisibilityPicker value={visibility} onChange={setVisibility} groupName={group} onGroupNameChange={setGroup} />
                <PublishingNotice />
                {connect.error ? (
                  <p className="notice notice-warn" role="alert">
                    {plainError(connect.error)}
                  </p>
                ) : null}
                {me ? (
                  <button type="button" className="btn btn-primary" onClick={() => connect.mutate()} disabled={connect.isPending || p.source.alreadyConnected}>
                    {connect.isPending ? 'Publishing…' : needsConfirm ? 'Continue to confirm' : `Publish as ${me.host.displayName}`}
                  </button>
                ) : (
                  <Link to="/connect" search={{ previewId, visibility }} className={`btn btn-primary ${p.source.alreadyConnected ? 'pointer-events-none opacity-50' : ''}`}>
                    {needsConfirm ? 'Continue' : 'Publish'}
                  </Link>
                )}
              </div>
            </div>
          ) : null}
        </PageState>
      </Page>
      <Footer />
    </>
  )
}
