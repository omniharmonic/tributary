/**
 * Logging policy: no DIDs, no record bodies, no tokens, no error messages (an XRPC or
 * pg message can carry an identifier). Same rules as the rest of the suite.
 */
const DID_RE = /did:[a-z0-9]+:[a-zA-Z0-9._:%-]+/g
const AT_URI_RE = /at:\/\/[^\s"']+/g

export function safe(value: unknown): string {
  const s = typeof value === 'string' ? value : value instanceof Error ? value.name : String(value)
  return s.replace(DID_RE, 'did:<redacted>').replace(AT_URI_RE, 'at://<uri>').slice(0, 300)
}

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown'
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code) ? `${err.name}: ${code}` : err.name
}

type Fields = Record<string, string | number | boolean>
function fmt(fields?: Fields): string {
  if (!fields) return ''
  return ' ' + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? safe(v) : v}`).join(' ')
}

export const log = {
  info: (msg: string, fields?: Fields) => console.log(`[gate] ${safe(msg)}${fmt(fields)}`),
  warn: (msg: string, fields?: Fields) => console.warn(`[gate] ${safe(msg)}${fmt(fields)}`),
  error: (msg: string, fields?: Fields) => console.error(`[gate] ${safe(msg)}${fmt(fields)}`),
}
