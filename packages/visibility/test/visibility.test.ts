import { describe, expect, it } from 'vitest'
import { normalize, type NormalizedEvent } from '@tributary/event-model'
import { classify, isWidening, narrower } from '../src/index.js'

const base = (over: Partial<Parameters<typeof normalize>[0]> = {}): NormalizedEvent =>
  normalize(
    { externalId: 'e', name: 'Board meeting', start: '2026-10-04T10:00:00', tz: 'America/Denver', location: 'Library', url: 'https://x.org/e', ...over },
    { sourceId: 's', sourceType: 'ics', platform: 'google', defaultTz: 'America/Denver', fallbackUrl: 'https://x.org' },
  )

describe('classify', () => {
  it('uses the source default', () => {
    expect(classify(base(), { sourceDefault: 'public' }).visibility).toBe('public')
    expect(classify(base(), { sourceDefault: 'unlisted' }).visibility).toBe('unlisted')
  })
  it('honours CLASS:PRIVATE as a ceiling that even an override cannot lift', () => {
    const e = base({ sourcePrivacy: 'private' })
    expect(classify(e, { sourceDefault: 'public' }).visibility).toBe('held')
    expect(classify(e, { sourceDefault: 'public', override: { visibility: 'public' } }).visibility).toBe('held')
    const c = classify(e, { sourceDefault: 'members', sourceAudience: { group: 'did:plc:g', minRole: 10 }, sourceMappedToSpace: true })
    expect(c.visibility).toBe('members')
    expect(c.audience?.group).toBe('did:plc:g')
  })
  it('applies rules in order, first match wins', () => {
    const c = classify(base(), { sourceDefault: 'public', rules: [{ match: { titleContains: 'board' }, level: 'invite', audience: { inviteListId: 'board' } }, { match: {}, level: 'held' }] })
    expect(c.visibility).toBe('invite')
    expect(c.visibilitySource).toBe('rule')
  })
  it('gates conference links and home addresses by default', () => {
    const c = classify(base({ description: 'join https://zoom.us/j/1' }), { sourceDefault: 'public' })
    expect(c.gatedFields).toContain('joinUrl')
    const h = classify(base({ locations: [{ name: 'home', street: '1 Elm', private: true }] }), { sourceDefault: 'public' })
    expect(h.gatedFields).toContain('exactLocation')
  })
  it('holds members/invite events with no audience', () => {
    expect(classify(base(), { sourceDefault: 'members' }).visibility).toBe('held')
  })
  it('per-event override narrows freely', () => {
    expect(classify(base(), { sourceDefault: 'public', override: { visibility: 'unlisted' } }).visibility).toBe('unlisted')
    expect(classify(base(), { sourceDefault: 'public', override: { hidden: true } }).visibility).toBe('held')
  })
})

describe('narrowing rule', () => {
  it('orders levels', () => {
    expect(isWidening('held', 'public')).toBe(true)
    expect(isWidening('public', 'unlisted')).toBe(false)
    expect(isWidening('members', 'gated')).toBe(true)
    expect(narrower('public', 'invite')).toBe('invite')
  })
})
