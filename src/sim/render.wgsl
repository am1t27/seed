// Fullscreen draw: read the trail and activity buffers, fit the square grid over the canvas
// ("cover"), filter by hand (a buffer has no sampler), map through the color ramp.
// The glow is the trail's own diffused halo shown on a log-like curve, not a blur pass.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> trail: array<u32>;
@group(0) @binding(2) var<storage, read> activity: array<u32>;

@vertex
fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  // One oversized triangle covers the screen.
  let x = f32(i32(i & 1u) * 4 - 1);
  let y = f32(i32(i >> 1u) * 4 - 1);
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn cell(x: i32, y: i32) -> vec2<f32> {
  let w = i32(params.gridW);
  let h = i32(params.gridH);
  let cx = ((x % w) + w) % w;
  let cy = ((y % h) + h) % h;
  let index = u32(cy * w + cx);
  return vec2<f32>(f32(trail[index]), f32(activity[index])) / TRAIL_SCALE;
}

// Both samplers return trail in x and activity in y, so the two channels are
// filtered identically in one pass.
fn bilinear(g: vec2<f32>) -> vec2<f32> {
  let base = floor(g);
  let f = g - base;
  let x = i32(base.x);
  let y = i32(base.y);
  let top = mix(cell(x, y), cell(x + 1, y), f.x);
  let bottom = mix(cell(x, y + 1), cell(x + 1, y + 1), f.x);
  return mix(top, bottom, f.y);
}

// Cubic B-spline weights: smooth, never overshoots, so no dark rings on the poster.
fn weights(t: f32) -> vec4<f32> {
  let a = 1.0 - t;
  return vec4<f32>(
    a * a * a,
    3.0 * t * t * t - 6.0 * t * t + 4.0,
    -3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0,
    t * t * t,
  ) / 6.0;
}

fn bicubic(g: vec2<f32>) -> vec2<f32> {
  let base = floor(g);
  let f = g - base;
  let wx = weights(f.x);
  let wy = weights(f.y);
  let x = i32(base.x);
  let y = i32(base.y);
  var sum = vec2<f32>(0.0);
  for (var j = 0; j < 4; j++) {
    var row = vec2<f32>(0.0);
    for (var i = 0; i < 4; i++) {
      row += cell(x + i - 1, y + j - 1) * wx[i];
    }
    sum += row * wy[j];
  }
  return sum;
}

fn noise(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fragment(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let canvas = vec2<f32>(params.canvasW, params.canvasH);
  let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
  let scale = max(canvas.x / grid.x, canvas.y / grid.y);
  let g = (frag.xy - canvas * 0.5) / scale + grid * 0.5 - vec2<f32>(0.5);

  var sampled: vec2<f32>;
  if (params.quality == 1u) {
    sampled = bicubic(g);
  } else {
    sampled = bilinear(g);
  }
  let value = sampled.x;
  // The fast channel keeps a fixed share per step while the trail's share is the
  // family's decay, so their steady levels differ by a factor that depends on the
  // family. Converting activity into trail-equivalent units first lets one
  // multiplier suit every family; without it fast-decaying families saturate and
  // flow turns into a flat whitening.
  let equivalent = (1.0 - params.activityDecay) * params.decay / max(1.0 - params.decay, 0.01);
  let motion = 1.0 - exp(-max(sampled.y, 0.0) * equivalent * params.exposure * 1.5);

  // Four layers from two numbers: a wide faint halo, the filament body, a hot
  // core, and the flow travelling along it.
  let halo = 1.0 - exp(-value * params.exposure * 7.0);
  let body = 1.0 - exp(-value * params.exposure);
  let core = body * body * body * body;
  // Flow only shows where there is structure to carry it, so it is gated by body.
  let flow = motion * motion * body;

  let deep = mix(vec3<f32>(0.02, 0.05, 0.22), vec3<f32>(0.0, 0.13, 0.12), params.hue);
  let glow = mix(vec3<f32>(0.08, 0.62, 0.98), vec3<f32>(0.12, 1.0, 0.55), params.hue);
  let hot = mix(vec3<f32>(0.80, 0.93, 1.0), vec3<f32>(0.86, 1.0, 0.88), params.hue);
  let spark = mix(vec3<f32>(0.72, 0.90, 1.0), vec3<f32>(0.80, 1.0, 0.92), params.hue);

  var color = deep * halo * 0.55 + glow * pow(body, 1.35) * 0.85 + hot * core * 0.75;
  color += spark * flow * 0.55;
  color *= params.fade;

  // Deep-water background with a slight vignette, so black never reads as a dead screen.
  let uv = (frag.xy / canvas - vec2<f32>(0.5)) * vec2<f32>(canvas.x / max(canvas.x, canvas.y), canvas.y / max(canvas.x, canvas.y));
  let vignette = 1.0 - smoothstep(0.15, 0.75, length(uv));
  color += vec3<f32>(0.006, 0.013, 0.024) * (0.35 + 0.65 * vignette);

  // A little noise hides banding in the dark gradients on screen. The poster skips
  // it: noise is incompressible and would triple the PNG's size.
  if (params.quality == 0u) {
    color += (noise(frag.xy) - 0.5) / 255.0;
  }
  return vec4<f32>(max(color, vec3<f32>(0.0)), 1.0);
}
