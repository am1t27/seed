import { describe, it, expect } from 'vitest'
import { easeLook, LOOK_KEYS } from './morph'
import type { Form } from './sim/simulation'

const form = (overrides: Partial<Form> = {}): Form => ({
  seed: 1,
  startShape: 0,
  heading: 0,
  shapeSize: 0.5,
  sensorAngle: 0.5,
  sensorDist: 20,
  turnAngle: 0.2,
  stepSize: 2,
  decay: 0.8,
  crowd: 12,
  island: 0,
  exposure: 0.08,
  hue: 0,
  ...overrides,
})

describe('easeLook', () => {
  it('moves the look parameters a share of the way toward the target', () => {
    const current = form({ sensorDist: 20 })
    easeLook(current, form({ sensorDist: 40 }), 0.25)
    expect(current.sensorDist).toBeCloseTo(25, 6)
  })

  it('converges on the target when applied repeatedly', () => {
    const current = form({ hue: 0 })
    const target = form({ hue: 1 })
    for (let i = 0; i < 200; i++) easeLook(current, target, 0.12)
    expect(current.hue).toBeCloseTo(1, 4)
  })

  it('never touches the seed parameters, so nothing is repositioned', () => {
    const current = form({ seed: 111, startShape: 0, heading: 0, shapeSize: 0.5 })
    easeLook(current, form({ seed: 999, startShape: 2, heading: 3, shapeSize: 0.9 }), 1)
    expect(current.seed).toBe(111)
    expect(current.startShape).toBe(0)
    expect(current.heading).toBe(0)
    expect(current.shapeSize).toBe(0.5)
  })

  it('eases every key it claims to ease', () => {
    const current = form()
    const target = form({
      sensorAngle: 1,
      sensorDist: 50,
      turnAngle: 1,
      stepSize: 3,
      decay: 0.95,
      crowd: 25,
      exposure: 0.2,
      hue: 1,
    })
    easeLook(current, target, 1)
    for (const key of LOOK_KEYS) {
      expect(current[key]).toBeCloseTo(target[key], 6)
    }
  })
})
