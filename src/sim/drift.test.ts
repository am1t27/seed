import { describe, it, expect } from 'vitest'
import { driftAt, isIdle, IDLE_AFTER_STEPS } from './drift'

const GRID = 1024

describe('driftAt', () => {
  it('depends only on the step, so an untouched word stays reproducible', () => {
    expect(driftAt(900, GRID)).toEqual(driftAt(900, GRID))
  })

  it('stays inside the middle of the field', () => {
    for (let step = 0; step < 20000; step += 37) {
      const point = driftAt(step, GRID)
      expect(point.x).toBeGreaterThanOrEqual(GRID * 0.2)
      expect(point.x).toBeLessThanOrEqual(GRID * 0.8)
      expect(point.y).toBeGreaterThanOrEqual(GRID * 0.2)
      expect(point.y).toBeLessThanOrEqual(GRID * 0.8)
    }
  })

  it('moves slowly, well under a cell per step', () => {
    const a = driftAt(1000, GRID)
    const b = driftAt(1001, GRID)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(2)
  })
})

describe('isIdle', () => {
  it('waits for the idle period after the last touch', () => {
    expect(isIdle(100 + IDLE_AFTER_STEPS, 100)).toBe(false)
    expect(isIdle(101 + IDLE_AFTER_STEPS, 100)).toBe(true)
  })
})
