/**
 * The Gate's claims provider for the policy engine (architecture §9.3 item 2).
 * Membership (`roleOf`) is the store's own table; this answers the rest from the
 * Gate's tables. `connectionOf` is false in Phase A: no social graph is read.
 */
import type pg from 'pg'
import type { ClaimsProvider } from '@tributary/policy'

export const RSVP_COLLECTION = 'community.lexicon.calendar.rsvp'
const GOING = new Set(['community.lexicon.calendar.rsvp#going', 'going'])

export class PostgresClaims implements Omit<ClaimsProvider, 'roleOf'> {
  constructor(private readonly pool: pg.Pool) {}

  async isInvited(viewer: string, spaceUri: string): Promise<boolean> {
    const r = await this.pool.query(
      `select 1 from gate.invite_redemption r join gate.invite i on i.id = r.invite_id
       where r.space_uri = $1 and r.did = $2 and i.revoked_at is null limit 1`,
      [spaceUri, viewer],
    )
    return (r.rowCount ?? 0) > 0
  }

  async isSharedWith(viewer: string, spaceUri: string): Promise<boolean> {
    const r = await this.pool.query('select 1 from gate.share where space_uri = $1 and did = $2 limit 1', [spaceUri, viewer])
    return (r.rowCount ?? 0) > 0
  }

  /** An approved access request, or the viewer's own "going" RSVP in the space. */
  async isConfirmedFor(viewer: string, spaceUri: string): Promise<boolean> {
    const approved = await this.pool.query(`select 1 from gate.access_request where space_uri = $1 and did = $2 and state = 'approved' limit 1`, [spaceUri, viewer])
    if ((approved.rowCount ?? 0) > 0) return true
    const rsvp = await this.pool.query<{ value: { status?: string } }>(
      'select value from gate.space_record where space_uri = $1 and author = $2 and collection = $3',
      [spaceUri, viewer, RSVP_COLLECTION],
    )
    return rsvp.rows.some((row) => typeof row.value?.status === 'string' && GOING.has(row.value.status))
  }

  async isConnectionOf(): Promise<boolean> {
    return false
  }
}
