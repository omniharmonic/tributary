/**
 * Acting on behalf of another host (organisation roles, F29). The chosen host id lives
 * in sessionStorage for this tab; the api client sends it as `X-Acting-Host` on every
 * request and the server acts as that host within the caller's role. Components
 * subscribe through a window event so a switch re-renders everything at once.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'tb.acting'
const EVENT = 'tb:acting'

export function actingHostId(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setActingHost(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(KEY, id)
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: acting is a convenience, never a requirement */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** The acting host id, live. */
export function useActingHostId(): string | null {
  return useSyncExternalStore(subscribe, actingHostId, () => null)
}
