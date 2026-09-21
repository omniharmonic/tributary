import { getDb } from '../db/index.js'
import { audit } from '../db/schema.js'
import { id } from './ids.js'

/** Who did what, when. Never a record body, never an email. */
export async function recordAudit(entry: { hostId?: string | null; actor?: string | null; action: string; subject?: string | null; detail?: Record<string, unknown> | null }): Promise<void> {
  await getDb().insert(audit).values({ id: id('au'), hostId: entry.hostId ?? null, actor: entry.actor ?? null, action: entry.action, subject: entry.subject ?? null, detail: entry.detail ?? null })
}
