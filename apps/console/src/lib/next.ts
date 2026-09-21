/**
 * Where to go after signing in. Only a same-origin path is ever honoured: an open
 * redirect here would be a session-fixation gift, since the response that follows
 * sets the session cookie.
 */
const KEY = 'tb.next'

export function safeNext(next: string | null | undefined): string | null {
  if (!next || typeof next !== 'string') return null
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  try {
    const u = new URL(next, 'https://x.invalid')
    if (u.origin !== 'https://x.invalid') return null
    return u.pathname + u.search
  } catch {
    return null
  }
}

/** Remember a destination across the magic-link round trip (same browser, same tab or not). */
export function rememberNext(next: string | null | undefined): void {
  const safe = safeNext(next)
  try {
    if (safe) sessionStorage.setItem(KEY, safe)
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the default landing page is fine */
  }
}

export function takeNext(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return safeNext(v)
  } catch {
    return null
  }
}
