import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { shortDateTime } from '../lib/dates'
import { HonestTermsNotice } from '../components/HonestTermsNotice'
import { PageState } from '../components/PageState'
import { Page } from '../components/Shell'

export function AudienceRoute() {
  const { eventId } = useParams({ strict: false }) as { eventId: string }
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['audience', eventId], queryFn: () => api.audience(eventId) })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['audience', eventId] })
  const [kind, setKind] = useState<'join' | 'read' | 'read-join'>('read-join')
  const [hours, setHours] = useState(72)
  const [maxUses, setMaxUses] = useState<number | ''>(20)
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null)
  const [people, setPeople] = useState('')
  const [invited, setInvited] = useState<{ resolved: Array<{ handle: string }>; pendingEmails: string[] } | null>(null)

  const create = useMutation({ mutationFn: () => api.createInvite(eventId, { kind, expiresInHours: hours, maxUses: maxUses === '' ? null : maxUses }), onSuccess: (r) => { setFresh(r); invalidate() } })
  const del = useMutation({ mutationFn: (id: string) => api.deleteInvite(eventId, id), onSuccess: invalidate })
  const invite = useMutation({
    mutationFn: () => {
      const items = people.split(/[\s,]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean)
      return api.invitePeople(eventId, { handles: items.filter((s) => !s.includes('@')), emails: items.filter((s) => s.includes('@')) })
    },
    onSuccess: (r) => { setInvited(r); setPeople(''); invalidate() },
  })
  const decide = useMutation({ mutationFn: (v: { id: string; action: 'approve' | 'deny' }) => api.decideRequest(eventId, v.id, v.action), onSuccess: invalidate })

  return (
    <Page title="Guests" lede="Who can see the details of this event, and who has asked.">
      <p className="mb-4 text-sm">
        <Link to="/dashboard/events" className="underline underline-offset-2">
          Your events
        </Link>
      </p>
      <PageState isPending={q.isPending} error={q.error} retry={() => void q.refetch()}>
        {q.data ? (
          <div className="grid gap-6">
            <p className="text-sm text-ink-soft">
              {q.data.members} {q.data.members === 1 ? 'person' : 'people'} can see the details. Policy: <code className="text-xs">{q.data.policy}</code>
            </p>
            <HonestTermsNotice />

            <section className="panel grid gap-3 p-4">
              <h2>Requests</h2>
              {q.data.requests.length === 0 ? <p className="text-ink-soft">Nobody has asked yet.</p> : null}
              <ul className="grid gap-2">
                {q.data.requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      @{r.handle} <span className="text-sm text-ink-soft">asked {shortDateTime(r.requestedAt)}</span>
                    </span>
                    {r.state === 'pending' ? (
                      <span className="flex gap-2">
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>
                          Approve
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => decide.mutate({ id: r.id, action: 'deny' })}>
                          Deny
                        </button>
                      </span>
                    ) : (
                      <span className={`badge ${r.state === 'approved' ? 'badge-pine' : ''}`}>{r.state}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel grid gap-3 p-4">
              <h2>Invite people</h2>
              <label className="field">
                <span>Handles or emails, separated by spaces or commas</span>
                <textarea className="textarea" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="maple.bsky.social, wren@example.org" />
              </label>
              <div>
                <button type="button" className="btn btn-primary" onClick={() => invite.mutate()} disabled={invite.isPending || !people.trim()}>
                  Invite
                </button>
              </div>
              {invite.error ? <p className="notice notice-warn">{plainError(invite.error)}</p> : null}
              {invited ? (
                <p className="text-sm text-ink-soft">
                  Invited {invited.resolved.map((r) => `@${r.handle}`).join(', ') || 'nobody by handle'}.{invited.pendingEmails.length ? ` ${invited.pendingEmails.length} email ${invited.pendingEmails.length === 1 ? 'invitation' : 'invitations'} will resolve when they sign in.` : ''}
                </p>
              ) : null}
            </section>

            <section className="panel grid gap-3 p-4">
              <h2>Join links</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="field">
                  <span>Link lets people</span>
                  <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                    <option value="read-join">see details and join</option>
                    <option value="read">see details only</option>
                    <option value="join">join the guest list</option>
                  </select>
                </label>
                <label className="field">
                  <span>Expires in (hours)</span>
                  <input className="input" type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>Max uses (blank = no limit)</span>
                  <input className="input" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))} />
                </label>
              </div>
              <div>
                <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
                  Create link
                </button>
              </div>
              {create.error ? <p className="notice notice-warn">{plainError(create.error)}</p> : null}
              {fresh ? (
                <div className="notice grid gap-1">
                  <p className="font-medium">Copy this now. It is shown once.</p>
                  <code className="break-all text-sm">{fresh.url}</code>
                  <div>
                    <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(fresh.url)}>
                      Copy
                    </button>
                  </div>
                </div>
              ) : null}
              <ul className="grid gap-2">
                {q.data.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {i.kind} · expires {shortDateTime(i.expiresAt)} · {i.usesLeft === null ? 'unlimited' : `${i.usesLeft} uses left`}
                    </span>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={() => del.mutate(i.id)}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </PageState>
    </Page>
  )
}
