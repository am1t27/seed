// The square grid is fitted over the canvas with a cover fit, so it always fills
// the screen and the overflow is cropped. render.wgsl does this in the fragment
// shader; pointer input needs the exact inverse. Both live here so they cannot drift.
//
// The shader line this mirrors is:
//   let scale = max(canvas.x / grid.x, canvas.y / grid.y);
//   let g = (frag.xy - canvas * 0.5) / scale + grid * 0.5 - vec2<f32>(0.5);

export function coverScale(canvasW: number, canvasH: number, grid: number): number {
  return Math.max(canvasW / grid, canvasH / grid)
}

// Canvas pixels to grid cells.
export function gridFromCanvas(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  grid: number,
): { x: number; y: number } {
  const scale = coverScale(canvasW, canvasH, grid)
  return {
    x: (px - canvasW / 2) / scale + grid / 2 - 0.5,
    y: (py - canvasH / 2) / scale + grid / 2 - 0.5,
  }
}

// Grid cells back to canvas pixels.
export function canvasFromGrid(
  gx: number,
  gy: number,
  canvasW: number,
  canvasH: number,
  grid: number,
): { x: number; y: number } {
  const scale = coverScale(canvasW, canvasH, grid)
  return {
    x: (gx - grid / 2 + 0.5) * scale + canvasW / 2,
    y: (gy - grid / 2 + 0.5) * scale + canvasH / 2,
  }
}

// A pointer event's client coordinates to grid cells. Client coordinates are CSS
// pixels and the canvas backing store is device pixels, so the ratio matters on
// every retina screen.
export function gridFromClient(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  grid: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return { x: grid / 2, y: grid / 2 }
  const px = (clientX - rect.left) * (canvas.width / rect.width)
  const py = (clientY - rect.top) * (canvas.height / rect.height)
  return gridFromCanvas(px, py, canvas.width, canvas.height, grid)
}
