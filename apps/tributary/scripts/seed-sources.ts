/**
 * Seed the directory with public calendars, as a named curator.
 *
 *   pnpm --filter @tributary/tributary seed-sources -- --host curator --file seeds.json
 *   pnpm --filter @tributary/tributary seed-sources -- --host curator --url https://…
 *   pnpm --filter @tributary/tributary seed-sources -- --list
 *
 * This is the curator path of PRD §7 Door C, with one difference: the events are
 * published under a real account on our own PDS rather than left as bare pointers,
 * because a card that cannot be subscribed to is not much use to a neighbour. Every
 * source added this way is marked `claimed: false`, so the cards carry the "Listed"
 * badge and a "Is this yours? Claim it" path, and the host it publishes under is the
 * directory's own curator identity, never an organisation's name.
 *
 * A seed file is `[{ "input": "<url>", "label": "<optional>", "note": "<optional>" }]`,
 * or the shorthand `["<url>", …]`.
 */
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../src/db/index.js'
import { host, source } from '../src/db/schema.js'
import { config } from '../src/config.js'
import { provisionCustodialAccount, randomPassword, newToken } from '@tributary/identity'
import { pdsConfig } from '../src/lib/custody.js'
import { id } from '../src/lib/ids.js'
import { storeAppPassword } from '../src/lib/hosts.js'
import { inboundAddress } from '../src/db/schema.js'
import { detect } from '../src/lib/preview.js'
import { connectSource, SourceError } from '../src/lib/sources.js'
import { runSource } from '../src/pipeline/run.js'
import { recordAudit } from '../src/lib/audit.js'

interface Seed {
  input: string
  label?: string
  note?: string
}

function args(): { hostLabel: string; file?: string; urls: string[]; list: boolean; dry: boolean; sync: boolean } {
  const a = process.argv.slice(2)
  const get = (flag: string) => {
    const i = a.indexOf(flag)
    return i >= 0 ? a[i + 1] : undefined
  }
  return {
    hostLabel: get('--host') ?? 'curator',
    file: get('--file'),
    urls: a.filter((x, i) => a[i - 1] === '--url'),
    list: a.includes('--list'),
    dry: a.includes('--dry-run'),
    sync: !a.includes('--no-sync'),
  }
}

/** The curator identity: a real account on our PDS, created once. */
async function ensureCuratorHost(label: string): Promise<typeof host.$inferSelect> {
  const c = config()
  const handle = `${label}.${c.handleDomain}`
  const existing = await getDb().select().from(host).where(eq(host.handle, handle)).limit(1)
  if (existing[0]) return existing[0]

  const displayName = `${c.BRAND_NAME}`
  const email = `curator+${label}@${new URL(c.WEB_PUBLIC_URL).hostname}`
  const account = await provisionCustodialAccount(pdsConfig(), { email, handle }, randomPassword)
  const hostId = id('host')
  const [row] = await getDb()
    .insert(host)
    .values({
      id: hostId,
      did: account.did,
      handle: account.handle,
      door: 'listed',
      email,
      emailVerifiedAt: new Date(),
      displayName,
      region: c.REGION_SLUG,
      provenanceLevel: 'listed',
      pdsUrl: c.PDS_URL,
    })
    .returning()
  await storeAppPassword(hostId, account.did, account.appPassword)
  await getDb().insert(inboundAddress).values({ hostId, emailToken: newToken(12), webhookToken: newToken(16), webhookSecret: newToken(24) }).onConflictDoNothing()
  await recordAudit({ hostId, actor: account.did, action: 'host.created', detail: { door: 'listed', curator: true } })
  console.log(`curator account: ${account.handle}  ${account.did}`)
  return row!
}

async function main(): Promise<void> {
  const opts = args()

  if (opts.list) {
    const rows = await getDb().select().from(source)
    for (const s of rows) {
      console.log([s.status.padEnd(8), s.type.padEnd(13), s.claimed ? 'claimed  ' : 'listed   ', s.label].join(' '))
    }
    console.log(`${rows.length} sources`)
    await closeDb()
    return
  }

  const seeds: Seed[] = []
  if (opts.file) {
    const raw = JSON.parse(readFileSync(opts.file, 'utf8')) as Array<string | Seed>
    for (const s of raw) seeds.push(typeof s === 'string' ? { input: s } : s)
  }
  for (const u of opts.urls) seeds.push({ input: u })
  if (seeds.length === 0) {
    console.error('nothing to seed: pass --file seeds.json or --url <url>')
    process.exit(1)
  }

  const curator = await ensureCuratorHost(opts.hostLabel)
  let added = 0
  let skipped = 0
  let failed = 0

  for (const seed of seeds) {
    const line = seed.label ? `${seed.label} <${seed.input}>` : seed.input
    try {
      const matches = await detect({ text: seed.input })
      const m = matches.find((x) => x.confidence > 0 && x.type !== 'extract')
      if (!m) {
        console.log(`SKIP  ${line}\n      ${matches[0]?.note ?? 'nothing importable found there'}`)
        skipped++
        continue
      }
      if (opts.dry) {
        console.log(`DRY   ${line}\n      → ${m.type} (${m.platform}) ${m.label}`)
        continue
      }
      const { source: row, created } = await connectSource(curator, { type: m.type, platform: m.platform, match: m, defaultVisibility: 'public', label: seed.label })
      if (!created) {
        console.log(`HAVE  ${row.label}`)
        skipped++
        continue
      }
      // A curator's listing is not a claim: the badge stays "Listed" until the host proves it.
      await getDb().update(source).set({ claimed: false }).where(eq(source.id, row.id))
      added++
      if (opts.sync) {
        const r = await runSource(row.id, { trigger: 'first' })
        console.log(`ADD   ${row.label}\n      ${r.ok ? `${r.published} published, ${r.held} held, ${r.failed} failed` : `sync failed: ${r.error?.message}`}`)
      } else {
        console.log(`ADD   ${row.label}`)
      }
    } catch (err) {
      failed++
      const msg = err instanceof SourceError ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'
      console.log(`FAIL  ${line}\n      ${msg}`)
    }
  }

  console.log(`\n${added} added, ${skipped} skipped, ${failed} failed`)
  await closeDb()
}

await main()
