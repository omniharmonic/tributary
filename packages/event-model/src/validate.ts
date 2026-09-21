/**
 * Local lexicon validation. The reference PDS skips validation for lexicons it does
 * not bundle (architecture §6), so nothing downstream would catch a malformed record;
 * we validate every record here before writing and never pass `validate: true`.
 *
 * Objects in atproto lexicons are open, so the atmo-convention fields we add
 * (`timezone`, `media`, `preferences`, `additionalData`, `facets`) pass as undeclared
 * properties while the declared ones are checked strictly.
 */
import { Lexicons, type LexiconDoc } from '@atproto/lexicon'
import { createRequire } from 'node:module'
import { EVENT_COLLECTION } from './types.js'

const require = createRequire(import.meta.url)

const DOCS: LexiconDoc[] = [
  require('../lexicons/community/lexicon/calendar/event.json'),
  require('../lexicons/community/lexicon/calendar/rsvp.json'),
  require('../lexicons/community/lexicon/location/address.json'),
  require('../lexicons/community/lexicon/location/geo.json'),
  require('../lexicons/community/lexicon/location/fsq.json'),
  require('../lexicons/community/lexicon/location/hthree.json'),
]

let lexicons: Lexicons | undefined

export function getLexicons(): Lexicons {
  return (lexicons ??= new Lexicons(DOCS))
}

export class RecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordValidationError'
  }
}

/** Throws `RecordValidationError` when the record does not satisfy the base lexicon. */
export function assertValidEventRecord(record: unknown): void {
  try {
    getLexicons().assertValidRecord(EVENT_COLLECTION, record)
  } catch (err) {
    throw new RecordValidationError(err instanceof Error ? err.message : String(err))
  }
  // The card profile's own guarantees, beyond the lexicon (PRD §10).
  const r = record as Record<string, unknown>
  if (typeof r.timezone !== 'string' || !r.timezone) throw new RecordValidationError('record has no timezone')
  if (typeof r.startsAt !== 'string') throw new RecordValidationError('record has no startsAt')
  const ext = (r.additionalData as Record<string, unknown> | undefined)?.externalSource as Record<string, unknown> | undefined
  if (!ext || typeof ext.url !== 'string' || typeof ext.externalId !== 'string') {
    throw new RecordValidationError('record has no externalSource attribution')
  }
}

export function isValidEventRecord(record: unknown): boolean {
  try {
    assertValidEventRecord(record)
    return true
  } catch {
    return false
  }
}
