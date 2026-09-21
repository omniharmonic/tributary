/**
 * Boot: migrate, serve, start retention. Env:
 *   GATE_PORT            default 4200
 *   DATABASE_URL         Postgres; the Gate uses schema `gate` (own role in production)
 *   GATE_SERVICE_SECRET  shared with Tributary and the discovery site; 32+ bytes
 *   GATE_BLOB_DIR        where permissioned image bytes live (default ./data/gate-blobs)
 *   GATE_PUBLIC_URL      the base signed blob URLs are built on (default http://localhost:<port>)
 */
import { serve } from '@hono/node-server'
import pg from 'pg'
import { createGateApp, runRetention } from './app.js'
import { FileBlobStorage } from './blobs.js'
import { describeError, log } from './logging.js'
import { migrate } from './migrate.js'

export async function main(): Promise<{ close: () => Promise<void> }> {
  const port = Number(process.env.GATE_PORT ?? 4200)
  const secret = process.env.GATE_SERVICE_SECRET ?? ''
  if (secret.length < 32) throw new Error('GATE_SERVICE_SECRET must be at least 32 characters')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/tributary', max: 10 })
  await migrate(pool)
  const { app } = createGateApp({
    pool,
    serviceSecret: secret,
    blobs: new FileBlobStorage(process.env.GATE_BLOB_DIR ?? './data/gate-blobs'),
    publicUrl: process.env.GATE_PUBLIC_URL ?? `http://localhost:${port}`,
  })
  const server = serve({ fetch: app.fetch, port })
  log.info('gate listening', { port })
  const retention = setInterval(() => {
    runRetention(pool)
      .then((r) => {
        if (r.invites + r.requests + r.audit > 0) log.info('retention', r)
      })
      .catch((err) => log.warn('retention failed', { detail: describeError(err) }))
  }, 3_600_000)
  return {
    close: async () => {
      clearInterval(retention)
      server.close()
      await pool.end()
    },
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))
if (isMain) {
  const { close } = await main()
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void close().then(() => process.exit(0))
    })
  }
}
