/**
 * The steward queue (F19): reports from the public card, oldest first, with dismiss,
 * de-index and (for custodial hosts) takedown. The server answers 404 to anyone who is
 * not a steward, and that 404 looks like any other missing page.
 */
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { relative } from '../lib/dates'
import { ApiError, plainError } from '../lib/errors'
import { REPORT_REASONS, type ReportAction, type StewardReport } from '../lib/types'
import { Empty, PageState } from '../components/PageState'
import { Sheet } from '../components/Sheet'
import { Footer, Page } from '../components/Shell'
import { NotFoundRoute } from './Misc'

const EVENT_URI = /^at:\/\/([^/]+)\/community\.lexicon\.calendar\.event\/([^/]+)$/

function eventLink(atUri: string): { did: string; rkey: string } | null {
  const m = EVENT_URI.exec(atUri)
  return m ? { did: m[1]!, rkey: m[2]! } : null
}

function reasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason
}

export function StewardRoute() {
  const qc = useQueryClient()
  const [showResolved, setShowResolved] = useState(false)
  const q = useQuery({ queryKey: ['steward-reports', showResolved], queryFn: () => api.stewardReports(showResolved), retry: false })
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundRoute />

  const reports = [...(q.data?.reports ?? [])].sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || a.createdAt.localeCompare(b.createdAt))
  const open = reports.filter((r) => !r.resolvedAt).length
  return (
    <>
      <Page title="Steward queue" lede="Reports from the public cards. De-indexing hides a listing from every public surface at once; taking it down also removes the record for accounts this directory hosts.">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-soft" role="status">
            {open === 0 ? 'No open reports.' : `${open} open report${open === 1 ? '' : 's'}.`}
          </p>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </div>
        <PageState isPending={q.isPending} error={q.error} retry={() => void q.refetch()} empty={q.data && reports.length === 0 ? <Empty title="Nothing to review">Reports sent from event pages will show up here.</Empty> : null}>
          <ul className="grid gap-4">
            {reports.map((r) => (
              <li key={r.id}>
                <ReportRow report={r} onDone={() => void qc.invalidateQueries({ queryKey: ['steward-reports'] })} />
              </li>
            ))}
          </ul>
        </PageState>
      </Page>
      <Footer />
    </>
  )
}

function ReportRow({ report, onDone }: { report: StewardReport; onDone: () => void }) {
  const [confirmTakedown, setConfirmTakedown] = useState(false)
  const resolve = useMutation({
    mutationFn: (action: ReportAction) => api.resolveReport(report.id, action),
    onSuccess: () => {
      setConfirmTakedown(false)
      onDone()
    },
  })
  const link = eventLink(report.atUri)
  const custodial = report.host?.door === 'custodial'
  const resolved = !!report.resolvedAt
  return (
    <article className={`panel grid gap-3 p-4 ${resolved ? 'opacity-70' : ''}`} aria-label={`Report: ${reasonLabel(report.reason)}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base">
          {link ? (
            <Link to="/e/$did/$rkey" params={{ did: link.did, rkey: link.rkey }}>
              {report.event?.name ?? 'Untitled event'}
            </Link>
          ) : (
            (report.event?.name ?? 'Untitled event')
          )}
        </h2>
        <span className="text-sm text-ink-soft">{relative(report.createdAt)}</span>
      </div>
      <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-ink-soft">Reason</dt>
        <dd>{reasonLabel(report.reason)}</dd>
        {report.details ? (
          <>
            <dt className="text-ink-soft">Details</dt>
            <dd className="whitespace-pre-wrap">{report.details}</dd>
          </>
        ) : null}
        <dt className="text-ink-soft">Host</dt>
        <dd>
          {report.host ? (
            <>
              <Link to="/h/$handle" params={{ handle: report.host.handle }}>
                {report.host.displayName}
              </Link>{' '}
              <span className="text-ink-soft">({report.host.door === 'custodial' ? 'hosted here' : report.host.door === 'oauth' ? 'own account' : report.host.door})</span>
            </>
          ) : (
            <span className="text-ink-soft">unknown</span>
          )}
        </dd>
        {report.event ? (
          <>
            <dt className="text-ink-soft">Listing</dt>
            <dd>
              {report.event.state} · {report.event.visibility}
              {report.event.hidden ? ' · hidden' : ''}
            </dd>
          </>
        ) : null}
        {resolved ? (
          <>
            <dt className="text-ink-soft">Resolved</dt>
            <dd>
              {report.resolution} · {relative(report.resolvedAt)}
            </dd>
          </>
        ) : null}
      </dl>
      {resolve.error ? (
        <p className="notice notice-warn" role="alert">
          {plainError(resolve.error)}
        </p>
      ) : null}
      {!resolved ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate('dismiss')}>
            Dismiss
          </button>
          <button type="button" className="btn btn-sm" disabled={resolve.isPending || !!report.event?.hidden} onClick={() => resolve.mutate('deindex')}>
            De-index
          </button>
          <button type="button" className="btn btn-sm" disabled={resolve.isPending || !custodial} title={custodial ? undefined : 'Only for accounts this directory hosts'} onClick={() => setConfirmTakedown(true)}>
            Take down
          </button>
        </div>
      ) : null}
      <Sheet open={confirmTakedown} onClose={() => setConfirmTakedown(false)} title="Take this listing down?">
        <p className="text-ink-soft">
          This hides <strong>{report.event?.name ?? 'the listing'}</strong> from every public surface and marks the record taken down on the account server. The host keeps their account and can see why in their dashboard.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={() => setConfirmTakedown(false)}>
            Keep it
          </button>
          <button type="button" className="btn btn-primary" disabled={resolve.isPending} onClick={() => resolve.mutate('takedown')}>
            {resolve.isPending ? 'Taking down…' : 'Take down'}
          </button>
        </div>
      </Sheet>
    </article>
  )
}
