/**
 * Remove a seeded source and unpublish everything it wrote.
 *
 *   pnpm --filter @tributary/tributary remove-source -- --label "CU Boulder" --dry-run
 *   pnpm --filter @tributary/tributary remove-source -- --label "CU Boulder"
 *
 * The counterpart to `seed-sources.ts`. A curator who lists a calendar has to be able to
 * unlist it, and that has to mean the records leave the repo too: deleting the ledger row
 * on its own would strand every record in the PDS, still on the firehose, with nothing
 * left that knows how to reach them.
 *
 * This mirrors `DELETE /api/sources/:id` rather than reimplementing it, so a record that
 * refuses to delete is logged and the rest still go, and the ledger row is only dropped
 * once the repo has been walked.
 */
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../src/db/index.js'
import { source, sourceEvent } from '../src/db/schema.js'
import { unpublishEvent } from '@tributary/publisher'
import { getHost, writerFor } from '../src/lib/hosts.js'
import { deletePermissioned } from '../src/pipeline/gate.js'
import { deindexEvent } from '../src/search/index.js'
import { recordAudit } from '../src/lib/audit.js'
import { describeError, log } from '../src/lib/logging.js'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const label = arg('--label')
  const id = arg('--id')
  const dry = process.argv.includes('--dry-run')
  if (!label && !id) {
    console.error('name the source: --label "Some Calendar" or --id src_...')
    process.exit(1)
  }

  const rows = await getDb().select().from(source)
  const matches = rows.filter((s) => (id ? s.id === id : s.label === label))
  if (matches.length === 0) {
    console.error(`no source matches ${id ?? label}`)
    process.exit(1)
  }
  if (matches.length > 1) {
    console.error(`${matches.length} sources share that label; use --id:`)
    for (const s of matches) console.error(`  ${s.id}  ${s.label}`)
    process.exit(1)
  }

  const s = matches[0]!
  const events = await getDb().select().from(sourceEvent).where(eq(sourceEvent.sourceId, s.id))
  const published = events.filter((e) => e.atUri && e.rkey).length
  console.log(`${s.label} (${s.type}, ${s.status})\n  ${events.length} ledger rows, ${published} published records`)
  if (dry) {
    console.log('  --dry-run: nothing written')
    await closeDb()
    return
  }

  const host = await getHost(s.hostId)
  if (!host) throw new Error('the source has no host')
  let writer: Awaited<ReturnType<typeof writerFor>> | undefined
  try {
    writer = await writerFor(host)
  } catch (err) {
    // Without a writer the records cannot be withdrawn, and dropping the ledger row would
    // strand them. Refuse rather than half-do it.
    console.error(`  cannot reach the repo for this host: ${describeError(err)}`)
    process.exit(1)
  }

  let removed = 0
  let failed = 0
  for (const e of events) {
    try {
      if (e.atUri && e.rkey) await unpublishEvent(writer, e.rkey)
      if (e.spaceUri) await deletePermissioned(host.did as `did:${string}`, e)
      await deindexEvent(e.id)
      removed++
      if (removed % 25 === 0) console.log(`  ${removed}/${events.length}`)
    } catch (err) {
      failed++
      log.warn('remove-source: a record could not be withdrawn', { detail: describeError(err) })
    }
  }

  await getDb().delete(source).where(eq(source.id, s.id))
  await recordAudit({ hostId: host.id, actor: host.did, action: 'source.removed', subject: s.id, detail: { removed, failed, via: 'script' } })
  console.log(`\nwithdrew ${removed} records, ${failed} failed; the source is gone`)
  await closeDb()
}

await main()
