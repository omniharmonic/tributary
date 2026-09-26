import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { keys, useActing } from '../lib/queries'
import type { EventOverride, LedgerEvent, Visibility } from '../lib/types'
import { EventCard } from '../components/EventCard'
import { Empty, PageState } from '../components/PageState'
import { Page } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { VisibilityPicker } from '../components/VisibilityPicker'

const STATES = [
  { value: undefined, label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'held', label: 'Held' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'removed', label: 'Removed' },
] as const

export function EventsLedgerRoute() {
  const search = useSearch({ strict: false }) as { sourceId?: string; state?: string }
  const { readOnly } = useActing()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const params = { sourceId: search.sourceId, state: search.state }
  const q = useQuery({ queryKey: keys.events(params), queryFn: () => api.events(params) })
  const [editing, setEditing] = useState<LedgerEvent | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const patch = useMutation({
    mutationFn: (v: { id: string; body: EventOverride }) => api.patchEvent(v.id, v.body),
    onSuccess: (r) => {
      if ('pendingConfirmation' in r) setPending(r.pendingConfirmation)
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['events'] })
    },
  })

  return (
    <Page title="Your events" lede="Everything we have published or held for you. Edit content at the source; use overrides here for anything the source cannot say.">
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {STATES.map((s) => (
          <button key={s.label} type="button" className="chip" aria-pressed={search.state === s.value} onClick={() => void navigate({ to: '/dashboard/events', search: { ...search, state: s.value } })}>
            {s.label}
          </button>
        ))}
        {search.sourceId ? (
          <button type="button" className="chip" onClick={() => void navigate({ to: '/dashboard/events', search: { state: search.state } })}>
            One source × clear
          </button>
        ) : null}
      </div>
      {pending ? (
        <p className="notice notice-held mb-4" role="status">
          That change would make the event more visible, so it waits for you in{' '}
          <Link to="/dashboard/confirmations" className="underline underline-offset-2">
            To confirm
          </Link>
          .
        </p>
      ) : null}
      <PageState isPending={q.isPending} error={q.error} retry={() => void q.refetch()} empty={q.data && q.data.events.length === 0 ? <Empty title="Nothing here yet">Once a source syncs, its events appear here.</Empty> : null}>
        <ul className="grid gap-5">
          {q.data?.events.map((e) => (
            <li key={e.id} className="grid gap-2">
              <EventCard
                card={{ ...e.card, visibility: e.visibility }}
                action={
                  <div className="flex flex-wrap gap-2">
                    <span className="badge">{e.state}</span>
                    {e.override?.hidden ? <span className="badge badge-held">hidden by you</span> : null}
                    {e.visibilitySource && e.visibilitySource !== 'host-default' ? <span className="badge">visibility from {e.visibilitySource === 'source-signal' ? 'the source' : e.visibilitySource === 'rule' ? 'a rule' : 'you'}</span> : null}
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(e)} disabled={readOnly}>
                      Override
                    </button>
                    {e.visibility === 'gated' || e.visibility === 'invite' || e.visibility === 'members' ? (
                      <Link to="/dashboard/audience/$eventId" params={{ eventId: e.id }} className="btn btn-sm">
                        Guests
                      </Link>
                    ) : null}
                    {e.atUri ? (
                      <a className="btn btn-sm btn-quiet" href={`/e/${encodeURIComponent(e.atUri.split('/')[2] ?? '')}/${encodeURIComponent(e.atUri.split('/').pop() ?? '')}`}>
                        View
                      </a>
                    ) : null}
                  </div>
                }
              />
            </li>
          ))}
        </ul>
      </PageState>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Override this event">
        {editing ? <OverrideForm event={editing} busy={patch.isPending} error={patch.error} onSave={(body) => patch.mutate({ id: editing.id, body })} /> : null}
      </Sheet>
    </Page>
  )
}

function OverrideForm({ event, onSave, busy, error }: { event: LedgerEvent; onSave: (b: EventOverride) => void; busy: boolean; error: unknown }) {
  const [hidden, setHidden] = useState(!!event.override?.hidden)
  const [category, setCategory] = useState(event.override?.category ?? event.card.category ?? '')
  const [imageUrl, setImageUrl] = useState(event.override?.imageUrl ?? '')
  const [visibility, setVisibility] = useState<Visibility>(event.visibility)
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ hidden, category: category || undefined, imageUrl: imageUrl || null, visibility: visibility !== event.visibility ? visibility : undefined })
      }}
    >
      <p className="text-sm text-ink-soft">Overrides stick even when the source changes. To fix the event itself, edit it at the source.</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide this event from the directory
      </label>
      <label className="field">
        <span>Category</span>
        <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="music, art, community…" />
      </label>
      <label className="field">
        <span>Replace the image (URL)</span>
        <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" inputMode="url" />
      </label>
      <VisibilityPicker value={visibility} onChange={setVisibility} name={`vis-${event.id}`} />
      <p className="hint">Making an event less visible applies at once. Making it more visible waits for your confirmation.</p>
      {error ? <p className="notice notice-warn">{plainError(error)}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save override'}
      </button>
    </form>
  )
}
