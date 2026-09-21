import { Link, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { SOURCE_ERROR_TEXT, plainError } from '../lib/errors'
import { relative } from '../lib/dates'
import { keys } from '../lib/queries'
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
  const q = useQuery({ queryKey: keys.sources, queryFn: () => api.sources() })
  const [removing, setRemoving] = useState<Source | null>(null)
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.sources })
  const sync = useMutation({ mutationFn: (id: string) => api.syncSource(id), onSuccess: invalidate })
  const pause = useMutation({ mutationFn: (v: { id: string; paused: boolean }) => api.patchSource(v.id, { paused: v.paused }), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => api.removeSource(id), onSuccess: () => { setRemoving(null); invalidate() } })

  return (
    <Page title="Your sources" lede="Each one is checked on its own schedule. Edit events where they live; changes show up here by themselves.">
      {search.welcome ? (
        <p className="notice mb-5" role="status">
          You&rsquo;re in. Your first events are publishing now. This page is where you come back to see how each source is doing.
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
              <li key={s.id} className="panel grid gap-3 p-4">
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
                  <button type="button" className="btn btn-sm" onClick={() => sync.mutate(s.id)} disabled={sync.isPending}>
                    Sync now
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => pause.mutate({ id: s.id, paused: s.status !== 'paused' })} disabled={pause.isPending}>
                    {s.status === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <Link to="/dashboard/sources/$id" params={{ id: s.id }} className="btn btn-sm">
                    Rules and history
                  </Link>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoving(s)}>
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        {sync.error || pause.error ? <p className="notice notice-warn mt-3">{plainError(sync.error ?? pause.error)}</p> : null}
        <div className="mt-6">
          <Link to="/add" className="btn">
            Add another source
          </Link>
        </div>
      </PageState>
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
