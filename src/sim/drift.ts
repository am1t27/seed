// Idle drift: when nobody has touched the organism for a while, an invisible
// attractant wanders the field so it is never completely still.
//
// It is driven by the step count and not by the clock. A share link always
// grows from step zero, so the drift starts at the same step and follows the
// same path on every visit, and an untouched word stays a pure function of the
// word. Driving it from wall time would make two visits to one link diverge.

// Four seconds of simulation at 60 steps per second.
export const IDLE_AFTER_STEPS = 240
// Share of the full pointer feed.
export const IDLE_STRENGTH = 0.22

export function isIdle(step: number, lastTouchStep: number): boolean {
  return step - lastTouchStep > IDLE_AFTER_STEPS
}

// A Lissajous path never repeats on a short cycle, so the organism keeps
// reorganizing instead of settling into one shape.
export function driftAt(step: number, grid: number): { x: number; y: number } {
  const t = step / 60
  return {
    x: grid * (0.5 + 0.3 * Math.sin(t * 0.21)),
    y: grid * (0.5 + 0.3 * Math.sin(t * 0.13 + 1.7)),
  }
}
