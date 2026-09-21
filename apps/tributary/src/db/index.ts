import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { config } from '../config.js'
import { schema } from './schema.js'

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool }

let pool: pg.Pool | undefined
let db: Db | undefined

export function getPool(connectionString = config().DATABASE_URL): pg.Pool {
  return (pool ??= new pg.Pool({ connectionString, max: 10 }))
}

export function getDb(): Db {
  return (db ??= drizzle(getPool(), { schema }) as Db)
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
  db = undefined
}

export { schema }
