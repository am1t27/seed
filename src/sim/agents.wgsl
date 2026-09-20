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

// The distance is a parameter because each particle sets its own; see step.
fn senseAt(pos: vec2<f32>, angle: f32, dist: f32) -> f32 {
  let p = wrap(pos + vec2<f32>(cos(angle), sin(angle)) * dist);
  // Attraction rises with the trail up to `crowd`, then falls: an overcrowded
  // filament pushes particles off to found new ones, which keeps networks fine.
  let value = f32(trail[cellIndex(p)]) / TRAIL_SCALE;
  return min(value, 2.0 * params.crowd - value);
}

fn particleIndex(gid: vec3<u32>) -> u32 {
  return gid.y * params.strideX + gid.x;
}

// Where particle i starts. A pure function of the index and the seed, so the
// same word always begins from the same arrangement.
fn startState(i: u32) -> Particle {
  let h0 = pcg(i ^ pcg(params.seed));
  let h1 = pcg(h0);
  let h2 = pcg(h1);
  let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
  let center = grid * 0.5;
  let radius = min(grid.x, grid.y) * 0.5 * params.shapeSize;
  let theta = unit(h0) * TAU;

  var pos: vec2<f32>;
  var inward = theta + TAU * 0.5;
  if (params.startShape == 0u) {
    pos = center + vec2<f32>(cos(theta), sin(theta)) * sqrt(unit(h1)) * radius;
  } else if (params.startShape == 1u) {
    pos = center + vec2<f32>(cos(theta), sin(theta)) * radius * (0.94 + 0.06 * unit(h1));
  } else {
    pos = vec2<f32>(unit(h0), unit(h1)) * grid;
    let toCenter = center - pos;
    inward = atan2(toCenter.y, toCenter.x);
  }

  var angle = inward;
  if (params.heading == 1u) {
    angle = inward + TAU * 0.5;
  } else if (params.heading == 2u) {
    angle = unit(h2) * TAU;
  } else if (params.heading == 3u) {
    angle = inward + TAU * 0.25;
  }
  return Particle(pos.x, pos.y, angle, 0.0);
}

@compute @workgroup_size(64)
fn init(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = particleIndex(gid);
  if (i >= params.count) {
    return;
  }
  particles[i] = startState(i);
}

// Entrance: every particle streams toward its new start position, leaving a
// trail, so a new word visibly reorganizes the old organism instead of cutting.
@compute @workgroup_size(64)
fn gather(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = particleIndex(gid);
  if (i >= params.count) {
    return;
  }
  var p = particles[i];
  let goal = startState(i);
  let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
  // Shortest way round the wrapped grid.
  var delta = vec2<f32>(goal.x - p.x, goal.y - p.y);
  delta = delta - round(delta / grid) * grid;
  let next = wrap(vec2<f32>(p.x, p.y) + delta * params.gatherRate);
  p.x = next.x;
  p.y = next.y;
  p.angle = goal.angle;
  particles[i] = p;
  atomicAdd(&deposits[cellIndex(next)], params.deposit);
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = particleIndex(gid);
  if (i >= params.count) {
    return;
  }
  var p = particles[i];
  let pos = vec2<f32>(p.x, p.y);

  // Per-particle parameters. Each particle reads the field it is standing in and
  // scales its own sensing and movement from it, so a single image carries fine
  // detail in crowded regions and long reaching filaments in empty ones. A
  // modulation of 0 leaves every value untouched and reproduces a fixed run.
  // The idea is Sage Jenson's; his source was never published, so this is
  // written from the description and is our own.
  let here = f32(trail[cellIndex(pos)]) / TRAIL_SCALE;
  let local = clamp(here / max(params.crowd, 0.001), 0.0, 1.0);
  // Crowded means short reach and small steps; empty means long reach.
  let reach = max(0.15, 1.0 + params.modulation * (0.5 - local) * 2.0);
  // Crowded means a wider sweep and a sharper turn, which is what makes detail.
  let sweep = max(0.15, 1.0 + params.modulation * (local - 0.5) * 2.0);

  let sensorAngle = params.sensorAngle * sweep;
  let sensorDist = params.sensorDist * reach;
  let turnAngle = params.turnAngle * sweep;
  let stepSize = params.stepSize * reach;

  let ahead = senseAt(pos, p.angle, sensorDist);
  let left = senseAt(pos, p.angle + sensorAngle, sensorDist);
  let right = senseAt(pos, p.angle - sensorAngle, sensorDist);

  if (ahead >= left && ahead >= right) {
    // Strongest is ahead: keep heading.
  } else if (ahead < left && ahead < right) {
    // Both sides beat ahead: pick a side at random.
    let coin = pcg(i ^ pcg(params.frame ^ pcg(params.seed)));
    p.angle += select(-turnAngle, turnAngle, (coin & 1u) == 1u);
  } else if (left > right) {
    p.angle += turnAngle;
  } else if (right > left) {
    p.angle -= turnAngle;
  }
  // Keep the angle small so float precision holds over long runs.
  p.angle = p.angle - floor(p.angle / TAU) * TAU;

  let next = wrap(pos + vec2<f32>(cos(p.angle), sin(p.angle)) * stepSize);
  p.x = next.x;
  p.y = next.y;
  particles[i] = p;

  atomicAdd(&deposits[cellIndex(next)], params.deposit);
}
