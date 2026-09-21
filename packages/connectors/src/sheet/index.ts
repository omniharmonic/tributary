/**
 * Google Sheets (P6): a sheet shared "anyone with the link" polled as CSV. The column
 * mapping is guessed from the header row and can be fixed in the preview; rows are
 * identified by an id column when there is one, else by (file, name, start).
 * A template sheet (name, date, start time, end time, venue, details, link, cost) is
 * what we hand groups that plan in spreadsheets.
 */
import { createHash } from 'node:crypto'
import { guessMapping, parseCsv, rowsToRawEvents, type CsvMapping } from '../csv.js'
import { ConnectorError, HOUR, type Connector, type DetectInput, type DetectMatch } from '../sdk.js'

export interface SheetConfig {
  sheetId: string
  /** Sheet tab id (gid), when the link named one. */
  gid?: string
  csvUrl: string
  mapping?: CsvMapping
  tz?: string
  title?: string
}

const SHEET_RE = /^\/spreadsheets\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/

export function parseSheetUrl(u: URL): { sheetId: string; gid?: string } | null {
  if (!/(^|\.)docs\.google\.com$/.test(u.hostname)) return null
  const m = SHEET_RE.exec(u.pathname)
  if (!m) return null
  const gid = u.searchParams.get('gid') ?? /gid=(\d+)/.exec(u.hash)?.[1] ?? undefined
  return { sheetId: m[1]!, gid: gid ?? undefined }
}

export function csvUrlFor(sheetId: string, gid?: string, published = false): string {
  if (published) return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?output=csv${gid ? `&gid=${gid}` : ''}`
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`
}

export const sheetConnector: Connector<SheetConfig, null> = {
  type: 'sheet',
  platform: 'sheet',
  capabilities: { live: 'poll', delta: false, explicitDeletes: false, images: 'none', requiresAuth: 'none' },
  defaultInterval: 30 * 60_000,
  async detect(input: DetectInput): Promise<DetectMatch | null> {
    if (!input.url) return null
    const p = parseSheetUrl(input.url)
    if (!p) return null
    return { type: 'sheet', confidence: 0.95, platform: 'sheet', hint: { sheetId: p.sheetId, gid: p.gid, published: input.url.pathname.includes('/d/e/') }, note: 'The sheet must be shared with "anyone with the link". We will ask you to match the columns.' }
  },
  async configure(input, ctx) {
    const h = ('hint' in input ? (input as DetectMatch).hint : input) as Partial<SheetConfig> & { published?: boolean }
    if (!h.sheetId) throw new ConnectorError('a sheet id is required', 'Unsupported', false)
    const csvUrl = csvUrlFor(String(h.sheetId), h.gid ? String(h.gid) : undefined, h.published === true)
    const res = await ctx.http.get(csvUrl, { headers: { accept: 'text/csv,*/*;q=0.5' }, maxBytes: 5 * 1024 * 1024 })
    if (res.status === 401 || res.status === 403 || (res.contentType?.includes('html') && /accounts\.google\.com/.test(res.url))) throw new ConnectorError('the sheet is not shared with anyone with the link', 'Forbidden', false)
    if (res.status !== 200) throw new ConnectorError(`sheet answered ${res.status}`, res.status === 404 ? 'NotFound' : 'Other', false)
    const parsed = parseCsv(res.text())
    return { sheetId: String(h.sheetId), gid: h.gid ? String(h.gid) : undefined, csvUrl, mapping: { ...guessMapping(parsed.headers), ...(h.mapping ?? {}) }, tz: h.tz, title: h.title }
  },
  async fetch(cfg, _cursor, ctx) {
    const res = await ctx.http.get(cfg.csvUrl, { headers: { accept: 'text/csv,*/*;q=0.5' }, maxBytes: 5 * 1024 * 1024, etag: ctx.etag, lastModified: ctx.lastModified })
    if (res.notModified) return { events: [], cursor: null, complete: false, notModified: true }
    if (res.status === 401 || res.status === 403) throw new ConnectorError('the sheet is no longer shared', 'Forbidden')
    if (res.status !== 200) throw new ConnectorError(`sheet answered ${res.status}`, res.status === 404 ? 'NotFound' : 'Other')
    const parsed = parseCsv(res.text())
    const mapping = { ...guessMapping(parsed.headers), ...(cfg.mapping ?? {}) }
    const out = rowsToRawEvents(parsed, mapping, cfg.tz ?? ctx.defaultTz, createHash('sha256').update(cfg.sheetId).digest('hex'))
    return { events: out.events, cursor: null, complete: true, etag: res.etag, lastModified: res.lastModified, meta: { title: cfg.title, url: `https://docs.google.com/spreadsheets/d/${cfg.sheetId}` } }
  },
  fingerprint: (cfg) => `sheet:${cfg.sheetId}${cfg.gid ? `#${cfg.gid}` : ''}`,
  label: (cfg) => cfg.title ? `Google Sheet: ${cfg.title}` : 'Google Sheet',
}

export { HOUR }
