/**
 * The inbound email worker (architecture §13): a Cloudflare Email Worker on
 * `in.<domain>` that verifies the recipient token shape, records the authentication
 * results Cloudflare already computed, and posts the raw message to Tributary over a
 * signed webhook. Tributary decides what to publish; this only carries mail.
 *
 * Deploy: `wrangler deploy` from this directory with secrets `TRIBUTARY_URL` and
 * `INBOUND_EMAIL_SECRET` (the same value as Tributary's), then add an Email Routing
 * catch-all rule for the `in.` subdomain that sends to this worker.
 */
export interface Env {
  TRIBUTARY_URL: string
  INBOUND_EMAIL_SECRET: string
}

interface EmailMessage {
  readonly from: string
  readonly to: string
  readonly headers: Headers
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  setReject(reason: string): void
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function authResult(headers: Headers, kind: 'spf' | 'dkim' | 'dmarc'): string {
  const h = headers.get('authentication-results') ?? ''
  const m = new RegExp(`${kind}=(pass|fail|none|neutral|softfail|permerror|temperror)`, 'i').exec(h)
  return m?.[1]?.toLowerCase() ?? 'none'
}

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    if (!/^add\+[A-Za-z0-9_-]{6,}@/.test(message.to)) {
      message.setReject('No such address')
      return
    }
    if (message.rawSize > 15 * 1024 * 1024) {
      message.setReject('Message too large')
      return
    }
    const bytes = new Uint8Array(await new Response(message.raw).arrayBuffer())
    let raw = ''
    for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const body = JSON.stringify({ to: message.to, from: message.from, spf: authResult(message.headers, 'spf'), dkim: authResult(message.headers, 'dkim'), dmarc: authResult(message.headers, 'dmarc'), raw: btoa(raw) })
    const sig = await hmacHex(env.INBOUND_EMAIL_SECRET, body)
    const res = await fetch(`${env.TRIBUTARY_URL.replace(/\/$/, '')}/api/inbound/email`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tributary-signature': `sha256=${sig}` }, body })
    if (!res.ok && res.status !== 202) {
      // A transient failure should make Cloudflare retry rather than drop the mail.
      throw new Error(`tributary answered ${res.status}`)
    }
  },
}
