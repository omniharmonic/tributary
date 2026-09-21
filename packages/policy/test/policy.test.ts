import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate, GATED_DETAIL_READ, INVITE_READ, MemoryClaims, MEMBERS_READ, parsePolicy, PolicyParseError, type ClaimsProvider, type Predicate } from '../src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const vectors = JSON.parse(readFileSync(path.join(here, 'vectors.json'), 'utf8')) as {
  cases: Array<{ name: string; policy: unknown; viewer: string | null; claims: { role?: number; invited?: boolean; sharedWith?: boolean; confirmedFor?: boolean; connectedToAuthority?: boolean }; expected: boolean }>
  invalid: Array<{ name: string; policy: unknown }>
}

const SPACE = { uri: 'at://did:plc:auth/coop.lexicon.space.event.invite/3abc', authority: 'did:plc:auth' }

function claimsFor(viewer: string | null, c: (typeof vectors.cases)[number]['claims']): ClaimsProvider {
  const m = new MemoryClaims()
  if (viewer) {
    if (c.role !== undefined) m.setRole(viewer, SPACE.uri, c.role)
    if (c.invited) m.grant('invited', viewer, SPACE.uri)
    if (c.sharedWith) m.grant('sharedWith', viewer, SPACE.uri)
    if (c.confirmedFor) m.grant('confirmedFor', viewer, SPACE.uri)
    if (c.connectedToAuthority) m.connect(viewer, SPACE.authority)
  }
  return m
}

describe('policy vectors', () => {
  for (const v of vectors.cases) {
    it(v.name, async () => {
      const policy = parsePolicy(v.policy)
      const got = await evaluate(policy, { viewer: v.viewer, space: SPACE, claims: claimsFor(v.viewer, v.claims) })
      expect(got).toBe(v.expected)
    })
  }
  for (const v of vectors.invalid) {
    it(`rejects: ${v.name}`, () => {
      expect(() => parsePolicy(v.policy)).toThrow(PolicyParseError)
    })
  }
})

describe('fail closed', () => {
  const throwing: ClaimsProvider = {
    roleOf: async () => {
      throw new Error('db down')
    },
    isInvited: async () => {
      throw new Error('db down')
    },
    isSharedWith: async () => {
      throw new Error('db down')
    },
    isConfirmedFor: async () => {
      throw new Error('db down')
    },
    isConnectionOf: async () => {
      throw new Error('db down')
    },
  }
  it('a throwing claims provider reads as false', async () => {
    expect(await evaluate(INVITE_READ, { viewer: 'did:plc:g', space: SPACE, claims: throwing })).toBe(false)
    expect(await evaluate(GATED_DETAIL_READ, { viewer: 'did:plc:g', space: SPACE, claims: throwing })).toBe(false)
    expect(await evaluate(MEMBERS_READ(10), { viewer: 'did:plc:g', space: SPACE, claims: throwing })).toBe(false)
  })
  it('the authority still passes memberRole with a broken provider (no claim needed)', async () => {
    expect(await evaluate(MEMBERS_READ(10), { viewer: 'did:plc:auth', space: SPACE, claims: throwing })).toBe(true)
  })
  it('an unknown node kind is false, never a throw', async () => {
    const bad = { kind: 'magic' } as unknown as Predicate
    expect(await evaluate(bad, { viewer: 'did:plc:auth', space: SPACE, claims: new MemoryClaims() })).toBe(false)
  })
})
