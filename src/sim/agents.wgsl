// Agent pass (Jones 2010): sense three points ahead, turn toward the strongest,
// step forward, deposit. Sensing reads last frame's diffused trail; deposits go
// to a separate atomic buffer, so no particle sees another's deposit mid-frame.

struct Particle {
  x: f32,
  y: f32,
  angle: f32,
  pad: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> trail: array<u32>;
@group(0) @binding(3) var<storage, read_write> deposits: array<atomic<u32>>;

const TAU: f32 = 6.28318530718;

// PCG hash (Jarzynski and Olano, JCGT 2020). Integer only, so exact on every GPU.
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// Top 24 bits to [0, 1). 24 bits fit an f32 mantissa exactly.
fn unit(h: u32) -> f32 {
  return f32(h >> 8u) / 16777216.0;
}

fn wrap(p: vec2<f32>) -> vec2<f32> {
  let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
  return fract(p / grid) * grid;
}

fn cellIndex(p: vec2<f32>) -> u32 {
  let cx = min(u32(p.x), params.gridW - 1u);
  let cy = min(u32(p.y), params.gridH - 1u);
  return cy * params.gridW + cx;
}

fn sense(pos: vec2<f32>, angle: f32) -> f32 {
  let p = wrap(pos + vec2<f32>(cos(angle), sin(angle)) * params.sensorDist);
  return f32(trail[cellIndex(p)]);
}

fn particleIndex(gid: vec3<u32>) -> u32 {
  return gid.y * params.strideX + gid.x;
}

@compute @workgroup_size(64)
fn init(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = particleIndex(gid);
  if (i >= params.count) {
    return;
  }
  let h0 = pcg(i ^ pcg(params.seed));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
  let center = grid * 0.5;
  let radius = min(grid.x, grid.y) * 0.5;
  let theta = unit(h0) * TAU;

  var pos: vec2<f32>;
  var angle: f32;
  if (params.startShape == 0u) {
    // Disc, heading inward.
    let r = sqrt(unit(h1)) * radius * 0.45;
    pos = center + vec2<f32>(cos(theta), sin(theta)) * r;
    angle = theta + TAU * 0.5;
  } else if (params.startShape == 1u) {
    // Thin ring, heading inward.
    let r = radius * (0.62 + 0.04 * unit(h1));
    pos = center + vec2<f32>(cos(theta), sin(theta)) * r;
    angle = theta + TAU * 0.5;
  } else {
    // Scatter, random heading.
    pos = vec2<f32>(unit(h0), unit(h1)) * grid;
    angle = unit(h2) * TAU;
  }
  particles[i] = Particle(pos.x, pos.y, angle, 0.0);
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = particleIndex(gid);
  if (i >= params.count) {
    return;
  }
  var p = particles[i];
  let pos = vec2<f32>(p.x, p.y);

  let ahead = sense(pos, p.angle);
  let left = sense(pos, p.angle + params.sensorAngle);
  let right = sense(pos, p.angle - params.sensorAngle);

  if (ahead >= left && ahead >= right) {
    // Strongest is ahead: keep heading.
  } else if (ahead < left && ahead < right) {
    // Both sides beat ahead: pick a side at random.
    let coin = pcg(i ^ pcg(params.frame ^ pcg(params.seed)));
    p.angle += select(-params.turnAngle, params.turnAngle, (coin & 1u) == 1u);
  } else if (left > right) {
    p.angle += params.turnAngle;
  } else if (right > left) {
    p.angle -= params.turnAngle;
  }
  // Keep the angle small so float precision holds over long runs.
  p.angle = p.angle - floor(p.angle / TAU) * TAU;

  let next = wrap(pos + vec2<f32>(cos(p.angle), sin(p.angle)) * params.stepSize);
  p.x = next.x;
  p.y = next.y;
  particles[i] = p;

  atomicAdd(&deposits[cellIndex(next)], params.deposit);
}
