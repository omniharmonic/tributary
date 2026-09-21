/**
 * A Spaces-shaped interface (architecture §9.3). Phase A implements it over Postgres
 * (the Gate); Phase B backs the same calls with real atproto Spaces. Addresses use the
 * alpha's exact shape in both, so a record's address does not change at migration:
 *
 *   space   at://{authority}/{spaceType}/{skey}
 *   record  at://{authority}/{spaceType}/{skey}/{authorDid}/{collection}/{rkey}
 *
 * Read and write policies are independent predicate trees (`@tributary/policy`).
 *
 * NON-ENUMERATION. A store never tells a caller whether a space or record they may not
 * read exists: `getSpace`/`getRecord`/`getBlobUrl` return `null` and `listRecords`
 * throws `NotFoundError` identically for "missing" and "not permitted". Only the
 * authority, and managers, can distinguish the two (they can read everything).
 *
 * Phase B note: the protocol's credential tail (a removed member's credential works
 * until it expires, 7,200 s in the alpha) does not exist here — membership truth is
 * the member row and revocation is immediate. `credentialTail` on `Space` records that
 * fact so the migration can document it.
 */
import type { ClaimsProvider, Predicate } from '@tributary/policy'

export type Did = `did:${string}`

export interface Space {
  uri: string
  authority: Did
  spaceType: string
  skey: string
  readPolicy: Predicate
  writePolicy: Predicate
  createdAt: string
  /** Seconds a revoked credential may linger at the protocol level. 0 in Phase A. */
  credentialTail: number
}

export interface SpaceMember {
  did: Did
  /** Techne numeric role: 10 member, 20 steward, 100 manage. */
  role: number
}

export interface SpaceRecord<T = unknown> {
  uri: string
  spaceUri: string
  author: Did
  collection: string
  rkey: string
  value: T
  createdAt: string
  updatedAt: string
}

export interface SpaceBlob {
  id: string
  uri: string
  spaceUri: string
  author: Did
  mime: string
  size: number
}

/** Missing OR not permitted. Deliberately one class, one message. */
export class NotFoundError extends Error {
  constructor() {
    super('NotFound')
    this.name = 'NotFoundError'
  }
}

/** The actor may see the thing but may not do this to it (write to a space they only read, manage a roster). */
export class SpaceAccessError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'SpaceAccessError'
  }
}

export interface CreateSpaceInput {
  authority: Did
  spaceType: string
  skey: string
  readPolicy: Predicate
  writePolicy: Predicate
}

export interface SpaceStore {
  createSpace(input: CreateSpaceInput): Promise<Space>
  /** `viewer` decides whether the space is visible at all; omitted = anonymous. */
  getSpace(uri: string, viewer?: Did | null): Promise<Space | null>
  deleteSpace(uri: string, actor: Did): Promise<void>
  putMember(spaceUri: string, actor: Did, member: Did, role: number): Promise<void>
  removeMember(spaceUri: string, actor: Did, member: Did): Promise<void>
  listMembers(spaceUri: string, viewer: Did): Promise<SpaceMember[]>
  putRecord<T>(spaceUri: string, author: Did, collection: string, value: T, rkey?: string): Promise<SpaceRecord<T>>
  getRecord<T = unknown>(uri: string, viewer: Did | null): Promise<SpaceRecord<T> | null>
  listRecords<T = unknown>(spaceUri: string, viewer: Did | null, collection?: string): Promise<SpaceRecord<T>[]>
  deleteRecord(spaceUri: string, actor: Did, recordUri: string): Promise<void>
  putBlob(spaceUri: string, author: Did, bytes: Buffer, mime: string): Promise<{ id: string; uri: string }>
  /** A short-lived, viewer-bound URL, or null when the viewer may not read the blob's space. */
  getBlobUrl(blobId: string, viewer: Did | null): Promise<string | null>
}

/** Where blob bytes live. The store keeps the metadata row; this keeps the bytes. */
export interface BlobStorage {
  put(id: string, bytes: Buffer): Promise<void>
  get(id: string): Promise<Buffer | null>
  delete(id: string): Promise<void>
}

export interface StoreOptions {
  /** Claims beyond membership (invites, shares, approvals). Membership is the store's own table. */
  claims?: Omit<ClaimsProvider, 'roleOf'>
  /** Mint the signed URL for a blob a viewer may read. */
  signBlobUrl?: (blobId: string, viewer: Did | null) => string
  blobs?: BlobStorage
}

export const SPACE_URI_RE = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/([a-zA-Z0-9.-]+)\/([A-Za-z0-9._:~-]+)$/
export const RECORD_URI_RE = /^(at:\/\/did:[a-z0-9]+:[A-Za-z0-9._:%-]+\/[a-zA-Z0-9.-]+\/[A-Za-z0-9._:~-]+)\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/([a-zA-Z0-9.-]+)\/([A-Za-z0-9._:~-]+)$/

export function spaceUri(authority: Did, spaceType: string, skey: string): string {
  return `at://${authority}/${spaceType}/${skey}`
}

export function parseSpaceUri(uri: string): { authority: Did; spaceType: string; skey: string } | null {
  const m = SPACE_URI_RE.exec(uri)
  return m ? { authority: m[1] as Did, spaceType: m[2]!, skey: m[3]! } : null
}

export function parseRecordUri(uri: string): { spaceUri: string; author: Did; collection: string; rkey: string } | null {
  const m = RECORD_URI_RE.exec(uri)
  return m ? { spaceUri: m[1]!, author: m[2] as Did, collection: m[3]!, rkey: m[4]! } : null
}

/** Managers (role >= 100) and the authority may manage membership; only the authority may delete the space. */
export const MANAGE_ROLE = 100
