/**
 * One stray pin must not decide the whole view.
 */
import { describe, expect, it } from 'vitest'
import { frameFor } from './EventMap'

type F = Parameters<typeof frameFor>[0][number]
const at = (lon: number, lat: number): F => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { key: `${lon},${lat}`, name: '', when: '', href: '' } })

/** Twenty-five pins around Boulder, so the percentile frame is in effect. */
const boulder = Array.from({ length: 25 }, (_, i) => at(-105.28 + i * 0.002, 40.01 + i * 0.002))

describe('frameFor', () => {
  it('ignores a far outlier once there are enough pins to have a middle', () => {
    const [[west], [east]] = frameFor([...boulder, at(-74.0007613, 40.7207559)])!
    expect(west).toBeGreaterThan(-106)
    expect(east).toBeLessThan(-104)
  })

  it('keeps every pin in frame while there are too few to call one an outlier', () => {
    const [[west, south], [east, north]] = frameFor([at(-105.28, 40.01), at(-105.1, 40.16)])!
    expect(west).toBeLessThanOrEqual(-105.28)
    expect(east).toBeGreaterThanOrEqual(-105.1)
    expect(south).toBeLessThanOrEqual(40.01)
    expect(north).toBeGreaterThanOrEqual(40.16)
  })

  it('gives a single pin an area to sit in rather than a zero-size box', () => {
    const [[west, south], [east, north]] = frameFor([at(-105.28, 40.01)])!
    expect(east).toBeGreaterThan(west)
    expect(north).toBeGreaterThan(south)
  })

  it('has nothing to frame when nothing is placed', () => {
    expect(frameFor([])).toBeNull()
  })
})
