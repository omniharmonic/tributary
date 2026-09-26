import { PublishSteps } from '../components/PublishSteps'
import { Link, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { rememberNext } from '../lib/next'
import { useConfig } from '../lib/queries'
import type { Visibility } from '../lib/types'
import { Footer, Page } from '../components/Shell'

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$/

function suggestLabel(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20)
}

export function ConnectRoute() {
  const cfg = useConfig()
  const search = useSearch({ strict: false }) as { previewId?: string; visibility?: Visibility; error?: string; handle?: string; next?: string }
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [label, setLabel] = useState('')
  const [touched, setTouched] = useState(false)
  const [existing, setExisting] = useState(search.handle ?? '')

  useEffect(() => {
    if (!touched) setLabel(suggestLabel(displayName))
  }, [displayName, touched])

  const check = useQuery({
    queryKey: ['handle-check', label],
    queryFn: () => api.checkHandle(label),
    enabled: HANDLE_RE.test(label),
    staleTime: 30_000,
  })
  const localInvalid = label.length > 0 && !HANDLE_RE.test(label)

  const signup = useMutation({
    mutationFn: () => {
      rememberNext(search.next)
      return api.signup({ email: email.trim(), displayName: displayName.trim(), handle: label, previewId: search.previewId, visibility: search.visibility, newsletter: false })
    },
  })
  const oauth = useMutation({
    mutationFn: () => {
      rememberNext(search.next)
      return api.oauthStart({ handle: existing.trim().replace(/^@/, ''), previewId: search.previewId, visibility: search.visibility })
    },
    onSuccess: (r) => {
      window.location.assign(r.redirectUrl)
    },
  })

  const canSubmit = /\S+@\S+\.\S+/.test(email) && displayName.trim().length > 1 && HANDLE_RE.test(label) && check.data?.ok === true && !signup.isPending

  if (signup.data) {
    return (
      <>
        <Page title="Check your email">
          <div className="grid gap-3">
            <p className="max-w-[56ch]">
              We sent a link to <strong>{email}</strong>. Open it and your events publish as <strong>@{signup.data.handle}</strong>. No password needed; you can set one later.
            </p>
            {signup.data.verifyUrl ? (
              <p className="notice">
                Development: <a href={signup.data.verifyUrl}>open the verification link</a>
              </p>
            ) : null}
            <p className="hint">Nothing arrives? Check spam, or <button type="button" className="underline" onClick={() => signup.mutate()}>send it again</button>.</p>
          </div>
        </Page>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Page title="Publish as…" lede="Your events go into an account that is yours. Pick a name for it. That is the only thing we ask.">
        <PublishSteps step={3} />
        {search.error === 'scopes' ? <p className="notice notice-warn mb-4">Your account&rsquo;s server does not yet allow the narrow permission we ask for (calendar events and images only). Use the first option below instead, or ask your server to update.</p> : null}
        <form
          className="panel grid gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) signup.mutate()
          }}
        >
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Name shown on your events</span>
            <input className="input" autoComplete="organization" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Dairy Arts Center" required />
          </label>
          <label className="field">
            <span>Your handle</span>
            <span className="handle-input">
              <input
                className="input"
                value={label}
                onChange={(e) => {
                  setTouched(true)
                  setLabel(e.target.value.trim().toLowerCase())
                }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="handle-status"
                required
              />
              <span className="whitespace-nowrap text-ink-soft">.{cfg.handleDomain}</span>
            </span>
            <span id="handle-status" className="hint" aria-live="polite">
              {localInvalid ? 'Letters, numbers and dashes; 3 to 20 characters.' : check.isFetching ? 'Checking…' : check.data?.ok === false ? (
                <>
                  {check.data.reason === 'taken' ? 'Already taken.' : check.data.reason === 'reserved' ? 'That name is reserved.' : 'Not allowed.'}{' '}
                  {check.data.suggestions?.length ? (
                    <>
                      Try{' '}
                      {check.data.suggestions.map((s) => (
                        <button key={s} type="button" className="mr-1 underline" onClick={() => { setTouched(true); setLabel(s) }}>
                          {s}
                        </button>
                      ))}
                    </>
                  ) : null}
                </>
              ) : check.data?.ok ? `@${label}.${cfg.handleDomain} is yours.` : 'This is your address on the network. You can change it later.'}
            </span>
          </label>
          {signup.error ? (
            <p className="notice notice-warn" role="alert">
              {plainError(signup.error)}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {signup.isPending ? 'Sending your link…' : 'Publish'}
          </button>
          <p className="hint">We email you a link to confirm. No password, no protocol vocabulary. You own the account from the first event.</p>
        </form>

        <details className="mt-6">
          <summary className="cursor-pointer font-medium">I already have an account</summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              oauth.mutate()
            }}
          >
            <p className="text-sm text-ink-soft">Sign in with any Bluesky or AT Protocol handle. We ask only for permission to write calendar events and upload images. Your events go to your existing account, on whatever server it lives.</p>
            <label className="field">
              <span>Handle</span>
              <input className="input" value={existing} onChange={(e) => setExisting(e.target.value)} placeholder="name.bsky.social" autoCapitalize="off" autoCorrect="off" />
            </label>
            {oauth.error ? <p className="notice notice-warn">{plainError(oauth.error)}</p> : null}
            <div>
              <button type="submit" className="btn" disabled={oauth.isPending || !existing.includes('.')}>
                {oauth.isPending ? 'Redirecting…' : 'Continue with my account'}
              </button>
            </div>
          </form>
        </details>
        {search.previewId ? (
          <p className="mt-6 text-sm">
            <Link to="/preview/$previewId" params={{ previewId: search.previewId }} className="underline underline-offset-2">
              Back to the preview
            </Link>
          </p>
        ) : null}
      </Page>
      <Footer />
    </>
  )
}
