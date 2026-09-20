// Diffuse and decay: 3x3 box blur of (last trail + this frame's deposits),
// scaled by the decay factor, written to the other ping-pong buffer.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> trailIn: array<u32>;
@group(0) @binding(2) var<storage, read> deposits: array<u32>;
@group(0) @binding(3) var<storage, read_write> trailOut: array<u32>;
@group(0) @binding(4) var<storage, read_write> activity: array<u32>;

// Cap per cell so nine cells sum without overflowing u32 (9 * 2^28 < 2^32).
const CELL_MAX: u32 = 268435456u;

@compute @workgroup_size(8, 8)
fn diffuse(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridW || gid.y >= params.gridH) {
    return;
  }
  var sum = 0u;
  for (var dy = 0u; dy < 3u; dy++) {
    for (var dx = 0u; dx < 3u; dx++) {
      // Adding grid - 1 then taking the remainder wraps -1..1 without signed math.
      let x = (gid.x + params.gridW - 1u + dx) % params.gridW;
      let y = (gid.y + params.gridH - 1u + dy) % params.gridH;
      let c = y * params.gridW + x;
      sum += min(trailIn[c], CELL_MAX) + min(deposits[c], CELL_MAX >> 1u);
    }
  }
  var value = f32(sum) * (params.decay / 9.0);

  // The pointer. Feeding adds trail, which particles then sense and follow.
  // Wounding scales trail down, which tears a hole the network grows back into.
  // Both are radial and both are zero when nothing is touching the field.
  if (params.pointerFeed > 0.0 || params.pointerWound > 0.0) {
    let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
    var offset = vec2<f32>(f32(gid.x), f32(gid.y)) - vec2<f32>(params.pointerX, params.pointerY);
    // The field wraps, so take the shortest way round.
    offset = offset - round(offset / grid) * grid;
    let reach = max(params.pointerRadius, 1.0);
    let falloff = max(0.0, 1.0 - length(offset) / reach);
    let shaped = falloff * falloff;
    value += shaped * params.pointerFeed * TRAIL_SCALE;
    value *= 1.0 - shaped * params.pointerWound;
  }

  trailOut[gid.y * params.gridW + gid.x] = u32(clamp(value, 0.0, f32(CELL_MAX)));

  // The fast channel: where particles moved in roughly the last half second.
  // Each invocation touches only its own cell, so updating in place is safe and
  // no second buffer is needed.
  let index = gid.y * params.gridW + gid.x;
  let recent = f32(activity[index]) * params.activityDecay + f32(min(deposits[index], CELL_MAX >> 1u));
  activity[index] = u32(min(recent, f32(CELL_MAX)));
}
