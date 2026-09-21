/**
 * ONE suite, run against every backend. Pins the access semantics so the Postgres
 * store (and, in Phase B, the Spaces backend) cannot drift from the memory reference.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { GATED_DETAIL_READ, INVITE_READ, MEMBERS_READ, MEMBERS_WRITE, MemoryClaims, PUBLIC, AUTHORITY_ONLY, ROLE } from '@tributary/policy'
import { NotFoundError, SpaceAccessError, type Did, type SpaceStore } from '../src/index.js'

export interface SuiteHarness {
  /** A fresh, empty store wired to `claims`. */
  make(claims: MemoryClaims): Promise<SpaceStore>
}

const AUTH = 'did:plc:authority' as Did
const MEMBER = 'did:plc:member' as Did
const STEWARD = 'did:plc:steward' as Did
const GUEST = 'did:plc:guest' as Did
const STRANGER = 'did:plc:stranger' as Did

export function storeSuite(name: string, harness: SuiteHarness): void {
  describe(`${name}: SpaceStore semantics`, () => {
    let claims: MemoryClaims
    let store: SpaceStore
    beforeEach(async () => {
      claims = new MemoryClaims()
      store = await harness.make(claims)
    })

    async function membersSpace() {
      const s = await store.createSpace({ authority: AUTH, spaceType: 'coop.lexicon.space.group.calendar', skey: 'members', readPolicy: MEMBERS_READ(ROLE.member), writePolicy: MEMBERS_WRITE })
      await store.putMember(s.uri, AUTH, MEMBER, ROLE.member)
      await store.putMember(s.uri, AUTH, STEWARD, ROLE.steward)
      return s
    }

    it('builds alpha-shaped addresses', async () => {
      const s = await store.createSpace({ authority: AUTH, spaceType: 'coop.lexicon.space.event.invite', skey: '3abc', readPolicy: INVITE_READ, writePolicy: MEMBERS_WRITE })
      expect(s.uri).toBe('at://did:plc:authority/coop.lexicon.space.event.invite/3abc')
      const r = await store.putRecord(s.uri, AUTH, 'community.lexicon.calendar.event', { name: 'x' }, 'rkey1')
      expect(r.uri).toBe(`${s.uri}/did:plc:authority/community.lexicon.calendar.event/rkey1`)
      expect(s.credentialTail).toBe(0)
    })

    it('createSpace is idempotent and updates policies', async () => {
      const a = await store.createSpace({ authority: AUTH, spaceType: 't.x.y', skey: 'k', readPolicy: AUTHORITY_ONLY, writePolicy: AUTHORITY_ONLY })
      const b = await store.createSpace({ authority: AUTH, spaceType: 't.x.y', skey: 'k', readPolicy: PUBLIC, writePolicy: AUTHORITY_ONLY })
      expect(b.uri).toBe(a.uri)
      expect(b.readPolicy).toEqual(PUBLIC)
      expect(await store.getSpace(a.uri, null)).not.toBeNull()
    })

    it('missing and not-permitted are indistinguishable', async () => {
      const s = await membersSpace()
      expect(await store.getSpace(s.uri, STRANGER)).toBeNull()
      expect(await store.getSpace('at://did:plc:authority/coop.lexicon.space.group.calendar/nope', STRANGER)).toBeNull()
      expect(await store.getSpace(s.uri, null)).toBeNull()
      await expect(store.listRecords(s.uri, STRANGER)).rejects.toBeInstanceOf(NotFoundError)
      await expect(store.listRecords('at://did:plc:authority/coop.lexicon.space.group.calendar/nope', STRANGER)).rejects.toBeInstanceOf(NotFoundError)
      await expect(store.listMembers(s.uri, STRANGER)).rejects.toBeInstanceOf(NotFoundError)
      await expect(store.putMember(s.uri, STRANGER, GUEST, 10)).rejects.toBeInstanceOf(NotFoundError)
      await expect(store.deleteSpace(s.uri, STRANGER)).rejects.toBeInstanceOf(NotFoundError)
      const rec = await store.putRecord(s.uri, MEMBER, 'c.e', { a: 1 })
      expect(await store.getRecord(rec.uri, STRANGER)).toBeNull()
      expect(await store.getRecord(rec.uri, null)).toBeNull()
      expect(await store.getRecord(`${s.uri}/did:plc:member/c.e/missing`, MEMBER)).toBeNull()
    })

    it('members read and write at or above the threshold; the authority always can', async () => {
      const s = await membersSpace()
      const rec = await store.putRecord(s.uri, MEMBER, 'c.e', { a: 1 })
      expect((await store.listRecords(s.uri, STEWARD)).map((r) => r.uri)).toEqual([rec.uri])
      expect((await store.listRecords(s.uri, AUTH)).length).toBe(1)
      expect(await store.getRecord(rec.uri, STEWARD)).not.toBeNull()
      expect((await store.listMembers(s.uri, MEMBER)).map((m) => m.did).sort()).toEqual([MEMBER, STEWARD].sort())
    })

    it('a removed member loses access immediately (no credential tail)', async () => {
      const s = await membersSpace()
      await store.putRecord(s.uri, AUTH, 'c.e', { a: 1 })
      expect((await store.listRecords(s.uri, MEMBER)).length).toBe(1)
      await store.removeMember(s.uri, AUTH, MEMBER)
      await expect(store.listRecords(s.uri, MEMBER)).rejects.toBeInstanceOf(NotFoundError)
      expect(await store.getSpace(s.uri, MEMBER)).toBeNull()
    })

    it('only managers manage membership; the authority alone deletes the space', async () => {
      const s = await membersSpace()
      await expect(store.putMember(s.uri, MEMBER, GUEST, 10)).rejects.toBeInstanceOf(SpaceAccessError)
      await expect(store.removeMember(s.uri, STEWARD, MEMBER)).rejects.toBeInstanceOf(SpaceAccessError)
      await store.putMember(s.uri, AUTH, STEWARD, ROLE.manage)
      await store.putMember(s.uri, STEWARD, GUEST, 10)
      expect((await store.listMembers(s.uri, AUTH)).some((m) => m.did === GUEST)).toBe(true)
      await expect(store.deleteSpace(s.uri, STEWARD)).rejects.toBeInstanceOf(SpaceAccessError)
      await store.deleteSpace(s.uri, AUTH)
      expect(await store.getSpace(s.uri, AUTH)).toBeNull()
    })

    it('a member without write permission gets Forbidden, not NotFound', async () => {
      const s = await store.createSpace({ authority: AUTH, spaceType: 't.read.only', skey: 'k', readPolicy: MEMBERS_READ(10), writePolicy: AUTHORITY_ONLY })
      await store.putMember(s.uri, AUTH, MEMBER, 10)
      await expect(store.putRecord(s.uri, MEMBER, 'c.e', {})).rejects.toBeInstanceOf(SpaceAccessError)
      await expect(store.putRecord(s.uri, STRANGER, 'c.e', {})).rejects.toBeInstanceOf(NotFoundError)
    })

    it('authors own their records: update in place, no cross-author overwrite, delete by author or manager', async () => {
      const s = await membersSpace()
      const a = await store.putRecord(s.uri, MEMBER, 'c.e', { v: 1 }, 'same')
      const b = await store.putRecord(s.uri, MEMBER, 'c.e', { v: 2 }, 'same')
      expect(b.uri).toBe(a.uri)
      expect((await store.listRecords(s.uri, AUTH)).length).toBe(1)
      expect(((await store.getRecord(a.uri, AUTH))!.value as { v: number }).v).toBe(2)
      // The steward's own rkey 'same' is a DIFFERENT address (author is part of the uri).
      const c = await store.putRecord(s.uri, STEWARD, 'c.e', { v: 3 }, 'same')
      expect(c.uri).not.toBe(a.uri)
      await expect(store.deleteRecord(s.uri, STEWARD, a.uri)).rejects.toBeInstanceOf(SpaceAccessError)
      await store.deleteRecord(s.uri, MEMBER, a.uri)
      expect(await store.getRecord(a.uri, AUTH)).toBeNull()
      await store.deleteRecord(s.uri, AUTH, c.uri)
      expect((await store.listRecords(s.uri, AUTH)).length).toBe(0)
      await expect(store.deleteRecord(s.uri, STRANGER, c.uri)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('an author can always read their own record', async () => {
      const s = await store.createSpace({ authority: AUTH, spaceType: 't.w', skey: 'k', readPolicy: AUTHORITY_ONLY, writePolicy: MEMBERS_WRITE })
      await store.putMember(s.uri, AUTH, MEMBER, 10)
      const rec = await store.putRecord(s.uri, MEMBER, 'c.rsvp', { going: true })
      expect(await store.getRecord(rec.uri, MEMBER)).not.toBeNull()
      await expect(store.listRecords(s.uri, MEMBER)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('gated detail: confirmed guests and stewards read, plain members and strangers do not', async () => {
      const s = await store.createSpace({ authority: AUTH, spaceType: 'coop.lexicon.space.event.detail', skey: 'evt1', readPolicy: GATED_DETAIL_READ, writePolicy: AUTHORITY_ONLY })
      await store.putMember(s.uri, AUTH, STEWARD, ROLE.steward)
      await store.putMember(s.uri, AUTH, MEMBER, ROLE.member)
      const rec = await store.putRecord(s.uri, AUTH, 'coop.lexicon.event.detail', { exactLocation: '123 Elm St' })
      expect(await store.getRecord(rec.uri, STEWARD)).not.toBeNull()
      expect(await store.getRecord(rec.uri, MEMBER)).toBeNull()
      expect(await store.getRecord(rec.uri, GUEST)).toBeNull()
      claims.grant('confirmedFor', GUEST, s.uri)
      expect(await store.getRecord(rec.uri, GUEST)).not.toBeNull()
      expect(await store.getRecord(rec.uri, STRANGER)).toBeNull()
      claims.revoke('confirmedFor', GUEST, s.uri)
      expect(await store.getRecord(rec.uri, GUEST)).toBeNull()
    })

    it('invite space: invited and shared-with viewers read; strangers see nothing', async () => {
      const s = await store.createSpace({ authority: AUTH, spaceType: 'coop.lexicon.space.event.invite', skey: 'evt2', readPolicy: INVITE_READ, writePolicy: MEMBERS_WRITE })
      const rec = await store.putRecord(s.uri, AUTH, 'community.lexicon.calendar.event', { name: 'Potluck' })
      expect(await store.getSpace(s.uri, GUEST)).toBeNull()
      claims.grant('invited', GUEST, s.uri)
      expect(await store.getSpace(s.uri, GUEST)).not.toBeNull()
      expect((await store.listRecords(s.uri, GUEST, 'community.lexicon.calendar.event')).map((r) => r.uri)).toEqual([rec.uri])
      claims.grant('sharedWith', STRANGER, s.uri)
      expect(await store.getRecord(rec.uri, STRANGER)).not.toBeNull()
      expect(await store.getSpace(s.uri, null)).toBeNull()
    })

    it('blobs: writers put, readers get a viewer-bound url, others get null', async () => {
      const s = await membersSpace()
      const { id, uri } = await store.putBlob(s.uri, MEMBER, Buffer.from('image-bytes'), 'image/jpeg')
      expect(uri).toContain(`/did:plc:member/blob/${id}`)
      expect(await store.getBlobUrl(id, STEWARD)).toContain(id)
      expect(await store.getBlobUrl(id, STRANGER)).toBeNull()
      expect(await store.getBlobUrl(id, null)).toBeNull()
      expect(await store.getBlobUrl('deadbeef', AUTH)).toBeNull()
      await expect(store.putBlob(s.uri, STRANGER, Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('listRecords filters by collection', async () => {
      const s = await membersSpace()
      await store.putRecord(s.uri, AUTH, 'c.a', {})
      await store.putRecord(s.uri, AUTH, 'c.b', {})
      expect((await store.listRecords(s.uri, AUTH, 'c.a')).length).toBe(1)
      expect((await store.listRecords(s.uri, AUTH)).length).toBe(2)
    })
  })
}
