import type { Form } from './sim/simulation'

// While the visitor types, the organism reshapes instead of restarting. Only the
// parameters that decide the form move; the ones that decide the arrangement do
// not, so no particle is repositioned and no trail is cleared.
//
// hue is a 0 to 1 blend between the blue and green ends of the colour ramp, not
// an angle, so it eases linearly with no wraparound.

export const LOOK_KEYS = [
  'sensorAngle',
  'sensorDist',
  'turnAngle',
  'stepSize',
  'decay',
  'crowd',
  'exposure',
  'hue',
] as const

export type LookKey = (typeof LOOK_KEYS)[number]

// Moves `current` a share of the remaining distance toward `target`, in place.
// A rate of 0.12 per frame converges in about a third of a second at 60 fps.
export function easeLook(current: Form, target: Form, rate: number): void {
  const share = Math.max(0, Math.min(1, rate))
  for (const key of LOOK_KEYS) {
    current[key] += (target[key] - current[key]) * share
  }
}
