import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { useActing } from '../lib/queries'
import type { SourceType, VerifyCheck, VerifyToken } from '../lib/types'

/** Push-style sources are the host's own by construction; there is nothing to prove. */
const PUSH_TYPES: ReadonlySet<SourceType> = new Set(['upload', 'manual', 'api', 'email', 'extract'])

export function canVerify(type: SourceType): boolean {
  return !PUSH_TYPES.has(type)
}

/**
 * "Prove this source is yours" (PRD §7, the podcast-directory pattern): a token placed in
 * the calendar's title or description raises the badge on every card from "Email
 * verified" to "Verified source".
 */
export function VerifySource({ sourceId }: { sourceId: string }) {
  const qc = useQueryClient()
  const { readOnly } = useActing()
  const [token, setToken] = useState<VerifyToken | null>(null)
  const [result, setResult] = useState<VerifyCheck | null>(null)
  const [copied, setCopied] = useState(false)

  const getToken = useMutation({
    mutationFn: () => api.verifySource(sourceId),
    onSuccess: (t) => {
      setToken(t)
      setResult(null)
      setCopied(false)
    },
  })
  const check = useMutation({
    mutationFn: () => api.checkVerification(sourceId),
    onSuccess: (r) => {
      setResult(r)
      if (r.verified) void qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const copy = () => {
    if (!token) return
    void navigator.clipboard?.writeText(token.token).then(() => setCopied(true))
  }

  return (
    <section className="panel grid gap-4 p-4" aria-labelledby="verify-heading">
      <div>
        <h2 id="verify-heading">Prove this source is yours</h2>
        <p className="text-sm text-ink-soft">
          Connecting a calendar does not prove you run it. Place a short token in the calendar’s title or description at the source and every card you publish moves from “Email verified” to “Verified source”. You can remove the token afterwards.
        </p>
      </div>

      {result?.verified ? (
        <p className="notice" role="status">
          Verified. Your events now carry the “Verified source” badge.
        </p>
      ) : (
        <>
          {token ? (
            <div className="grid gap-2">
              <label className="text-sm text-ink-soft" htmlFor="verify-token">
                Your token
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <code id="verify-token" className="rounded-[var(--r-md)] border border-rule bg-paper px-2 py-1 text-sm select-all">
                  {token.token}
                </code>
                <button type="button" className="btn btn-sm" onClick={copy} disabled={readOnly}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-sm text-ink-soft">{token.instructions}</p>
            </div>
          ) : null}

          {result && !result.verified ? (
            <p className="notice notice-warn" role="status">
              Not yet: {result.reason}
            </p>
          ) : null}
          {getToken.error ? <p className="notice notice-warn">{plainError(getToken.error)}</p> : null}
          {check.error ? <p className="notice notice-warn">{plainError(check.error)}</p> : null}

          <div className="flex flex-wrap gap-2">
            {!token ? (
              <button type="button" className="btn btn-primary" onClick={() => getToken.mutate()} disabled={getToken.isPending || readOnly}>
                Get a token
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => check.mutate()} disabled={check.isPending || readOnly}>
                  {check.isPending ? 'Checking…' : 'Check now'}
                </button>
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => getToken.mutate()} disabled={getToken.isPending || readOnly}>
                  Get a new token
                </button>
              </>
            )}
          </div>
          {readOnly ? <p className="text-sm text-ink-soft">Only the account’s owner or an editor can do this.</p> : null}
        </>
      )}
    </section>
  )
}
