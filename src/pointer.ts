import { gridFromClient } from './sim/mapping'

// Pointer Events only, so a mouse, a finger and a pen all take one path.
// This module knows about gestures and nothing about WebGPU.

export interface PointerHandlers {
  feed(x: number, y: number, strength: number): void
  wound(x: number, y: number): void
  // Called on any real input, so the caller can cancel its idle animation.
  touched(): void
}

// A press shorter than this, that moved less than TAP_SLOP, is a tap.
const TAP_MS = 180
const TAP_SLOP = 8
// A hovering mouse feeds gently, so a desktop visitor sees a response before
// they think to click. Touch screens have no hover and are unaffected.
const HOVER_STRENGTH = 0.35

export function attachPointer(
  canvas: HTMLCanvasElement,
  grid: number,
  handlers: PointerHandlers,
): void {
  let downAt = 0
  let downX = 0
  let downY = 0
  let dragging = false

  const feedAt = (event: PointerEvent, strength: number): void => {
    const point = gridFromClient(event.clientX, event.clientY, canvas, grid)
    handlers.feed(point.x, point.y, strength)
  }

  canvas.addEventListener('pointerdown', (event) => {
    handlers.touched()
    dragging = true
    downAt = event.timeStamp
    downX = event.clientX
    downY = event.clientY
    canvas.setPointerCapture(event.pointerId)
    feedAt(event, 1)
  })

  canvas.addEventListener('pointermove', (event) => {
    handlers.touched()
    if (dragging) {
      feedAt(event, 1)
    } else if (event.pointerType === 'mouse') {
      feedAt(event, HOVER_STRENGTH)
    }
  })

  const release = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    const quick = event.timeStamp - downAt < TAP_MS
    const still = Math.hypot(event.clientX - downX, event.clientY - downY) < TAP_SLOP
    if (quick && still) {
      const point = gridFromClient(event.clientX, event.clientY, canvas, grid)
      handlers.wound(point.x, point.y)
    }
    handlers.feed(0, 0, 0)
  }

  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('pointerleave', (event) => {
    release(event)
    handlers.feed(0, 0, 0)
  })

  // Stop a drag on the canvas from scrolling or selecting the page on touch.
  canvas.style.touchAction = 'none'
}
