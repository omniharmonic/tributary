/**
 * `.ics` / CSV uploads (P5). A push-style source: the runtime parses the file once at
 * preview time and stores the raw events; `fetch` is never polled. The connector exists
 * for detection, labels and fingerprints.
 */
import { createHash } from 'node:crypto'
import type { Connector, DetectInput, DetectMatch } from '../sdk.js'

export interface UploadConfig {
  kind: 'ics' | 'csv'
  name: string
  /** sha256 of the file bytes: the fingerprint. */
  hash: string
  tz?: string
}

export const uploadConnector: Connector<UploadConfig, null> = {
  type: 'upload',
  platform: 'file',
  capabilities: { live: 'none', delta: false, explicitDeletes: false, images: 'none', requiresAuth: 'none' },
  defaultInterval: 0,
  async detect(input: DetectInput): Promise<DetectMatch | null> {
    const f = input.file
    if (!f) return null
    const name = f.name.toLowerCase()
    const head = f.bytes.subarray(0, 64).toString('utf8')
    if (name.endsWith('.ics') || f.mime === 'text/calendar' || head.startsWith('BEGIN:VCALENDAR')) {
      return { type: 'upload', confidence: 0.99, platform: 'file', hint: { kind: 'ics', name: f.name, hash: sha(f.bytes) } }
    }
    if (name.endsWith('.csv') || f.mime === 'text/csv') {
      return { type: 'upload', confidence: 0.95, platform: 'file', hint: { kind: 'csv', name: f.name, hash: sha(f.bytes) }, note: 'We will ask you to match the columns.' }
    }
    return null
  },
  async configure(input) {
    const h = ('hint' in input ? (input as DetectMatch).hint : input) as Partial<UploadConfig>
    if (h.kind !== 'ics' && h.kind !== 'csv') throw new Error('upload kind must be ics or csv')
    return { kind: h.kind, name: String(h.name ?? 'upload'), hash: String(h.hash ?? ''), tz: h.tz }
  },
  async fetch() {
    // Push source: the runtime serves stored raw events. Reaching here is a runtime bug.
    return { events: [], cursor: null, complete: false }
  },
  fingerprint: (cfg) => `upload:${cfg.hash}`,
  label: (cfg) => `${cfg.kind === 'ics' ? 'Calendar file' : 'Spreadsheet'} ${cfg.name}`,
}

function sha(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex')
}
