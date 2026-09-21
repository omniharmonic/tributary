import { describe, expect, it } from 'vitest'
import { rememberNext, safeNext, takeNext } from './next'

describe('safeNext', () => {
  it('keeps same-origin paths and drops everything else', () => {
    expect(safeNext('/join/abc?e=did%3Aplc%3Ax%2F3k')).toBe('/join/abc?e=did%3Aplc%3Ax%2F3k')
    expect(safeNext('/dashboard')).toBe('/dashboard')
    expect(safeNext('https://evil.example/x')).toBeNull()
    expect(safeNext('//evil.example/x')).toBeNull()
    expect(safeNext('javascript:alert(1)')).toBeNull()
    expect(safeNext('')).toBeNull()
    expect(safeNext(undefined)).toBeNull()
  })
  it('round-trips through session storage once', () => {
    rememberNext('/join/t?e=a%2Fb')
    expect(takeNext()).toBe('/join/t?e=a%2Fb')
    expect(takeNext()).toBeNull()
    rememberNext('https://evil.example')
    expect(takeNext()).toBeNull()
  })
})
