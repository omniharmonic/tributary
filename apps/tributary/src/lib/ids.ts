import { randomBytes } from 'node:crypto'

/** Prefixed opaque ids: `src_…`, `ev_…`, `pv_…`. */
export function id(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`
}
