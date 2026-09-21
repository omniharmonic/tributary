/**
 * Server entry. Migrate, start HTTP, start the jobs.
 * `TRIBUTARY_NO_JOBS=1` runs HTTP only (sync runs inline when triggered).
 */
import { serve } from '@hono/node-server'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config, redactedConfig } from './config.js'
import { closeDb } from './db/index.js'
import { runMigrations } from './db/migrate.js'
import { createApp } from './http/app.js'
import { startJobs, stopJobs } from './jobs/index.js'
import { log } from './lib/logging.js'
import { resetDevMailSink } from './lib/mail.js'

export async function main(): Promise<{ close: () => Promise<void> }> {
  const c = config()
  log.info('starting tributary', redactedConfig(c))
  await resetDevMailSink()
  await runMigrations()
  const app = createApp()
  const server = serve({ fetch: app.fetch, port: c.TRIBUTARY_PORT })
  log.info('http listening', { port: c.TRIBUTARY_PORT })
  if (!c.TRIBUTARY_NO_JOBS) await startJobs()
  return {
    close: async () => {
      await stopJobs()
      server.close()
      await closeDb()
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { close } = await main()
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info('shutting down')
      void close().then(() => process.exit(0))
    })
  }
}
