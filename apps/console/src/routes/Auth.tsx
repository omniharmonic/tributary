import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { Footer, Page } from '../components/Shell'

export function VerifyRoute() {
  const search = useSearch({ strict: false }) as { token?: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const verify = useMutation({
    mutationFn: () => api.verify(search.token ?? ''),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['me'] })
      const target = r.redirect ?? '/dashboard?welcome=1'
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

export function LoginRoute() {
  const [email, setEmail] = useState('')
  const login = useMutation({ mutationFn: () => api.login(email.trim()) })
  return (
    <>
      <Page title="Sign in" lede="Hosts sign in with the email they published with. We send a link; there is no password unless you set one.">
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
          <form
            className="panel grid gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault()
              login.mutate()
            }}
          >
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            {login.error ? (
              <p className="notice notice-warn" role="alert">
                {plainError(login.error)}
              </p>
            ) : null}
            <button className="btn btn-primary" type="submit" disabled={login.isPending || !/\S+@\S+\.\S+/.test(email)}>
              {login.isPending ? 'Sending…' : 'Send me a link'}
            </button>
            <p className="hint">
              Not a host yet? <a href="/add" className="underline underline-offset-2">Add your events</a> to get started.
            </p>
          </form>
        )}
      </Page>
      <Footer />
    </>
  )
}
