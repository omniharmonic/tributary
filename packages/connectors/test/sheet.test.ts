import { describe, expect, it } from 'vitest'
import { csvUrlFor, parseSheetUrl, sheetConnector } from '../src/sheet/index.js'
import type { FetchCtx } from '../src/sdk.js'

const CSV = `Title,Date,Start Time,Venue,Link
Repair Cafe,10/4/2026,10:00 AM,Boulder Public Library,https://x.org/repair
Seed Swap,10/11/2026,1:00 PM,Growing Gardens,https://x.org/seed
`

function ctx(body: string, status = 200): FetchCtx {
  const http = {
    get: async () => ({ url: 'x', status, headers: {}, body: Buffer.from(body), text: () => body, contentType: 'text/csv', notModified: false }),
    head: async () => { throw new Error('no') },
    getPage: async () => { throw new Error('no') },
  }
  return { http: http as never, secrets: {}, log: { info() {}, warn() {} }, window: { from: new Date('2026-09-20'), to: new Date('2026-12-20') }, defaultTz: 'America/Denver' }
}

describe('sheet connector', () => {
  it('recognises sheet links and builds export urls', () => {
    const p = parseSheetUrl(new URL('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=123'))
    expect(p).toEqual({ sheetId: '1AbCdEfGhIjKlMnOp', gid: '123' })
    expect(csvUrlFor('1AbCdEfGhIjKlMnOp', '123')).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=123')
    expect(parseSheetUrl(new URL('https://example.org/x'))).toBeNull()
  })
  it('configures with a guessed mapping and fetches rows as events', async () => {
    const c = ctx(CSV)
    const cfg = await sheetConnector.configure({ type: 'sheet', confidence: 1, platform: 'sheet', hint: { sheetId: '1AbCdEfGhIjKlMnOp' } }, c)
    expect(cfg.mapping?.name).toBe('Title')
    const res = await sheetConnector.fetch(cfg, null, c)
    expect(res.complete).toBe(true)
    expect(res.events.map((e) => e.name)).toEqual(['Repair Cafe', 'Seed Swap'])
    expect(res.events[0]!.start).toBe('2026-10-04T10:00:00.000-06:00')
    expect(sheetConnector.fingerprint(cfg)).toBe('sheet:1AbCdEfGhIjKlMnOp')
  })
  it('reports an unshared sheet plainly', async () => {
    await expect(sheetConnector.configure({ type: 'sheet', confidence: 1, platform: 'sheet', hint: { sheetId: 'x'.repeat(12) } }, ctx('', 403))).rejects.toMatchObject({ code: 'Forbidden' })
  })
})
