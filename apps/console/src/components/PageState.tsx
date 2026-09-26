import type { ReactNode } from 'react'
import { plainError } from '../lib/errors'

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="loading-state" role="status" aria-live="polite">
      {label}…
    </p>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel grid gap-2 p-6 text-center">
      <h2>{title}</h2>
      {children ? <p className="text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-2 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice notice-warn grid gap-2" role="alert">
      <p>{plainError(error)}</p>
      {retry ? (
        <div>
          <button type="button" className="btn btn-sm" onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function PageState({ isPending, error, retry, empty, children }: { isPending: boolean; error: unknown; retry?: () => void; empty?: ReactNode; children: ReactNode }) {
  if (isPending) return <Loading />
  if (error) return <ErrorState error={error} retry={retry} />
  if (empty) return <>{empty}</>
  return <>{children}</>
}
