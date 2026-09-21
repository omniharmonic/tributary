import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { closeDb, getDb } from './index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_FOLDER = path.resolve(here, '../../drizzle')

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: MIGRATIONS_FOLDER })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runMigrations()
  console.log('migrations applied')
  await closeDb()
}
