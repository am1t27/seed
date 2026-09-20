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
}

// Trail cells are u32 fixed point: stored value / TRAIL_SCALE = trail amount.
const TRAIL_SCALE: f32 = 1024.0;
