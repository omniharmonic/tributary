import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../lib/api'
import { plainError } from '../lib/errors'
import { shortDateTime } from '../lib/dates'
import { useMe } from '../lib/queries'
import type { ApiKey } from '../lib/types'
import { PageState } from '../components/PageState'
import { Page } from '../components/Shell'
import { Sheet } from '../components/Sheet'

export function SettingsRoute() {
  const { me } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const take = useMutation({ mutationFn: () => api.takeControl() })
  const revoke = useMutation({ mutationFn: () => api.revokeSync(), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sources'] }) })
  const del = useMutation({ mutationFn: () => api.deleteEverything(), onSuccess: () => { qc.setQueryData(['me'], null); void navigate({ to: '/' }) } })
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')

  const keysQ = useQuery({ queryKey: ['keys'], queryFn: () => api.keys() })
  const [keyName, setKeyName] = useState('')
  const [freshKey, setFreshKey] = useState<ApiKey | null>(null)
  const createKey = useMutation({ mutationFn: () => api.createKey(keyName.trim()), onSuccess: (k) => { setFreshKey(k); setKeyName(''); void qc.invalidateQueries({ queryKey: ['keys'] }) } })
  const deleteKey = useMutation({ mutationFn: (id: string) => api.deleteKey(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['keys'] }) })
  const inboundQ = useQuery({ queryKey: ['inbound'], queryFn: () => api.inbound() })
  const rotate = useMutation({ mutationFn: () => api.rotateInbound(), onSuccess: () => void qc.invalidateQueries({ queryKey: ['inbound'] }) })

  if (!me) return null
  const custodial = me.host.door === 'custodial'

  return (
    <Page title="Settings" lede={`Signed in as @${me.host.handle}. ${custodial ? 'This account is real and yours; two buttons below always work.' : 'You signed in with your own account; your events live there.'}`}>
      <div className="grid gap-6">
        {custodial ? (
          <section className="panel grid gap-3 p-4">
            <h2>Your account</h2>
            <p className="text-sm text-ink-soft">We hold only a limited key that can publish events for you. We never had your password.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={() => take.mutate()} disabled={take.isPending || !me.capabilities.canSetPassword}>
                Set a password and take full control
              </button>
              <a className="btn" href="/about/publishing#move">
                Move my account to another server
              </a>
            </div>
            {take.data ? <p className="notice">We emailed you a link to set a password. After that, the account is fully yours: use it in any app, or keep publishing here.</p> : null}
            {take.error ? <p className="notice notice-warn">{plainError(take.error)}</p> : null}
            <details>
              <summary className="cursor-pointer text-sm">Stop us publishing for you</summary>
              <p className="mt-2 text-sm text-ink-soft">This revokes our key. Sources pause; nothing already published changes.</p>
              <button type="button" className="btn btn-sm mt-2" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
                Revoke our access
              </button>
              {revoke.data ? <p className="mt-2 text-sm">Revoked. Sources are paused.</p> : null}
            </details>
          </section>
        ) : null}

        <section className="panel grid gap-3 p-4">
          <h2>Send events to us</h2>
          <PageState isPending={inboundQ.isPending} error={inboundQ.error}>
            {inboundQ.data ? (
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-ink-soft">Forward any invite or newsletter to</dt>
                  <dd>
                    <code className="break-all">{inboundQ.data.email}</code>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Webhook (Zapier, Make, n8n)</dt>
                  <dd>
                    <code className="break-all">{inboundQ.data.webhookUrl}</code>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Webhook secret</dt>
                  <dd>
                    <code className="break-all">{inboundQ.data.webhookSecret}</code>
                  </dd>
                </div>
              </dl>
            ) : null}
          </PageState>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              Rotate address and secret
            </button>
          </div>
        </section>

        <section className="panel grid gap-3 p-4">
          <h2>API keys</h2>
          <p className="text-sm text-ink-soft">For your own scripts and agents. Each key can only publish as you.</p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (keyName.trim()) createKey.mutate()
            }}
          >
            <input className="input max-w-xs" placeholder="What is this key for?" value={keyName} onChange={(e) => setKeyName(e.target.value)} aria-label="Key name" />
            <button type="submit" className="btn" disabled={createKey.isPending || !keyName.trim()}>
              Create key
            </button>
          </form>
          {freshKey?.key ? (
            <div className="notice grid gap-1">
              <p className="font-medium">Copy this now. It is shown once.</p>
              <code className="break-all text-sm">{freshKey.key}</code>
            </div>
          ) : null}
          <PageState isPending={keysQ.isPending} error={keysQ.error}>
            <ul className="grid gap-2 text-sm">
              {keysQ.data?.keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {k.name} <span className="text-ink-soft">· created {shortDateTime(k.createdAt)}{k.lastUsedAt ? `, last used ${shortDateTime(k.lastUsedAt)}` : ''}</span>
                  </span>
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => deleteKey.mutate(k.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </PageState>
        </section>

        <section className="panel grid gap-3 p-4">
          <h2>Your data</h2>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href={api.exportUrl()} download>
              Export everything (JSON)
            </a>
            <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
              Delete everything
            </button>
          </div>
        </section>
      </div>

      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Delete everything?">
        <p>This unpublishes every event we hold for you, removes your sources{custodial ? ', and deletes the account we created' : ''}. Copies other apps made cannot be recalled.</p>
        <label className="field">
          <span>Type &ldquo;delete everything&rdquo; to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        {del.error ? <p className="notice notice-warn">{plainError(del.error)}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="btn btn-danger" disabled={typed !== 'delete everything' || del.isPending} onClick={() => del.mutate()}>
            {del.isPending ? 'Deleting…' : 'Delete everything'}
          </button>
          <button type="button" className="btn" onClick={() => setDeleting(false)}>
            Keep it
          </button>
        </div>
      </Sheet>
    </Page>
  )
}
