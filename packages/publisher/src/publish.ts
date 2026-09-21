/**
 * Publish one event to a repo: build the record, validate locally, upload the image
 * blob if new, write with compare-and-swap. On CAS failure re-read and retry once, then
 * report it (someone edited the record in another app; the host decides).
 */
import { assertValidEventRecord, buildEventRecord, EVENT_COLLECTION, type BuildRecordOptions, type EventRecord, type NormalizedEvent } from '@tributary/event-model'
import type { PreparedImage } from './images.js'
import { CasError, type BlobRefJson, type RepoWriter } from './writer.js'

export interface PublishInput {
  event: NormalizedEvent
  rkey: string
  /** The ledger's view of what is already there. */
  existing?: { cid: string; createdAt?: string; blob?: BlobRefJson; imageHash?: string } | null
  image?: PreparedImage | null
  createdWith: string
  defaultCountry?: string
  teaser?: boolean
}

export interface PublishResult {
  uri: string
  cid: string
  record: EventRecord
  blob?: BlobRefJson
  imageHash?: string
  /** True when the write won only after a CAS retry (the record had changed underneath us). */
  casRetried: boolean
}

export async function publishEvent(writer: RepoWriter, input: PublishInput): Promise<PublishResult> {
  let blob = input.existing?.blob
  let imageHash = input.existing?.imageHash
  if (input.image && input.image.hash !== input.existing?.imageHash) {
    // Blobs must be referenced promptly after upload or the PDS garbage-collects them.
    blob = await writer.uploadBlob(input.image.bytes, input.image.mime)
    imageHash = input.image.hash
  }
  if (!input.image) {
    blob = undefined
    imageHash = undefined
  }
  const opts: BuildRecordOptions = {
    createdWith: input.createdWith,
    createdAt: input.existing?.createdAt,
    defaultCountry: input.defaultCountry,
    teaser: input.teaser,
    media: blob && input.image ? { blob, width: input.image.width, height: input.image.height, alt: input.event.image?.alt } : undefined,
  }
  const record = buildEventRecord(input.event, opts)
  assertValidEventRecord(record)

  const swap = input.existing ? input.existing.cid : null
  try {
    const res = await writer.putRecord(EVENT_COLLECTION, input.rkey, record, swap)
    return { ...res, record, blob, imageHash, casRetried: false }
  } catch (err) {
    if (!(err instanceof CasError)) throw err
    const current = await writer.getRecord(EVENT_COLLECTION, input.rkey)
    const res = await writer.putRecord(EVENT_COLLECTION, input.rkey, record, current?.cid ?? null)
    return { ...res, record, blob, imageHash, casRetried: true }
  }
}

export async function unpublishEvent(writer: RepoWriter, rkey: string): Promise<void> {
  await writer.deleteRecord(EVENT_COLLECTION, rkey)
}

/**
 * `applyWrites` would batch first imports; the reference PDS's rate limit (5,000 points
 * an hour) is far above steady state, so sequential writes with a small gap are enough
 * for v1 and keep the CAS semantics simple.
 */
export async function publishMany(writer: RepoWriter, inputs: PublishInput[], onEach: (r: PublishResult | Error, i: PublishInput) => Promise<void>): Promise<void> {
  for (const input of inputs) {
    try {
      const r = await publishEvent(writer, input)
      await onEach(r, input)
    } catch (err) {
      await onEach(err instanceof Error ? err : new Error(String(err)), input)
    }
  }
}
