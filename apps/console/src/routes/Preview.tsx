import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { useMe } from '../lib/queries'
import type { DetectMatch, Visibility } from '../lib/types'
import { movePendingFile, pendingFile } from '../lib/pending-file'
import { movePendingMatch, pendingMatch } from '../lib/pending-match'
import { CsvMapper } from '../components/CsvMapper'
import { platformLabel } from '../components/Badges'
import { EventCard } from '../components/EventCard'
import { PublishingNotice } from '../components/HonestTermsNotice'
import { PageState } from '../components/PageState'
import { Footer, Page } from '../components/Shell'
import { VisibilityPicker } from '../components/VisibilityPicker'

export function PreviewRoute() {
  const { previewId } = useParams({ strict: false }) as { previewId: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { me } = useMe()
  const q = useQuery({ queryKey: ['preview', previewId], queryFn: () => api.getPreview(previewId), retry: false })

  // A column change re-reads the same file (CSV) or sheet (Google Sheets) with the new
  // mapping; the result is a new preview. A sheet has no file: the original match is
  // re-sent with `hint.mapping`.
  const file = pendingFile(previewId)
  const originalMatch = pendingMatch(previewId)
  const isSheet = q.data?.source.type === 'sheet'
  const remap = useMutation({
    mutationFn: (mapping: Record<string, string | null>) => {
      if (isSheet) {
        if (!originalMatch) throw new Error('Go back and paste the sheet link again.')
        const match: DetectMatch = { ...originalMatch, hint: { ...originalMatch.hint, mapping } }
        return api.preview(match).then((p) => ({ p, match }))
      }
      if (!file) throw new Error('The file is no longer in this tab. Go back and upload it again.')
      const match: DetectMatch = { type: 'upload', platform: 'file', confidence: 1, label: file.name, hint: { kind: 'csv', name: file.name, mapping } }
      return api.preview(match, file).then((p) => ({ p, match }))
    },
    onSuccess: ({ p, match }) => {
      movePendingFile(previewId, p.previewId)
      movePendingMatch(previewId, p.previewId, match)
      qc.setQueryData(['preview', p.previewId], p)
      void navigate({ to: '/preview/$previewId', params: { previewId: p.previewId }, replace: true })
    },
  })
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [group, setGroup] = useState('')
  useEffect(() => {
    if (q.data) setVisibility(q.data.defaultVisibility)
  }, [q.data])

  const p = q.data
  const needsConfirm = !!p?.needsConfirmation || !!p?.cards.some((c) => c.needsConfirmation)

  // A signed-in host connects directly; a stranger goes to the identity step. Extracted
  // events never publish from here: they become a confirmation item first (F10).
  const connect = useMutation({
    mutationFn: async () => {
      if (needsConfirm) {
        const { id } = await api.confirmationFromPreview(previewId)
        return { confirmId: id }
      }
      await api.addSource({ previewId, defaultVisibility: visibility, audience: visibility === 'members' && group ? { group } : undefined })
      return { confirmId: null }
    },
    onSuccess: (r) => {
      if (r.confirmId) void navigate({ to: '/confirm/$id', params: { id: r.confirmId } })
      else void navigate({ to: '/dashboard', search: { welcome: undefined } })
    },
  })

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

              {p.csv ? (
                <CsvMapper
                  csv={p.csv}
                  onChange={(m) => remap.mutate(m)}
                  busy={remap.isPending}
                  lost={isSheet ? !originalMatch : !file}
                  lostNotice={isSheet ? 'Go back and paste the sheet link again to change the matching.' : undefined}
                  sourceNoun={isSheet ? 'sheet' : 'file'}
                />
              ) : null}
              {p.source.platform === 'eventbrite' ? <p className="text-sm text-ink-soft">For live sync of all your Eventbrite events, connect Eventbrite from your dashboard after publishing.</p> : null}
              {remap.error ? (
                <p className="notice notice-warn" role="alert">
                  {plainError(remap.error)}
                </p>
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
                    {connect.isPending ? (needsConfirm ? 'Preparing…' : 'Publishing…') : needsConfirm ? 'Review and confirm' : `Publish as ${me.host.displayName}`}
                  </button>
                ) : (
                  <Link to="/connect" search={{ previewId, visibility }} className={`btn btn-primary ${p.source.alreadyConnected ? 'pointer-events-none opacity-50' : ''}`}>
                    {needsConfirm ? 'Review and confirm' : 'Publish'}
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
