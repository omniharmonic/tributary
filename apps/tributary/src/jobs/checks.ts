/**
 * Nightly and daily checks (architecture §8.4, §15, §16, PRD F20, F27):
 *   relay monitor   the relay's view of our PDS: status and account count, alert at 70
 *   privacy audit   no published event carries an email, a phone number or attendee data
 *   leak check      no permissioned event has a public record; gated teasers carry no
 *                   exact address or join link on the PDS
 * Results are kept in memory for /api/public/stats and logged without identifiers.
 */
import { and, eq, gt, inArray, isNotNull, or } from 'drizzle-orm'
import { findContacts, isConferenceUrl, type NormalizedEvent } from '@tributary/event-model'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { host, sourceEvent } from '../db/schema.js'
import { describeError, log } from '../lib/logging.js'

export interface CheckReport {
  at: string
  ok: boolean
  detail: Record<string, number | string | boolean>
}

export const lastReports: Record<'relay' | 'privacy' | 'leak', CheckReport | null> = { relay: null, privacy: null, leak: null }

export const RELAY_ACCOUNT_ALERT = 70

export async function relayMonitor(relayHost = 'https://bsky.network'): Promise<CheckReport> {
  const pdsHost = new URL(config().PDS_URL).hostname
  const report: CheckReport = { at: new Date().toISOString(), ok: false, detail: {} }
  try {
    const res = await fetch(`${relayHost}/xrpc/com.atproto.sync.getHostStatus?hostname=${encodeURIComponent(pdsHost)}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      report.detail = { http: res.status }
      log.warn('relay monitor: host status not available', { status: res.status })
    } else {
      const j = (await res.json()) as { status?: string; accountCount?: number; seq?: number }
      report.detail = { status: j.status ?? 'unknown', accountCount: j.accountCount ?? -1, seq: j.seq ?? -1 }
      report.ok = j.status === 'active'
      if ((j.accountCount ?? 0) >= RELAY_ACCOUNT_ALERT) log.error('relay monitor: account count near the default cap; ask Bluesky for a raise', { accountCount: j.accountCount ?? 0 })
      if (!report.ok) log.error('relay monitor: PDS is not active on the relay', { status: j.status ?? 'unknown' })
      else log.info('relay monitor ok', { accountCount: j.accountCount ?? 0 })
    }
  } catch (err) {
    log.warn('relay monitor failed', { detail: describeError(err) })
    report.detail = { error: describeError(err) }
  }
  lastReports.relay = report
  return report
}

/** F20: nothing we published names a person. */
export async function privacyAudit(): Promise<CheckReport> {
  const rows = await getDb().select({ id: sourceEvent.id, normalized: sourceEvent.normalized }).from(sourceEvent).where(and(inArray(sourceEvent.state, ['live', 'cancelled']), gt(sourceEvent.startsAt, new Date(Date.now() - 86_400_000))))
  let violations = 0
  for (const r of rows) {
    const n = r.normalized as unknown as NormalizedEvent
    const text = [n.name, n.descriptionMd, ...n.locations.map((l) => `${l.name ?? ''} ${l.street ?? ''}`)].join('\n')
    const c = findContacts(text)
    if (c.emails.length || c.phones.length || /\bATTENDEE\b/.test(text)) {
      violations++
      log.warn('privacy audit: a published event carries contact data', { event: r.id })
    }
  }
  const report: CheckReport = { at: new Date().toISOString(), ok: violations === 0, detail: { checked: rows.length, violations } }
  if (violations) log.error('PRIVACY AUDIT FAILED', { violations })
  else log.info('privacy audit ok', { checked: rows.length })
  lastReports.privacy = report
  return report
}

/** F27: permissioned events are absent from every public surface. */
export async function leakCheck(): Promise<CheckReport> {
  const db = getDb()
  const leaked = await db
    .select({ id: sourceEvent.id })
    .from(sourceEvent)
    .where(and(inArray(sourceEvent.visibility, ['members', 'invite', 'held']), or(isNotNull(sourceEvent.atUri), isNotNull(sourceEvent.teaserAtUri))))
  for (const r of leaked) log.error('LEAK: a permissioned event has a public record', { event: r.id })
  // Gated teasers on the PDS: no street, no join link.
  const gated = await db
    .select({ id: sourceEvent.id, atUri: sourceEvent.atUri, pdsUrl: host.pdsUrl, did: host.did })
    .from(sourceEvent)
    .innerJoin(host, eq(host.id, sourceEvent.hostId))
    .where(and(eq(sourceEvent.visibility, 'gated'), eq(sourceEvent.state, 'live'), isNotNull(sourceEvent.atUri), gt(sourceEvent.startsAt, new Date())))
    .limit(500)
  let teaserLeaks = 0
  for (const g of gated) {
    const rkey = g.atUri!.split('/').pop()!
    try {
      const res = await fetch(`${g.pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(g.did)}&collection=community.lexicon.calendar.event&rkey=${rkey}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const rec = (await res.json()) as { value: { locations?: Array<{ street?: string }>; uris?: Array<{ uri: string }>; description?: string } }
      const hasStreet = (rec.value.locations ?? []).some((l) => !!l.street)
      const hasJoin = (rec.value.uris ?? []).some((u) => isConferenceUrl(u.uri)) || /https?:\/\/\S*(zoom\.us|meet\.google\.com|teams\.microsoft\.com)/i.test(rec.value.description ?? '')
      if (hasStreet || hasJoin) {
        teaserLeaks++
        log.error('LEAK: a gated teaser carries gated fields', { event: g.id })
      }
    } catch (err) {
      log.warn('leak check: could not read a teaser', { detail: describeError(err) })
    }
  }
  const report: CheckReport = { at: new Date().toISOString(), ok: leaked.length === 0 && teaserLeaks === 0, detail: { permissionedWithPublicRecord: leaked.length, gatedChecked: gated.length, teaserLeaks } }
  if (report.ok) log.info('leak check ok', { gatedChecked: gated.length })
  lastReports.leak = report
  return report
}
