import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MemoryBlobStorage, PostgresSpaceStore, migrateSpaceStore, signBlobUrl, verifyBlobSig } from '../src/index.js'
import { storeSuite } from './store-suite.js'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/tributary_test'
const pool = new pg.Pool({ connectionString: url, max: 4 })

beforeAll(async () => {
  await migrateSpaceStore(pool)
})
afterAll(async () => {
  await pool.end()
})

storeSuite('postgres', {
  make: async (claims) => {
    await pool.query('truncate gate.space cascade')
    return new PostgresSpaceStore(pool, { claims, blobs: new MemoryBlobStorage() })
  },
})

describe('blob url signing', () => {
  it('binds the url to viewer and expiry', () => {
    const url = signBlobUrl('http://gate', 'secret', 'abc', 'did:plc:v', 1_000_000)
    const u = new URL(url)
    expect(u.pathname).toBe('/blobs/abc')
    const exp = Number(u.searchParams.get('exp'))
    const sig = u.searchParams.get('sig')!
    expect(verifyBlobSig('secret', 'abc', 'did:plc:v', exp, sig, 1_000_000 + 1000)).toBe(true)
    expect(verifyBlobSig('secret', 'abc', 'did:plc:other', exp, sig, 1_000_000 + 1000)).toBe(false)
    expect(verifyBlobSig('secret', 'abc', 'did:plc:v', exp, sig, exp + 1)).toBe(false)
    expect(verifyBlobSig('wrong', 'abc', 'did:plc:v', exp, sig, 1_000_000)).toBe(false)
  })
})
