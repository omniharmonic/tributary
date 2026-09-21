import { describe, expect, it } from 'vitest'
import { normalize } from '@tributary/event-model'
import { CasError, placeholderImage, prepareImage, publishEvent, type RepoWriter } from '../src/index.js'

class FakeWriter implements RepoWriter {
  did = 'did:plc:test'
  records = new Map<string, { cid: string; value: Record<string, unknown> }>()
  blobs: Array<{ mime: string; size: number }> = []
  puts = 0
  failNextCas = false
  async uploadBlob(bytes: Uint8Array, mime: string) {
    this.blobs.push({ mime, size: bytes.length })
    return { $type: 'blob' as const, ref: { $link: `bafy${this.blobs.length}` }, mimeType: mime, size: bytes.length }
  }
  async putRecord(collection: string, rkey: string, record: unknown, swap?: string | null) {
    this.puts++
    const cur = this.records.get(rkey)
    if (this.failNextCas) {
      this.failNextCas = false
      throw new CasError()
    }
    if (swap !== undefined && swap !== null && cur?.cid !== swap) throw new CasError()
    const cid = `cid${this.puts}`
    this.records.set(rkey, { cid, value: record as Record<string, unknown> })
    return { uri: `at://${this.did}/${collection}/${rkey}`, cid }
  }
  async deleteRecord(_c: string, rkey: string) {
    this.records.delete(rkey)
  }
  async getRecord(_c: string, rkey: string) {
    const r = this.records.get(rkey)
    return r ? { uri: 'x', cid: r.cid, value: r.value } : null
  }
  async listRecords() {
    return { records: [] }
  }
}

const ev = normalize(
  { externalId: 'e1', name: 'Test', start: '2026-10-04T10:00:00', tz: 'America/Denver', location: 'Somewhere, Boulder, CO', url: 'https://example.org/e1' },
  { sourceId: 's', sourceType: 'ics', platform: 'web', defaultTz: 'America/Denver', fallbackUrl: 'https://example.org' },
)

describe('images', () => {
  it('re-encodes to jpeg, strips metadata, caps size', async () => {
    const img = await placeholderImage('Dairy Arts')
    expect(img.mime).toBe('image/jpeg')
    expect(img.width).toBe(1200)
    expect(img.bytes.length).toBeLessThan(900 * 1024)
    const again = await prepareImage(img.bytes)
    expect(again.sourceHash).toBe(img.hash)
  })
})

describe('publishEvent', () => {
  it('uploads the blob once and writes a validated record', async () => {
    const w = new FakeWriter()
    const img = await placeholderImage('X')
    const r1 = await publishEvent(w, { event: ev, rkey: 'k1', createdWith: 'https://t', image: img })
    expect(w.blobs).toHaveLength(1)
    expect((r1.record.media as unknown[]).length).toBe(1)
    const r2 = await publishEvent(w, { event: { ...ev, name: 'Test 2' }, rkey: 'k1', createdWith: 'https://t', image: img, existing: { cid: r1.cid, blob: r1.blob, imageHash: r1.imageHash, createdAt: r1.record.createdAt } })
    expect(w.blobs).toHaveLength(1)
    expect(r2.record.createdAt).toBe(r1.record.createdAt)
    expect(r2.casRetried).toBe(false)
  })
  it('retries once on CAS failure', async () => {
    const w = new FakeWriter()
    const r1 = await publishEvent(w, { event: ev, rkey: 'k1', createdWith: 'https://t' })
    w.failNextCas = true
    const r2 = await publishEvent(w, { event: ev, rkey: 'k1', createdWith: 'https://t', existing: { cid: r1.cid } })
    expect(r2.casRetried).toBe(true)
  })
})
