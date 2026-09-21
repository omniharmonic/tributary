import { describe, expect, it } from 'vitest'
import { isOwnDomainHandle, LEVEL_RANK } from '../src/lib/provenance.js'

describe('provenance', () => {
  it('recognises own-domain handles', () => {
    expect(isOwnDomainHandle('dairyarts.org')).toBe(true)
    expect(isOwnDomainHandle('events.dairyarts.org')).toBe(true)
    expect(isOwnDomainHandle('alice.bsky.social')).toBe(false)
    expect(isOwnDomainHandle('someone.test')).toBe(false)
    expect(isOwnDomainHandle('did:plc:abc')).toBe(false)
  })
  it('orders the ladder', () => {
    expect(LEVEL_RANK.domain).toBeGreaterThan(LEVEL_RANK.source!)
    expect(LEVEL_RANK.source).toBeGreaterThan(LEVEL_RANK.email!)
  })
})
