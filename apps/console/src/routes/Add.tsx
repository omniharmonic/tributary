import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import type { DetectMatch } from '../lib/types'
import { platformLabel } from '../components/Badges'
import { OneBox, type OneBoxSubmit } from '../components/OneBox'
import { Footer, Page } from '../components/Shell'

export function AddRoute() {
  const navigate = useNavigate()
  const [pending, setPending] = useState<{ submit: OneBoxSubmit; matches: DetectMatch[] } | null>(null)
  const detect = useMutation({
    mutationFn: (s: OneBoxSubmit) => api.detect(s.input, s.file),
    onSuccess: (res, s) => {
      if (res.matches.length === 0) return
      setPending({ submit: s, matches: res.matches })
      const top = res.matches[0]!
      // Structured sources go straight to preview; anything that needs a look first waits here.
      if (top.confidence >= 0.9 && !top.note) preview.mutate({ match: top, file: s.file })
    },
  })
  const preview = useMutation({
    mutationFn: (v: { match: DetectMatch; file?: File }) => api.preview(v.match, v.file),
    onSuccess: (p) => void navigate({ to: '/preview/$previewId', params: { previewId: p.previewId } }),
  })
  const busy = detect.isPending || preview.isPending
  const error = detect.error ?? preview.error

  return (
    <>
      <Page title="Add your events" lede="Paste a link, drop a file, or describe an event. You keep using whatever you use now; we keep the directory up to date.">
        <OneBox onSubmit={(s) => { setPending(null); detect.mutate(s) }} busy={busy} autoFocus />
        {error ? (
          <p className="notice notice-warn mt-4" role="alert">
            {plainError(error)}
          </p>
        ) : null}
        {detect.data && detect.data.matches.length === 0 ? <p className="notice notice-warn mt-4">We could not tell what that is. Try the full link to the calendar or the event page, or describe the event in a sentence.</p> : null}
        {pending && !preview.isPending ? (
          <section className="panel mt-6 grid gap-3 p-4" aria-live="polite">
            <p className="text-sm text-ink-soft">This looks like</p>
            <MatchRow match={pending.matches[0]!} primary onPick={() => preview.mutate({ match: pending.matches[0]!, file: pending.submit.file })} />
            {pending.matches.length > 1 ? (
              <details>
                <summary className="cursor-pointer text-sm text-ink-soft">Not right?</summary>
                <ul className="mt-2 grid gap-2">
                  {pending.matches.slice(1).map((m, i) => (
                    <li key={i}>
                      <MatchRow match={m} onPick={() => preview.mutate({ match: m, file: pending.submit.file })} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
        {preview.isPending ? (
          <p className="mt-6 text-ink-soft" role="status">
            Reading the source and building your preview…
          </p>
        ) : null}
      </Page>
      <Footer />
    </>
  )
}

function MatchRow({ match, primary, onPick }: { match: DetectMatch; primary?: boolean; onPick: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="grid gap-0.5">
        <p className="font-medium">
          {match.label} <span className="text-ink-soft">({platformLabel(match.platform)})</span>
        </p>
        {match.note ? <p className="text-sm text-ink-soft">{match.note}</p> : null}
      </div>
      {match.platform === 'unsupported' ? null : (
        <button type="button" className={`btn btn-sm ${primary ? 'btn-primary' : ''}`} onClick={onPick}>
          {primary ? 'Preview events' : 'Use this'}
        </button>
      )}
    </div>
  )
}
