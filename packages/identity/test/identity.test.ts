import { describe, expect, it } from 'vitest'
import { generateLabel, hashToken, labelFromName, newApiKey, parseKeyRing, signSessionId, suggestLabels, tid, TID_RE, unwrapSecret, validateLabel, verifySessionCookie, wrapSecret } from '../src/index.js'

describe('key ring', () => {
  it('wraps and unwraps under a versioned key and rejects unknown versions', () => {
    const ring = parseKeyRing(`v1:${Buffer.alloc(32, 1).toString('base64')},v2:${Buffer.alloc(32, 2).toString('base64')}`)
    const w = wrapSecret('app-password', ring, 'v2')
    expect(w.keyVersion).toBe('v2')
    expect(unwrapSecret(w, ring)).toBe('app-password')
    expect(() => unwrapSecret({ ...w, keyVersion: 'v9' }, ring)).toThrow()
    expect(() => parseKeyRing('v1:short')).toThrow()
  })
})

describe('sessions and tokens', () => {
  it('signs and verifies, rejects tampering', () => {
    const c = signSessionId('abc', 's3cret')
    expect(verifySessionCookie(c, 's3cret')).toBe('abc')
    expect(verifySessionCookie(c + 'x', 's3cret')).toBeNull()
    expect(verifySessionCookie(c, 'other')).toBeNull()
    expect(hashToken('a')).not.toBe(hashToken('b'))
    expect(newApiKey()).toMatch(/^tb_/)
  })
})

describe('handles', () => {
  it('enforces 3–18 lowercase labels and the reserved list', () => {
    expect(validateLabel('seedlibrary')).toEqual({ ok: true })
    expect(validateLabel('dairyarts')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateLabel('dairy-arts-center')).toEqual({ ok: true })
    expect(validateLabel('ab')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateLabel('Dairy')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateLabel('a--b')).toEqual({ ok: true })
    expect(validateLabel('-abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateLabel('cityofboulder')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateLabel('admin')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateLabel('a'.repeat(19))).toEqual({ ok: false, reason: 'invalid' })
  })
  it('suggests and generates valid labels', () => {
    expect(labelFromName('The Dairy Arts Center')).toBe('dairy-arts-center')
    for (const s of suggestLabels('admin')) expect(validateLabel(s).ok).toBe(true)
    for (let i = 0; i < 50; i++) expect(validateLabel(generateLabel()).ok).toBe(true)
  })
})

describe('tid', () => {
  it('mints sortable unique 13-char ids', () => {
    const a = tid()
    const b = tid()
    expect(a).toMatch(TID_RE)
    expect(b > a).toBe(true)
  })
})
