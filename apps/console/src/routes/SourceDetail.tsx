import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { shortDateTime } from '../lib/dates'
import { keys } from '../lib/queries'
import type { Rule, Visibility } from '../lib/types'
import { VISIBILITY_LABEL, platformLabel } from '../components/Badges'
import { PageState } from '../components/PageState'
import { Page } from '../components/Shell'
import { OPTIONS, VisibilityPicker } from '../components/VisibilityPicker'
import { sourceStatusText } from './Dashboard'

const MATCH_KINDS: Array<{ key: keyof Rule['match']; label: string; kind: 'text' | 'select' }> = [
  { key: 'titleContains', label: 'the title contains', kind: 'text' },
  { key: 'calendar', label: 'the calendar is', kind: 'text' },
  { key: 'category', label: 'the category is', kind: 'text' },
  { key: 'locationType', label: 'the location is', kind: 'select' },
  { key: 'flag', label: 'the source marks it', kind: 'select' },
]

export function SourceDetailRoute() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const q = useQuery({ queryKey: keys.source(id), queryFn: () => api.source(id) })
  const [rules, setRules] = useState<Rule[]>([])
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [group, setGroup] = useState('')
  const [pending, setPending] = useState<number | null>(null)
  useEffect(() => {
    if (q.data) {
      setRules(q.data.rules)
      setVisibility(q.data.defaultVisibility)
      setGroup(q.data.audience?.group ?? '')
    }
  }, [q.data])
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.source(id) })
    void qc.invalidateQueries({ queryKey: keys.sources })
  }
  const saveRules = useMutation({ mutationFn: () => api.putRules(id, rules), onSuccess: (r) => { if (r.pendingConfirmation) setPending(r.pendingConfirmation); invalidate() } })
  const saveDefault = useMutation({
    mutationFn: () => api.patchSource(id, { defaultVisibility: visibility, audience: visibility === 'members' && group ? { group } : undefined }),
    onSuccess: (r) => {
      if ('pendingConfirmation' in r) setPending(r.pendingConfirmation)
      invalidate()
    },
  })

  return (
    <Page>
      <PageState isPending={q.isPending} error={q.error} retry={() => void q.refetch()}>
        {q.data ? (
          <div className="grid gap-8">
            <div className="grid gap-1">
              <p className="text-sm">
                <Link to="/dashboard" className="underline underline-offset-2">
                  Your sources
                </Link>
              </p>
              <h1>{q.data.label}</h1>
              <p className="text-ink-soft">
                {platformLabel(q.data.platform)} · times read in {q.data.tz ?? 'the source zone'} · checked every {q.data.interval ?? 30} minutes
              </p>
              <p className="text-sm text-ink-soft">{sourceStatusText(q.data).text}</p>
            </div>

            {pending ? (
              <p className="notice notice-held" role="status">
                {pending} {pending === 1 ? 'event' : 'events'} would become more visible. Nothing widens on its own: confirm it in{' '}
                <Link to="/dashboard/confirmations" className="underline underline-offset-2">
                  To confirm
                </Link>
                .
              </p>
            ) : null}

            <section className="panel grid gap-4 p-4">
              <h2>Default for new events</h2>
              <VisibilityPicker value={visibility} onChange={setVisibility} groupName={group} onGroupNameChange={setGroup} name="default-visibility" />
              {saveDefault.error ? <p className="notice notice-warn">{plainError(saveDefault.error)}</p> : null}
              <div>
                <button type="button" className="btn btn-primary" onClick={() => saveDefault.mutate()} disabled={saveDefault.isPending}>
                  Save default
                </button>
              </div>
            </section>

            <section className="panel grid gap-4 p-4">
              <div>
                <h2>Rules</h2>
                <p className="text-sm text-ink-soft">Checked in order; the first that matches decides. Rules can only make an event less visible on their own; anything wider waits for your confirmation.</p>
              </div>
              <ul className="grid gap-3">
                {rules.map((r, i) => (
                  <li key={i} className="grid gap-2 rounded-[var(--r-md)] border border-rule p-3">
                    <RuleEditor rule={r} onChange={(nr) => setRules(rules.map((x, j) => (j === i ? nr : x)))} onRemove={() => setRules(rules.filter((_, j) => j !== i))} />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-sm" onClick={() => setRules([...rules, { match: { titleContains: '' }, level: 'held' }])}>
                  Add a rule
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => saveRules.mutate()} disabled={saveRules.isPending}>
                  Save rules
                </button>
              </div>
              {saveRules.error ? <p className="notice notice-warn">{plainError(saveRules.error)}</p> : null}
            </section>

            <section className="grid gap-2">
              <h2>Sync history</h2>
              {q.data.syncRuns.length === 0 ? (
                <p className="text-ink-soft">No runs yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-ink-soft">
                      <tr>
                        <th className="py-1 pr-3 font-normal">When</th>
                        <th className="py-1 pr-3 font-normal">Result</th>
                        <th className="py-1 pr-3 font-normal">Read</th>
                        <th className="py-1 pr-3 font-normal">New</th>
                        <th className="py-1 pr-3 font-normal">Changed</th>
                        <th className="py-1 pr-3 font-normal">Cancelled</th>
                        <th className="py-1 pr-3 font-normal">Held</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.syncRuns.map((r, i) => (
                        <tr key={i} className="border-t border-rule">
                          <td className="py-1.5 pr-3 whitespace-nowrap">{shortDateTime(r.startedAt)}</td>
                          <td className="py-1.5 pr-3">{r.ok ? 'ok' : <span className="text-warn">{r.error?.message ?? 'failed'}</span>}</td>
                          <td className="py-1.5 pr-3">{r.fetched}</td>
                          <td className="py-1.5 pr-3">{r.published}</td>
                          <td className="py-1.5 pr-3">{r.updated}</td>
                          <td className="py-1.5 pr-3">{r.cancelled}</td>
                          <td className="py-1.5 pr-3">{r.held}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <p className="text-sm">
              <Link to="/dashboard/events" search={{ sourceId: id }} className="underline underline-offset-2">
                See every event from this source
              </Link>
            </p>
          </div>
        ) : null}
      </PageState>
    </Page>
  )
}

function RuleEditor({ rule, onChange, onRemove }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void }) {
  const activeKey = (Object.keys(rule.match) as Array<keyof Rule['match']>)[0] ?? 'titleContains'
  const kind = MATCH_KINDS.find((k) => k.key === activeKey) ?? MATCH_KINDS[0]!
  const value = rule.match[activeKey] ?? ''
  return (
    <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto_1fr_auto] sm:items-center">
      <span className="text-sm text-ink-soft">When</span>
      <select className="select" value={activeKey} onChange={(e) => onChange({ ...rule, match: { [e.target.value]: '' } as Rule['match'] })} aria-label="Match on">
        {MATCH_KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
      {kind.kind === 'text' ? (
        <input className="input sm:col-span-1" value={value} onChange={(e) => onChange({ ...rule, match: { [activeKey]: e.target.value } as Rule['match'] })} placeholder={activeKey === 'titleContains' ? '[Members]' : ''} aria-label="Value" />
      ) : (
        <select className="select" value={value} onChange={(e) => onChange({ ...rule, match: { [activeKey]: e.target.value } as Rule['match'] })} aria-label="Value">
          {activeKey === 'locationType' ? (
            <>
              <option value="home">a home address</option>
              <option value="venue">a venue</option>
              <option value="online">online</option>
            </>
          ) : (
            <>
              <option value="private">private</option>
              <option value="membersOnly">members only</option>
            </>
          )}
        </select>
      )}
      <span className="text-sm text-ink-soft">then</span>
      <select className="select" value={rule.level} onChange={(e) => onChange({ ...rule, level: e.target.value as Visibility })} aria-label="Then make it">
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {VISIBILITY_LABEL[o.value]}
          </option>
        ))}
      </select>
      {rule.level === 'members' ? <input className="input sm:col-span-4" placeholder="Group handle" value={rule.audience?.group ?? ''} onChange={(e) => onChange({ ...rule, audience: { ...(rule.audience ?? {}), group: e.target.value } })} aria-label="Group" /> : null}
      <button type="button" className="btn btn-sm btn-quiet justify-self-start sm:col-span-5" onClick={onRemove}>
        Remove rule
      </button>
    </div>
  )
}
