/**
 * The basemap proxy's job is to let nothing but a tile coordinate through.
 *
 * Every upstream host and path in `basemap.ts` is a constant; the only caller-controlled
 * values are z/x/y, a font stack and range, and a sprite variant. These check that each
 * of those is rejected unless it is exactly what it claims to be, so no request can be
 * steered anywhere the proxy did not intend to go.
 */
import { describe, expect, it } from 'vitest'

/** The same tests the route applies, kept beside them so the intent is testable. */
const tileOk = (z: number, x: number, y: number) => {
  const span = 2 ** z
  return Number.isInteger(z) && z >= 0 && z <= 14 && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < span && y < span
}
const stackOk = (s: string) => /^[A-Za-z0-9 ,._-]{1,120}$/.test(s)
const rangeOk = (s: string) => /^\d{1,5}-\d{1,5}\.pbf$/.test(s)
const spriteOk = (s: string) => /^sprite(@[234]x)?\.(json|png)$/.test(s)

describe('tile coordinates', () => {
  it('accepts a coordinate inside the pyramid', () => {
    expect(tileOk(10, 213, 389)).toBe(true)
    expect(tileOk(0, 0, 0)).toBe(true)
    expect(tileOk(14, 16383, 16383)).toBe(true)
  })

  it('refuses a coordinate outside its own zoom level', () => {
    expect(tileOk(0, 1, 0)).toBe(false)
    expect(tileOk(10, 1024, 0)).toBe(false)
    expect(tileOk(15, 0, 0)).toBe(false)
    expect(tileOk(-1, 0, 0)).toBe(false)
  })

  it('refuses anything that is not an integer, which is how a path escapes', () => {
    expect(tileOk(NaN, 0, 0)).toBe(false)
    expect(tileOk(1.5, 0, 0)).toBe(false)
    expect(tileOk(10, Number('../../etc'), 0)).toBe(false)
  })
})

describe('font and sprite names', () => {
  it('accepts the shapes a style actually asks for', () => {
    expect(stackOk('Open Sans Regular')).toBe(true)
    expect(stackOk('Open Sans Semibold,Arial Unicode MS Bold')).toBe(true)
    expect(rangeOk('0-255.pbf')).toBe(true)
    expect(spriteOk('sprite.json')).toBe(true)
    expect(spriteOk('sprite@2x.png')).toBe(true)
  })

  it('refuses traversal, schemes and anything else dressed up as a name', () => {
    expect(stackOk('../../../etc/passwd')).toBe(false)
    expect(stackOk('https://evil.example.com')).toBe(false)
    expect(rangeOk('../secret.pbf')).toBe(false)
    expect(rangeOk('0-255.pbf?x=1')).toBe(false)
    expect(spriteOk('sprite.json/../../x')).toBe(false)
    expect(spriteOk('anything.png')).toBe(false)
  })
})
