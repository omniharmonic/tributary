/** Rebuild the search index from the ledger: `pnpm --filter @tributary/tributary reindex`. */
import { closeDb } from '../src/db/index.js'
import { reindexAll } from '../src/search/index.js'

console.log(JSON.stringify(await reindexAll(), null, 2))
await closeDb()
