import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { rememberNext, takeNext } from '../lib/next'
import { Footer, Page } from '../components/Shell'

export function VerifyRoute() {
  const search = useSearch({ strict: false }) as { token?: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const verify = useMutation({
    mutationFn: () => api.verify(search.token ?? ''),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['me'] })
      // A destination remembered before the magic link (a join link, say) wins over the default landing.
      const target = takeNext() ?? r.redirect ?? '/dashboard?welcome=1'
      const url = new URL(target, window.location.origin)
      void navigate({ to: url.pathname, search: Object.fromEntries(url.searchParams) as Record<string, string> })
    },
  })
  useEffect(() => {
    if (search.token) verify.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.token])
  return (
    <>
      <Page title={verify.error ? 'That link did not work' : 'Signing you in'}>
        {verify.error ? (
          <div className="grid gap-3">
            <p className="notice notice-warn">{plainError(verify.error)}</p>
            <a className="btn" href="/login">
              Ask for a new link
            </a>
          </div>
        ) : (
          <p className="text-ink-soft" role="status">
            One moment…
          </p>
        )}
      </Page>
      <Footer />
    </>
  )
}

/**
 * Two doors, and the AT Protocol one comes first.
 *
 * Somebody with a handle already has an identity, a repo and, often, a calendar in it.
 * Signing in that way takes them straight to their own events; the email door exists for
 * everyone else and for hosts we made an account for. The handle field accepts what
 * people actually type — `@alice.bsky.social`, `alice.bsky.social`, a DID — because
 * being fussy about the `@` at the front of an identity is a bad first impression.
 */
export function LoginRoute() {
  const search = useSearch({ strict: false }) as { next?: string; error?: string }
  const [handle, setHandle] = useState('')
  const [email, setEmail] = useState('')
  const login = useMutation({
    mutationFn: () => {
      rememberNext(search.next)
      return api.login(email.trim())
    },
  })
  const oauth = useMutation({
    mutationFn: async () => {
      rememberNext(search.next)
      const r = await api.oauthStart({ handle: handle.trim().replace(/^@/, '').toLowerCase() })
      window.location.href = r.redirectUrl
      return r
    },
  })
  const handleLooksReady = /^@?[a-z0-9.-]+\.[a-z]{2,}$/i.test(handle.trim()) || /^did:/i.test(handle.trim())

  return (
    <>
      <Page title="Sign in" lede="However you got here, your events stay in your own repo and under your own name.">
        {search.error === 'scopes' ? (
          <p className="notice notice-warn" role="alert">
            Your server would not grant the permissions we asked for, so we stopped rather than ask for more than we need. The email door works regardless.
          </p>
        ) : null}
        {login.data ? (
          <div className="grid gap-3">
            <p>
              We sent a link to <strong>{email}</strong>.
            </p>
            {login.data.verifyUrl ? (
              <p className="notice">
                Development: <a href={login.data.verifyUrl}>open the sign-in link</a>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-5">
            <form
              className="panel grid gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault()
                oauth.mutate()
              }}
            >
              <label className="field">
                <span>Your AT Protocol handle</span>
                <input className="input" placeholder="alice.bsky.social" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={handle} onChange={(e) => setHandle(e.target.value)} autoFocus />
              </label>
              {oauth.error ? (
                <p className="notice notice-warn" role="alert">
                  {plainError(oauth.error)}
                </p>
              ) : null}
              <button className="btn btn-primary" type="submit" disabled={oauth.isPending || !handleLooksReady}>
                {oauth.isPending ? 'Taking you to your server…' : 'Continue with your handle'}
              </button>
              <p className="hint">
                You will approve this on your own server. We ask only to read and write calendar events and image blobs \u2014 nothing else in your repo. Any calendar events already there will be listed here.
              </p>
            </form>

            <form
              className="panel grid gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault()
                login.mutate()
              }}
            >
              <label className="field">
                <span>Or the email you published with</span>
                <input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {login.error ? (
                <p className="notice notice-warn" role="alert">
                  {plainError(login.error)}
                </p>
              ) : null}
              <button className="btn" type="submit" disabled={login.isPending || !/\S+@\S+\.\S+/.test(email)}>
                {login.isPending ? 'Sending\u2026' : 'Send me a link'}
              </button>
              <p className="hint">
                Not a host yet? <a href="/add" className="underline underline-offset-2">Add your events</a> to get started.
              </p>
            </form>
          </div>
        )}
      </Page>
      <Footer />
    </>
  )
}
