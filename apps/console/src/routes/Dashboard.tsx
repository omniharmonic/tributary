import { Link, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { SOURCE_ERROR_TEXT, plainError } from '../lib/errors'
import { relative } from '../lib/dates'
import { keys, useActing } from '../lib/queries'
import type { Source } from '../lib/types'
import { VISIBILITY_LABEL, platformLabel } from '../components/Badges'
import { Empty, PageState } from '../components/PageState'
import { Page } from '../components/Shell'
import { Sheet } from '../components/Sheet'

export function sourceStatusText(s: Source): { text: string; tone: 'ok' | 'warn' | 'held' | 'quiet' } {
  if (s.status === 'paused') return { text: 'Paused. Your events stay up.', tone: 'quiet' }
  if (s.status === 'failing') return { text: s.lastError ? (SOURCE_ERROR_TEXT[s.lastError.code] ?? s.lastError.message) : 'The last sync failed.', tone: 'warn' }
  if (s.status === 'held') return { text: 'Held for review. Nothing is published yet.', tone: 'held' }
  if (!s.lastSuccessAt) return { text: 'First sync is running.', tone: 'quiet' }
  return { text: `Synced ${relative(s.lastSuccessAt)}. Next check ${relative(s.nextRunAt)}.`, tone: 'ok' }
}

export function DashboardRoute() {
  const search = useSearch({ strict: false }) as { welcome?: string }
  const qc = useQueryClient()
  const { readOnly, acting } = useActing()
  const q = useQuery({ queryKey: keys.sources, queryFn: () => api.sources() })
  const [removing, setRemoving] = useState<Source | null>(null)
  const [eventbrite, setEventbrite] = useState(false)
  const [token, setToken] = useState('')
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.sources })
  const connectEb = useMutation({
    mutationFn: () => api.connectEventbrite(token.trim()),
    onSuccess: () => {
      setEventbrite(false)
      setToken('')
      invalidate()
    },
  })
  const sync = useMutation({ mutationFn: (id: string) => api.syncSource(id), onSuccess: invalidate })
  const pause = useMutation({ mutationFn: (v: { id: string; paused: boolean }) => api.patchSource(v.id, { paused: v.paused }), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => api.removeSource(id), onSuccess: () => { setRemoving(null); invalidate() } })

  return (
    <Page title={acting ? `${acting.displayName}'s sources` : 'Your sources'} lede={readOnly ? 'You can look but not change anything here.' : 'Each one is checked on its own schedule. Edit events where they live; changes show up here by themselves.'}>
      {search.welcome ? (
        <p className="notice mb-5" role="status">
          You&rsquo;re signed in. Manage your connected calendars and review anything waiting to publish here.
        </p>
      ) : null}
      <PageState
        isPending={q.isPending}
        error={q.error}
        retry={() => void q.refetch()}
        empty={q.data && q.data.sources.length === 0 ? <Empty title="No sources yet" action={<Link to="/add" className="btn btn-primary">Add your events</Link>}>Paste a calendar link or a page and your events will appear on the directory.</Empty> : null}
      >
        <ul className="grid gap-3">
          {q.data?.sources.map((s) => {
            const st = sourceStatusText(s)
            return (
              <li key={s.id} className="source-panel panel grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate">
                      <Link to="/dashboard/sources/$id" params={{ id: s.id }} className="no-underline hover:underline">
                        {s.label}
                      </Link>
                    </h2>
                    <p className="text-sm text-ink-soft">
                      {platformLabel(s.platform)} · {VISIBILITY_LABEL[s.defaultVisibility]}
                      {s.url ? (
                        <>
                          {' '}
                          ·{' '}
                          <a href={s.url} className="underline underline-offset-2" target="_blank" rel="noreferrer noopener">
                            source
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <p className="text-sm text-ink-soft">
                    {s.counts.live} live{s.counts.cancelled ? `, ${s.counts.cancelled} cancelled` : ''}{s.counts.held ? `, ${s.counts.held} held` : ''}
                  </p>
                </div>
                <p className={st.tone === 'warn' ? 'notice notice-warn' : st.tone === 'held' ? 'notice notice-held' : 'text-sm text-ink-soft'} role={st.tone === 'warn' ? 'alert' : undefined}>
                  {st.text}
                  {st.tone === 'warn' && s.consecutiveFailures > 0 ? ` (${s.consecutiveFailures} tries)` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => sync.mutate(s.id)} disabled={sync.isPending || readOnly}>
                    {sync.isPending && sync.variables === s.id ? 'Queuing sync…' : 'Sync now'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => pause.mutate({ id: s.id, paused: s.status !== 'paused' })} disabled={pause.isPending || readOnly}>
                    {s.status === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <Link to="/dashboard/sources/$id" params={{ id: s.id }} className="btn btn-sm">
                    Rules and history
                  </Link>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoving(s)} disabled={readOnly}>
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        {sync.isSuccess ? <p className="notice mt-3" role="status">Sync queued. Your source will be checked shortly.</p> : null}
        {sync.error || pause.error ? <p className="notice notice-warn mt-3">{plainError(sync.error ?? pause.error)}</p> : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/add" className={`btn ${readOnly ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={readOnly || undefined}>
            Add another source
          </Link>
          <button type="button" className="btn" onClick={() => setEventbrite(true)} disabled={readOnly}>
            Connect Eventbrite
          </button>
        </div>
      </PageState>
      <Sheet open={eventbrite} onClose={() => setEventbrite(false)} title="Connect Eventbrite">
        <p className="text-sm text-ink-soft">
          Single Eventbrite pages already work by pasting the link. Connecting your account keeps <em>all</em> your organisation&rsquo;s events in sync, images included.
        </p>
        <p className="text-sm">
          Paste the <strong>Private token</strong> from{' '}
          <a href="https://www.eventbrite.com/platform/api-keys" target="_blank" rel="noreferrer noopener">
            eventbrite.com/platform/api-keys
          </a>
          . We use it only to read your organisation&rsquo;s events, store it encrypted, and never show it again.
        </p>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (token.trim()) connectEb.mutate()
          }}
        >
          <label className="field">
            <span>Private token</span>
            <input className="input" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          {connectEb.error ? (
            <p className="notice notice-warn" role="alert">
              {plainError(connectEb.error)}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={connectEb.isPending || !token.trim()}>
              {connectEb.isPending ? 'Connecting…' : 'Connect'}
            </button>
            <button type="button" className="btn" onClick={() => setEventbrite(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Sheet>
      <Sheet open={!!removing} onClose={() => setRemoving(null)} title="Remove this source?">
        {removing ? (
          <>
            <p>
              Every event from <strong>{removing.label}</strong> ({removing.counts.live} live) will be unpublished. Apps that copied them may keep their copies.
            </p>
            {remove.error ? <p className="notice notice-warn">{plainError(remove.error)}</p> : null}
            <div className="flex gap-2">
              <button type="button" className="btn btn-danger" onClick={() => remove.mutate(removing.id)} disabled={remove.isPending}>
                {remove.isPending ? 'Removing…' : 'Remove and unpublish'}
              </button>
              <button type="button" className="btn" onClick={() => setRemoving(null)}>
                Keep it
              </button>
            </div>
          </>
        ) : null}
      </Sheet>
    </Page>
  )
}
