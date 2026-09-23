/**
 * The on-demand TLS gate for this stack's names.
 *
 * Caddy fronts `*.boulderevents.directory` and cannot get a wildcard certificate here:
 * there is no DNS challenge on this box. So every handle host is issued one name at a
 * time and Caddy asks this endpoint first. Three rules, in order:
 *
 *   1. names this deployment owns outright: the app host, `www.` of it, and the PDS host;
 *   2. a single label under the handle domain, which only the PDS can vouch for, since it
 *      is the thing that issued the handle;
 *   3. everything else is no.
 *
 * A PDS that fails to answer inside three seconds is also a no. Let's Encrypt allows
 * fifty certificates per registered domain per week, and a gate that answers from a
 * pattern rather than from known names spends that budget the first time a bot dials
 * random names at the box.
 *
 * Privacy: the domain is a host's handle. It is never logged, never echoed into a
 * response body, and never carried into an error message.
 */
import { Hono } from 'hono'
import { config } from '../../config.js'
import type { Vars } from '../context.js'

export const internalRoutes = new Hono<{ Variables: Vars }>()

const PDS_TIMEOUT_MS = 3000

/** The single label of `host` directly under `suffix`, or null. */
export function labelUnder(hostname: string, suffix: string): string | null {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '')
  const s = suffix.trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '')
  if (!h || !s || !h.endsWith(`.${s}`)) return null
  const label = h.slice(0, -(s.length + 1))
  return label && !label.includes('.') ? label : null
}

async function pdsVouchesFor(hostname: string): Promise<boolean> {
  const c = config()
  const base = (c.PDS_INTERNAL_URL || c.PDS_URL).replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/tls-check?domain=${encodeURIComponent(hostname)}`, { signal: AbortSignal.timeout(PDS_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

export async function allowCertificateFor(domain: string): Promise<boolean> {
  const c = config()
  const host = domain.trim().toLowerCase().replace(/\.$/, '')
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return false

  const webHost = new URL(c.WEB_PUBLIC_URL).hostname
  const pdsHost = new URL(c.PDS_URL).hostname
  if (host === webHost || host === `www.${webHost}` || host === pdsHost) return true

  if (!labelUnder(host, c.handleDomain)) return false
  return pdsVouchesFor(host)
}

internalRoutes.get('/tls-check', async (c) => {
  const domain = c.req.query('domain') ?? ''
  return (await allowCertificateFor(domain)) ? c.text('ok', 200) : c.text('no', 403)
})
