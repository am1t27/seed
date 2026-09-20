import { describe, it, expect } from 'vitest'
import { coverScale, gridFromCanvas, canvasFromGrid } from './mapping'

const GRID = 1024

describe('coverScale', () => {
  it('uses the larger ratio, so the grid covers the canvas with no gaps', () => {
    expect(coverScale(2048, 1024, GRID)).toBe(2)
    expect(coverScale(1024, 3072, GRID)).toBe(3)
  })
})

describe('gridFromCanvas', () => {
  it('puts the canvas centre at the grid centre', () => {
    const point = gridFromCanvas(1000, 500, 2000, 1000, GRID)
    expect(point.x).toBeCloseTo(GRID / 2 - 0.5, 6)
    expect(point.y).toBeCloseTo(GRID / 2 - 0.5, 6)
  })

  it('moves one grid cell per scale pixels', () => {
    // A square canvas twice the grid: one grid cell is two canvas pixels.
    const origin = gridFromCanvas(1000, 1000, 2048, 2048, GRID)
    const moved = gridFromCanvas(1002, 1000, 2048, 2048, GRID)
    expect(moved.x - origin.x).toBeCloseTo(1, 6)
  })
})

describe('canvasFromGrid', () => {
  it('is the exact inverse of gridFromCanvas', () => {
    const cases = [
      [0, 0, 1920, 1080],
      [640, 360, 1920, 1080],
      [1919, 1079, 1920, 1080],
      [17, 900, 800, 1600],
    ] as const
    for (const [px, py, w, h] of cases) {
      const grid = gridFromCanvas(px, py, w, h, GRID)
      const back = canvasFromGrid(grid.x, grid.y, w, h, GRID)
      expect(back.x).toBeCloseTo(px, 6)
      expect(back.y).toBeCloseTo(py, 6)
    }
  })
})
