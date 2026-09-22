/** Run the nightly checks now: `pnpm --filter @tributary/tributary checks` (or in the container). */
import { closeDb } from '../src/db/index.js'
import { leakCheck, privacyAudit, relayMonitor } from '../src/jobs/checks.js'

const relay = await relayMonitor()
const privacy = await privacyAudit()
const leak = await leakCheck()
console.log(JSON.stringify({ relay, privacy, leak }, null, 2))
await closeDb()
process.exit(relay.ok && privacy.ok && leak.ok ? 0 : 1)
