// Fullscreen draw: read the trail buffer, fit the square grid over the canvas
// ("cover"), bilinear-filter by hand (a buffer has no sampler), tone-map to gray.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> trail: array<u32>;

@vertex
fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  // One oversized triangle covers the screen.
  let x = f32(i32(i & 1u) * 4 - 1);
  let y = f32(i32(i >> 1u) * 4 - 1);
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn cell(x: i32, y: i32) -> f32 {
  let w = i32(params.gridW);
  let h = i32(params.gridH);
  let cx = ((x % w) + w) % w;
  let cy = ((y % h) + h) % h;
  return f32(trail[u32(cy * w + cx)]) / TRAIL_SCALE;
}

@fragment
fn fragment(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let canvas = vec2<f32>(params.canvasW, params.canvasH);
  let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
  let scale = max(canvas.x / grid.x, canvas.y / grid.y);
  let g = (frag.xy - canvas * 0.5) / scale + grid * 0.5 - vec2<f32>(0.5);

  let base = floor(g);
  let f = g - base;
  let x = i32(base.x);
  let y = i32(base.y);
  let top = mix(cell(x, y), cell(x + 1, y), f.x);
  let bottom = mix(cell(x, y + 1), cell(x + 1, y + 1), f.x);
  let value = mix(top, bottom, f.y);

  let tone = 1.0 - exp(-value * params.exposure);
  return vec4<f32>(vec3<f32>(tone), 1.0);
}
