/**
 * Logging policy: no request bodies, no DIDs, no emails, no handles, no record
 * contents. Anything that could carry one goes through `safe()`. Never log an
 * error's message; `describeError` gives the class plus the XRPC code.
 */
const DID_RE = /did:[a-z0-9]+:[a-zA-Z0-9._:%-]+/g
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const AT_URI_RE = /at:\/\/[^\s"']+/g

export function safe(value: unknown): string {
  const s = typeof value === 'string' ? value : value instanceof Error ? `${value.name}` : String(value)
  return s.replace(DID_RE, 'did:<redacted>').replace(EMAIL_RE, '<email>').replace(AT_URI_RE, 'at://<uri>').slice(0, 500)
}

const XRPC_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err === 'string' ? 'error' : 'unknown'
  const code = (err as { error?: unknown; code?: unknown }).error ?? (err as { code?: unknown }).code
  return typeof code === 'string' && XRPC_ERROR_CODE.test(code) ? `${err.name}: ${code}` : err.name
}

type Fields = Record<string, string | number | boolean | undefined>

function fmt(fields: Fields): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? safe(v) : v}`)
    .join(' ')
}

export const log = {
  info: (msg: string, fields?: Fields) => console.log(`[tributary] ${safe(msg)}${fields ? ' ' + fmt(fields) : ''}`),
  warn: (msg: string, fields?: Fields) => console.warn(`[tributary] ${safe(msg)}${fields ? ' ' + fmt(fields) : ''}`),
  error: (msg: string, fields?: Fields) => console.error(`[tributary] ${safe(msg)}${fields ? ' ' + fmt(fields) : ''}`),
}
