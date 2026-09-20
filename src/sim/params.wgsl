// Shared by every pass. All fields are 4-byte scalars so the layout has no
// padding surprises; simulation.ts writes the same order with a DataView.
struct Params {
  gridW: u32,
  gridH: u32,
  count: u32,
  frame: u32,
  seed: u32,
  strideX: u32, // particles per dispatch row, for the 2D dispatch
  deposit: u32, // fixed point, TRAIL_SCALE units
  startShape: u32, // 0 disc, 1 ring, 2 scatter
  sensorAngle: f32,
  sensorDist: f32,
  turnAngle: f32,
  stepSize: f32,
  decay: f32,
  canvasW: f32,
  canvasH: f32,
  exposure: f32,
  hue: f32, // 0 blue, 1 green, within the bioluminescent range
  fade: f32, // 0..1 brightness envelope for entrances
  gatherRate: f32, // share of the remaining distance covered per gather step
  quality: u32, // 0 bilinear (live), 1 bicubic (poster)
  heading: u32, // 0 inward, 1 outward, 2 random, 3 tangent
  shapeSize: f32, // start shape radius, as a share of the half grid
  crowd: f32, // trail amount above which a filament stops attracting
  pad1: u32,
}

// Trail cells are u32 fixed point: stored value / TRAIL_SCALE = trail amount.
const TRAIL_SCALE: f32 = 1024.0;
