/**
 * Permissioned levels through the Gate (architecture §9.2, Phase A). Every space has
 * the alpha's exact address shape so nothing changes at migration:
 *   gated   → at://{host}/coop.lexicon.space.event.detail/{rkey}   one `coop.lexicon.event.detail`
 *   members → at://{group}/coop.lexicon.space.calendar/{members|stewards}  full event records
 *   invite  → at://{host}/coop.lexicon.space.event.invite/{skey}   full event record + config
 */
import { GATED_DETAIL_READ, INVITE_READ, MEMBERS_READ, MEMBERS_WRITE } from '@tributary/policy'
import { RemoteSpaceStore, spaceUri, type Did } from '@tributary/spaces-shim'
import { buildEventRecord, type NormalizedEvent } from '@tributary/event-model'
import { config } from '../config.js'

export const SPACE_TYPES = {
  detail: 'coop.lexicon.space.event.detail',
  invite: 'coop.lexicon.space.event.invite',
  calendar: 'coop.lexicon.space.calendar',
} as const
export const COLLECTIONS = {
  detail: 'coop.lexicon.event.detail',
  event: 'community.lexicon.calendar.event',
  config: 'coop.lexicon.event.config',
} as const

let store: RemoteSpaceStore | undefined
export function gate(): RemoteSpaceStore {
  const c = config()
  return (store ??= new RemoteSpaceStore({ baseUrl: c.GATE_URL, serviceSecret: c.GATE_SERVICE_SECRET }))
}

async function ensureSpace(authority: Did, spaceType: string, skey: string, readPolicy: Parameters<RemoteSpaceStore['createSpace']>[0]['readPolicy'], writePolicy: Parameters<RemoteSpaceStore['createSpace']>[0]['writePolicy']): Promise<string> {
  const uri = spaceUri(authority, spaceType, skey)
  const existing = await gate().getSpace(uri, authority)
  if (!existing) await gate().createSpace({ authority, spaceType, skey, readPolicy, writePolicy })
  return uri
}

/** The detail record for a gated event: exactly the fields the public teaser withholds. */
export function detailRecord(e: NormalizedEvent): Record<string, unknown> {
  const l = e.locations[0]
  const out: Record<string, unknown> = { $type: COLLECTIONS.detail }
  if (l && (l.street || l.name)) {
    out.exactLocation = { $type: 'community.lexicon.location.address', name: l.name, street: l.street, locality: l.locality, region: l.region, postalCode: l.postalCode, country: l.country ?? config().REGION_COUNTRY }
  }
  if (l?.lat !== undefined && l.lon !== undefined) out.exactPin = { $type: 'community.lexicon.location.geo', latitude: String(l.lat), longitude: String(l.lon) }
  if (e.joinUrl) out.joinUrl = e.joinUrl
  return out
}

export interface SpaceWrite {
  spaceUri: string
  recordUri: string
}

/** Write (or rewrite) the permissioned part of an event. Returns where it lives. */
export async function writePermissioned(hostDid: Did, e: NormalizedEvent, rkey: string, existing?: { spaceUri: string | null; spaceRecordUri: string | null }): Promise<SpaceWrite> {
  const level = e.visibility
  if (level === 'gated') {
    const uri = await ensureSpace(hostDid, SPACE_TYPES.detail, rkey, GATED_DETAIL_READ, MEMBERS_WRITE)
    const rec = await gate().putRecord(uri, hostDid, COLLECTIONS.detail, detailRecord(e), 'self')
    return { spaceUri: uri, recordUri: rec.uri }
  }
  if (level === 'members') {
    const group = e.audience?.group as Did | undefined
    if (!group) throw new Error('members event without a group')
    const skey = (e.audience?.minRole ?? 10) >= 20 ? 'stewards' : 'members'
    const uri = await ensureSpace(group, SPACE_TYPES.calendar, skey, MEMBERS_READ(e.audience?.minRole ?? 10), MEMBERS_WRITE)
    const rec = await gate().putRecord(uri, hostDid, COLLECTIONS.event, buildEventRecord(e, { createdWith: config().createdWith, defaultCountry: config().REGION_COUNTRY, teaser: false }), rkey)
    return { spaceUri: uri, recordUri: rec.uri }
  }
  if (level === 'invite') {
    const skey = e.audience?.inviteListId ?? rkey
    const uri = await ensureSpace(hostDid, SPACE_TYPES.invite, skey, INVITE_READ, MEMBERS_WRITE)
    const rec = await gate().putRecord(uri, hostDid, COLLECTIONS.event, buildEventRecord(e, { createdWith: config().createdWith, defaultCountry: config().REGION_COUNTRY, teaser: false }), rkey)
    if (e.audience?.approval) await gate().putRecord(uri, hostDid, COLLECTIONS.config, { $type: COLLECTIONS.config, attendance: e.audience.approval }, rkey)
    return { spaceUri: uri, recordUri: rec.uri }
  }
  throw new Error(`not a permissioned level: ${level}`)
}

export async function deletePermissioned(hostDid: Did, existing: { spaceUri: string | null; spaceRecordUri: string | null }): Promise<void> {
  if (!existing.spaceUri || !existing.spaceRecordUri) return
  try {
    await gate().deleteRecord(existing.spaceUri, hostDid, existing.spaceRecordUri)
  } catch (err) {
    // A record that is already gone is fine; anything else must surface so the ledger keeps the pointer.
    if (!(err instanceof Error && err.name === 'NotFoundError')) throw err
  }
}
