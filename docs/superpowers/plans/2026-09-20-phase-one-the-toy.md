# Seed Phase One, The Toy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the page respond to the visitor: the organism reacts to the pointer, reshapes while you type, shows visible flow, and carries detail at more than one scale.

**Architecture:** Four features land on the existing WebGPU simulation without new passes where possible. Pointer feed and wound become extra terms in the diffuse pass that already visits every cell. Typing eases the look parameters in TypeScript with no GPU change. A single extra buffer holds a fast-decaying activity channel that the renderer draws as flow. Per-particle parameter modulation is a dozen instructions in the agent shader, landing switched off so it can be verified byte-for-byte against the current build before any family is re-tuned.

**Tech Stack:** TypeScript, Vite 8, raw WebGPU, WGSL. Vitest added as a dev dependency for the pure-function tests. No runtime dependencies in this phase.

**Spec:** `docs/superpowers/specs/2026-09-20-interactivity-design.md`

## Global Constraints

- **No runtime dependencies in this phase.** The README claim "zero runtime dependencies" must stay true until feature 6 in phase three. Vitest is a dev dependency and does not affect it.
- **No permission prompts.** No microphone, camera, geolocation or device motion.
- **Grid is 1024 by 1024** at every tier. Particle tiers are `[150_000, 300_000, 600_000, 1_000_000, 2_000_000]`.
- **The uniform struct is one flat struct of 4-byte scalars**, written from a single `DataView` in `simulation.ts`, mirrored field for field in `params.wgsl`. Never introduce a nested struct, an array, or a `vec` into it: uniform address space alignment rules turn those into silent corruption.
- **Trail fixed point is `TRAIL_SCALE = 1024.0`** in WGSL and `TRAIL_SCALE = 1024` in TypeScript. Both exist already; do not add a third.
- **Dev-only code goes in `src/dev.ts`** and is reached only through `if (import.meta.env.DEV)`, so it is stripped from the production bundle. Verify with `grep -c "__dev" dist/assets/*.js` returning 0.
- **Licensing.** Do not copy from `SebLague/Slime-Simulation` (GPL-3.0), `SuboptimalEng/slime-sim-webgpu` (CC BY-NC-SA 4.0), or `Bleuje/interactive-physarum` (CC BY-NC-SA 3.0). Permissive references that may be read: `amandaghassaei/gpu-io`, `Bewelge/Physarum-WebGL`, `tobiaslrn/physarum`, `fogleman/physarum`, all MIT.
- **Commits.** One commit per task. Verify `git config user.name` is `amit` and `git config user.email` is `amitdas1844@gmail.com` before the first commit. No `Co-authored-by` line, no AI attribution, no generation footer. Push after each task.
- **No em dash (U+2014) anywhere**, including code comments and commit messages.
- **Frame rate numbers only from real Chrome.** The in-app browser pane reports `document.hidden === true` and throttles the GPU. Use `open -a "Google Chrome" "http://localhost:5173/?measure=<name>"`, wait 12 seconds, read `docs/measure-<name>.txt`.

## Before you start

Read the spec named above as well as this plan. Then know these five things,
because none of them are discoverable from the code.

**Start the dev server yourself and check the port.** `npm run dev` prints the
port it got. It uses 5173 unless something already holds it, in which case it
silently takes 5174 and every URL in this plan needs changing to match. Stop any
other copy first.

**The dev tooling lives on `window.__dev`** and only exists in the dev server
build, installed from `src/dev.ts`. What this plan uses:

- `__dev.snapshot()` returns the canvas as a PNG data URL. Draw and read happen
  in one task because a WebGPU canvas is only readable before it presents.
- `__dev.sheet(entries, steps, columns)` grows several forms one after another
  and tiles their snapshots over the page, for judging a sweep side by side. An
  entry is a word, or an object of `Form` overrides with angles in degrees.
- `__dev.save(path, blob)` writes a file into `public/` or `docs/` through the
  dev server.
- `__dev.getSim()`, `__dev.device`, `__dev.getOrganism()`, `__dev.grow(word)`.

**The dev URL parameters**, all stripped from the production build: any `Form`
field by name (`?sensorDist=9&decay=0.85`, angles in degrees), `?tier=0` to
force a particle tier, `?warm=600` to fast-forward that many steps before the
first frame, `?freeze` to stop the clock after the warm-up, `?nogpu` to
rehearse the no-WebGPU fallback, `?measure=<name>` to write the debug overlay
to `docs/measure-<name>.txt` after 12 seconds, `?record=a,b,c` to re-record the
fallback video.

**A hidden tab throttles the GPU and reports nonsense.** The page waits up to 3
seconds for `document.hidden` to be false before benchmarking, so in an
automated browser pane `__dev` can take several seconds to appear. Passing
`?tier=N` skips both the wait and the benchmark, which is why most verification
URLs in this plan carry it. Any frame rate number must come from real Chrome:
`open -a "Google Chrome" "http://localhost:5173/?measure=<name>"`.

**The baseline to beat.** On an M2, `?w=tokyo&warm=300&freeze&tier=3` hashes to
`14a552b5d85c337d` by the snippet in Task 2. On another machine the value
differs; what matters is that it does not move across Tasks 2 and 9.

## File structure

**Created:**
- `src/sim/mapping.ts` - the cover fit between canvas pixels and grid cells, and its inverse. One home for a mapping that exists in two places and must never drift.
- `src/sim/mapping.test.ts` - unit tests for the above.
- `src/pointer.ts` - Pointer Events to feed and wound calls. Owns gesture classification and the idle drift clock. Knows nothing about WebGPU.
- `src/morph.ts` - easing of the look parameters toward a target `Form`.
- `src/morph.test.ts` - unit tests for the above.

**Modified:**
- `src/sim/params.wgsl` - nine new uniform fields.
- `src/sim/diffuse.wgsl` - pointer terms, the activity channel, the island boundary.
- `src/sim/agents.wgsl` - per-particle parameter modulation.
- `src/sim/render.wgsl` - sample two channels, four-layer colour ramp.
- `src/sim/simulation.ts` - the activity buffer, pointer state, the modulation and island parameters, a `setLook` path for morphing.
- `src/main.ts` - wire the pointer, the idle drift and the typing morph.
- `src/ui.ts` - report every keystroke, not only submit.
- `src/seed.ts` - per-family `island` and `modulation` amounts.
- `vite.config.ts` - Vitest configuration.
- `package.json` - the `test` script.
- `NOTES.md` - new measurements and the re-tuned ranges.

---

### Task 1: Test harness and the pointer coordinate mapping

`render.wgsl` fits the square grid over the canvas with a cover fit. Pointer input needs the exact inverse. If the two ever disagree the organism reacts a few cells away from the cursor, which looks like a physics bug rather than a mapping bug and is miserable to find. One module owns both directions and a test pins them together.

**Files:**
- Create: `src/sim/mapping.ts`
- Create: `src/sim/mapping.test.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `coverScale(canvasW: number, canvasH: number, grid: number): number`, `gridFromCanvas(px: number, py: number, canvasW: number, canvasH: number, grid: number): { x: number; y: number }`, `canvasFromGrid(gx: number, gy: number, canvasW: number, canvasH: number, grid: number): { x: number; y: number }`, and `gridFromClient(clientX: number, clientY: number, canvas: HTMLCanvasElement, grid: number): { x: number; y: number }`.

- [ ] **Step 1: Add Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Configure Vitest and add the test script**

Replace the import line at the top of `vite.config.ts`:

```ts
import { defineConfig, type Plugin } from 'vitest/config'
```

Replace the default export at the bottom of `vite.config.ts`:

```ts
export default defineConfig({
  plugins: [saveFromBrowser()],
  test: {
    // Node environment: every test here covers pure functions, no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

In `package.json`, add to `"scripts"`:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Write the failing test**

Create `src/sim/mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { coverScale, gridFromCanvas, canvasFromGrid } from './mapping'

const GRID = 1024

describe('coverScale', () => {
  it('uses the larger ratio, so the grid covers the canvas with no gaps', () => {
    expect(coverScale(2048, 1024, GRID)).toBe(2)
    expect(coverScale(1024, 3072, GRID)).toBe(3)
  })
})

describe('gridFromCanvas', () => {
  it('puts the canvas centre at the grid centre', () => {
    const point = gridFromCanvas(1000, 500, 2000, 1000, GRID)
    expect(point.x).toBeCloseTo(GRID / 2 - 0.5, 6)
    expect(point.y).toBeCloseTo(GRID / 2 - 0.5, 6)
  })

  it('moves one grid cell per scale pixels', () => {
    // A square canvas twice the grid: one grid cell is two canvas pixels.
    const origin = gridFromCanvas(1000, 1000, 2048, 2048, GRID)
    const moved = gridFromCanvas(1002, 1000, 2048, 2048, GRID)
    expect(moved.x - origin.x).toBeCloseTo(1, 6)
  })
})

describe('canvasFromGrid', () => {
  it('is the exact inverse of gridFromCanvas', () => {
    const cases = [
      [0, 0, 1920, 1080],
      [640, 360, 1920, 1080],
      [1919, 1079, 1920, 1080],
      [17, 900, 800, 1600],
    ] as const
    for (const [px, py, w, h] of cases) {
      const grid = gridFromCanvas(px, py, w, h, GRID)
      const back = canvasFromGrid(grid.x, grid.y, w, h, GRID)
      expect(back.x).toBeCloseTo(px, 6)
      expect(back.y).toBeCloseTo(py, 6)
    }
  })
})
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./mapping"`.

- [ ] **Step 5: Write the implementation**

Create `src/sim/mapping.ts`:

```ts
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
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 7: Check the build still type-checks**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git config user.name && git config user.email
git add package.json package-lock.json vite.config.ts src/sim/mapping.ts src/sim/mapping.test.ts
git commit -m "Add the canvas to grid mapping and a test harness for it"
git push
```

---

### Task 2: Grow the uniform struct, changing nothing

The uniform struct grows from 96 to 128 bytes. This is the change most likely to corrupt everything silently, because a mismatch between the `DataView` offsets and the WGSL field order produces wrong numbers rather than an error. Doing it alone, and proving the output is unchanged, means that when something does break later we know it was not this.

**Files:**
- Modify: `src/sim/params.wgsl`
- Modify: `src/sim/simulation.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: uniform fields `pointerX`, `pointerY`, `pointerFeed`, `pointerWound`, `pointerRadius`, `activityDecay`, `islandEdge`, `modulation`, readable from any shader as `params.<name>`. All are `f32` and all are written as 0 by this task.

- [ ] **Step 1: Record the current output hash**

Start the dev server if it is not running: `npm run dev`

Open `http://localhost:5173/?w=tokyo&warm=300&freeze&tier=3`, wait for it to settle, and in the console run:

```js
const u = __dev.snapshot()
const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(u))
Array.from(new Uint8Array(h)).slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('')
```

Write the result down. It was `14a552b5d85c337d` when this plan was written, on an M2. Any machine gives a stable value; what matters is that it does not change in step 5.

- [ ] **Step 2: Replace the tail of the uniform struct**

In `src/sim/params.wgsl`, replace this:

```wgsl
  crowd: f32, // trail amount above which a filament stops attracting
}
```

with this:

```wgsl
  crowd: f32, // trail amount above which a filament stops attracting
  pointerX: f32, // grid coordinates of the pointer
  pointerY: f32,
  pointerFeed: f32, // trail added per step at the pointer, 0 when nothing is touching
  pointerWound: f32, // share of trail destroyed at the pointer, 0 when not wounding
  pointerRadius: f32, // grid cells
  activityDecay: f32, // share of the fast channel kept per step
  islandEdge: f32, // 0 disables the boundary, else radius as a share of the half grid
  modulation: f32, // per-particle parameter variation, 0 is a fixed run
  pad0: u32,
}
```

- [ ] **Step 3: Grow the buffer and write the new fields**

In `src/sim/simulation.ts`, change:

```ts
const PARAMS_BYTES = 96
```

to:

```ts
const PARAMS_BYTES = 128
```

In `writeParams`, immediately after the existing `d.setFloat32(88, look.crowd, true)` line, add:

```ts
    // Pointer and the new look controls. All zero until later tasks set them,
    // so this task changes the layout and nothing else.
    d.setFloat32(92, 0, true)
    d.setFloat32(96, 0, true)
    d.setFloat32(100, 0, true)
    d.setFloat32(104, 0, true)
    d.setFloat32(108, 0, true)
    d.setFloat32(112, 0, true)
    d.setFloat32(116, 0, true)
    d.setFloat32(120, 0, true)
```

- [ ] **Step 4: Type-check and build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Verify the output is unchanged**

Reload `http://localhost:5173/?w=tokyo&warm=300&freeze&tier=3` and run the same console snippet from step 1.

Expected: exactly the hash from step 1. If it differs, an offset is wrong. Recheck that every `setFloat32` and `setUint32` offset in `writeParams` matches the field order in `params.wgsl`, counting 4 bytes per field from 0.

- [ ] **Step 6: Commit**

```bash
git add src/sim/params.wgsl src/sim/simulation.ts
git commit -m "Grow the uniform struct for pointer input and the new look controls"
git push
```

---

### Task 3: Feed and wound in the diffuse pass

Both effects become extra terms in the pass that already visits every cell, so there is no new dispatch and no new buffer. This task adds the shader work and an API to drive it. The DOM events come next, so this is verified from the console.

**Files:**
- Modify: `src/sim/diffuse.wgsl`
- Modify: `src/sim/simulation.ts`

**Interfaces:**
- Consumes: the uniform fields from Task 2.
- Produces: on `Simulation`, `setPointer(x: number, y: number, strength: number): void` where `x` and `y` are grid coordinates and `strength` is 0 to 1, and `wound(x: number, y: number): void`. Both are no-ops outside the grid.

- [ ] **Step 1: Add the pointer terms to the diffuse shader**

In `src/sim/diffuse.wgsl`, replace these two lines:

```wgsl
  let blurred = f32(sum) * (params.decay / 9.0);
  trailOut[gid.y * params.gridW + gid.x] = u32(min(blurred, f32(CELL_MAX)));
```

with this:

```wgsl
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
```

- [ ] **Step 2: Add the pointer state and API to the simulation**

In `src/sim/simulation.ts`, add these constants next to the other constants near the top:

```ts
// Pointer tuning, in grid cells and trail units. Found by eye; see NOTES.md.
const FEED_RADIUS = 30
const FEED_STRENGTH = 5
const WOUND_RADIUS = 55
const WOUND_STEPS = 3
```

Add these fields to the class, next to `private frame = 0`:

```ts
  private pointerX = 0
  private pointerY = 0
  private pointerFeed = 0
  private pointerRadius = FEED_RADIUS
  private woundLeft = 0
```

Add these two methods to the class, next to `transitionTo`:

```ts
  // Feed the organism at a point. Strength 0 stops feeding. Grid coordinates.
  setPointer(x: number, y: number, strength: number): void {
    this.pointerX = x
    this.pointerY = y
    this.pointerFeed = Math.max(0, Math.min(1, strength)) * FEED_STRENGTH
  }

  // Tear a hole. It applies over a few steps so it is unmistakable, then heals.
  wound(x: number, y: number): void {
    this.pointerX = x
    this.pointerY = y
    this.woundLeft = WOUND_STEPS
  }
```

- [ ] **Step 3: Write the pointer fields into the uniform**

In `writeParams`, replace the eight zero writes added in Task 2 with:

```ts
    const wounding = this.woundLeft > 0
    d.setFloat32(92, this.pointerX, true)
    d.setFloat32(96, this.pointerY, true)
    d.setFloat32(100, wounding ? 0 : this.pointerFeed, true)
    d.setFloat32(104, wounding ? 1 : 0, true)
    d.setFloat32(108, wounding ? WOUND_RADIUS : this.pointerRadius, true)
    d.setFloat32(112, 0, true)
    d.setFloat32(116, 0, true)
    d.setFloat32(120, 0, true)
```

- [ ] **Step 4: Count the wound down**

In `step()`, immediately after the existing `this.frame += 1` line, add:

```ts
    if (this.woundLeft > 0) this.woundLeft -= 1
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds. A WGSL error surfaces on the page rather than in this command, so also reload the dev server page and confirm no "Shader failed to compile" message appears on screen.

- [ ] **Step 6: Verify feeding by hand**

Open `http://localhost:5173/?w=ocean&warm=300` and run in the console:

```js
__dev.getSim().setPointer(512, 512, 1)
```

Expected: within about a second, filaments visibly converge on the centre of the field and a bright knot forms there. Then:

```js
__dev.getSim().setPointer(512, 512, 0)
```

Expected: the knot disperses over a few seconds.

- [ ] **Step 7: Verify wounding by hand**

```js
__dev.getSim().wound(512, 512)
```

Expected: a dark circular hole appears at the centre immediately, and closes over roughly five seconds.

If feeding is too weak to see, raise `FEED_STRENGTH`; if it swallows the whole organism, lower it. Record whatever value you settle on in the constant's comment.

- [ ] **Step 8: Check the frame rate did not move**

```bash
open -a "Google Chrome" "http://localhost:5173/?measure=m2-pointer"
```

Wait 12 seconds, then `cat docs/measure-m2-pointer.txt`.
Expected: 60 fps at the same tier as before this task. The work added is per cell and the cell count did not change, so any drop means something else is wrong.

- [ ] **Step 9: Commit**

```bash
rm -f docs/measure-m2-pointer.txt
git add src/sim/diffuse.wgsl src/sim/simulation.ts
git commit -m "Let the pointer feed and wound the organism"
git push
```

---

### Task 4: Pointer events and idle drift

Wire real input to the API from Task 3. Pointer Events only, so mouse, touch and pen take one path. When nobody has touched it for a few seconds, an invisible attractant wanders the field so the organism is never still.

**Files:**
- Create: `src/pointer.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `gridFromClient` from Task 1; `setPointer` and `wound` from Task 3.
- Produces: `attachPointer(canvas: HTMLCanvasElement, grid: number, handlers: PointerHandlers): void`, where `PointerHandlers` is `{ feed(x: number, y: number, strength: number): void; wound(x: number, y: number): void; touched(): void }`.

- [ ] **Step 1: Write the pointer module**

Create `src/pointer.ts`:

```ts
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
```

- [ ] **Step 2: Wire it up with idle drift**

In `src/main.ts`, add to the imports at the top:

```ts
import { attachPointer } from './pointer'
```

Add these constants next to the other constants near the top:

```ts
// After this long with no input, an invisible attractant wanders the field so
// the organism is never completely still.
const IDLE_AFTER_MS = 4000
const IDLE_STRENGTH = 0.22
```

Immediately after the existing `ui.showWord(organism.word, linked !== null)` line, add:

```ts
  let lastInputAt = performance.now()
  attachPointer(canvas, GRID, {
    feed: (x, y, strength) => sim.setPointer(x, y, strength),
    wound: (x, y) => sim.wound(x, y),
    touched: () => (lastInputAt = performance.now()),
  })
```

Inside the `frame` function, immediately before the existing `sim.draw(` line, add:

```ts
    // Idle drift. A Lissajous path never repeats on a short cycle, so the
    // organism keeps reorganizing instead of settling into one shape.
    if (now - lastInputAt > IDLE_AFTER_MS) {
      const t = now / 1000
      sim.setPointer(
        GRID * (0.5 + 0.3 * Math.sin(t * 0.21)),
        GRID * (0.5 + 0.3 * Math.sin(t * 0.13 + 1.7)),
        IDLE_STRENGTH,
      )
    }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Verify on a desktop pointer**

Open `http://localhost:5173/` in Chrome. Move the mouse across the canvas without pressing.
Expected: filaments lean toward the cursor.

Press and drag.
Expected: the organism follows the cursor clearly, a bright trail forming along the drag path.

Click once without moving.
Expected: a dark hole at the click point that heals over a few seconds.

Leave it alone for five seconds.
Expected: the organism keeps slowly reorganizing rather than freezing.

- [ ] **Step 5: Verify on touch**

In Chrome, open devtools, toggle device emulation to a phone, and reload. Drag a finger across the canvas.
Expected: the organism follows, and the page itself does not scroll or rubber-band.

- [ ] **Step 6: Verify the text input still works**

Type a word and press Enter.
Expected: the entrance runs and the caption updates, exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/pointer.ts src/main.ts
git commit -m "Wire pointer and touch input, and drift when nobody is touching"
git push
```

---

### Task 5: Typing reshapes the organism

Every keystroke eases the look parameters toward the prefix's values. The seed, start shape and heading are untouched, so nothing is repositioned and no trail is cleared: the organism reshapes rather than restarting. Enter still commits the real organism through the existing path.

Note: `hue` is a 0 to 1 blend between the blue and green ends of the ramp, not an angle, so it is a plain linear ease with no wraparound.

**Files:**
- Create: `src/morph.ts`
- Create: `src/morph.test.ts`
- Modify: `src/sim/simulation.ts`
- Modify: `src/ui.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Form` from `src/sim/simulation.ts`, `organismFor` from `src/seed.ts`.
- Produces: `easeLook(current: Form, target: Form, rate: number): void`, which mutates `current` in place. On `Simulation`, `setLook(form: Form): void`, and a public getter `look: Form`. On `UiHandlers`, a new member `onType(word: string): void`.

- [ ] **Step 1: Write the failing test**

Create `src/morph.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { easeLook, LOOK_KEYS } from './morph'
import type { Form } from './sim/simulation'

const form = (overrides: Partial<Form> = {}): Form => ({
  seed: 1,
  startShape: 0,
  heading: 0,
  shapeSize: 0.5,
  sensorAngle: 0.5,
  sensorDist: 20,
  turnAngle: 0.2,
  stepSize: 2,
  decay: 0.8,
  crowd: 12,
  exposure: 0.08,
  hue: 0,
  ...overrides,
})

describe('easeLook', () => {
  it('moves the look parameters a share of the way toward the target', () => {
    const current = form({ sensorDist: 20 })
    easeLook(current, form({ sensorDist: 40 }), 0.25)
    expect(current.sensorDist).toBeCloseTo(25, 6)
  })

  it('converges on the target when applied repeatedly', () => {
    const current = form({ hue: 0 })
    const target = form({ hue: 1 })
    for (let i = 0; i < 200; i++) easeLook(current, target, 0.12)
    expect(current.hue).toBeCloseTo(1, 4)
  })

  it('never touches the seed parameters, so nothing is repositioned', () => {
    const current = form({ seed: 111, startShape: 0, heading: 0, shapeSize: 0.5 })
    easeLook(current, form({ seed: 999, startShape: 2, heading: 3, shapeSize: 0.9 }), 1)
    expect(current.seed).toBe(111)
    expect(current.startShape).toBe(0)
    expect(current.heading).toBe(0)
    expect(current.shapeSize).toBe(0.5)
  })

  it('eases every key it claims to ease', () => {
    const current = form()
    const target = form({
      sensorAngle: 1,
      sensorDist: 50,
      turnAngle: 1,
      stepSize: 3,
      decay: 0.95,
      crowd: 25,
      exposure: 0.2,
      hue: 1,
    })
    easeLook(current, target, 1)
    for (const key of LOOK_KEYS) {
      expect(current[key]).toBeCloseTo(target[key], 6)
    }
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./morph"`.

- [ ] **Step 3: Write the implementation**

Create `src/morph.ts`:

```ts
import type { Form } from './sim/simulation'

// While the visitor types, the organism reshapes instead of restarting. Only the
// parameters that decide the form move; the ones that decide the arrangement do
// not, so no particle is repositioned and no trail is cleared.
//
// hue is a 0 to 1 blend between the blue and green ends of the colour ramp, not
// an angle, so it eases linearly with no wraparound.

export const LOOK_KEYS = [
  'sensorAngle',
  'sensorDist',
  'turnAngle',
  'stepSize',
  'decay',
  'crowd',
  'exposure',
  'hue',
] as const

export type LookKey = (typeof LOOK_KEYS)[number]

// Moves `current` a share of the remaining distance toward `target`, in place.
// A rate of 0.12 per frame converges in about a third of a second at 60 fps.
export function easeLook(current: Form, target: Form, rate: number): void {
  const share = Math.max(0, Math.min(1, rate))
  for (const key of LOOK_KEYS) {
    current[key] += (target[key] - current[key]) * share
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS, 8 tests total across both files.

- [ ] **Step 5: Let the simulation take a new look**

In `src/sim/simulation.ts`, add this method to the class, next to `transitionTo`:

```ts
  // Replace the parameters that decide the form, leaving the arrangement alone.
  // Used while typing, so the organism reshapes without restarting.
  setLook(form: Form): void {
    this.form = { ...this.form, ...form, seed: this.form.seed }
  }

  get look(): Form {
    return this.form
  }
```

- [ ] **Step 6: Report every keystroke from the UI**

In `src/ui.ts`, add to the `UiHandlers` interface:

```ts
  onType(word: string): void
```

Add this inside `createUi`, immediately before the existing `form.addEventListener('submit'` line:

```ts
  // Every keystroke, not only submit: the organism reshapes as the word is typed.
  input.addEventListener('input', () => handlers.onType(normalizeWord(input.value)))
```

- [ ] **Step 7: Wire the morph into the frame loop**

In `src/main.ts`, add to the imports:

```ts
import { easeLook } from './morph'
```

Add this constant next to the others:

```ts
// Share of the remaining distance the look covers each frame while typing.
const MORPH_RATE = 0.12
```

In the `createUi` call near the top, add the new handler:

```ts
  onType: (word) => typeTarget(word),
```

Add this next to the other deferred handlers, beside `let grow`:

```ts
// Typed characters before the GPU is ready are ignored; the committed word is queued instead.
let typeTarget: (word: string) => void = () => undefined
```

Immediately after the existing `attachPointer(` block from Task 4, add:

```ts
  let morphTo: Form | null = null
  typeTarget = (word) => {
    morphTo = word ? organismOf(word).form : null
  }
```

Inside the `frame` function, immediately before the existing `sim.draw(` line, add:

```ts
    if (morphTo) {
      const live = { ...sim.look }
      easeLook(live, morphTo, MORPH_RATE)
      sim.setLook(live)
    }
```

In the existing `grow` function, add this as its first line, so committing a word stops the morph:

```ts
    morphTo = null
```

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 9: Verify typing reshapes**

Open `http://localhost:5173/` and type `ocean` one letter at a time, pausing briefly between letters.
Expected: the network visibly reshapes after each letter, smoothly, with no flicker and no reseeding. The organism does not jump or restart.

Press Enter.
Expected: the full entrance runs, particles stream, and the caption updates.

- [ ] **Step 10: Verify reproducibility still holds**

Open `http://localhost:5173/?w=tokyo&warm=300&freeze&tier=3` and take the snapshot hash as in Task 2 step 1.

Then open `http://localhost:5173/?tier=3`, type `tokyo`, press Enter, and in the console run:

```js
const s = __dev.getSim()
for (let i = 0; i < 350; i++) s.step()
await s.idle()
const u = __dev.snapshot()
const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(u))
;[s.frameCount, Array.from(new Uint8Array(h)).slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('')]
```

Expected: `frameCount` is 300 and the hash matches the share-link hash exactly. A committed word must still be a pure function of the word, uninfluenced by what was typed on the way there.

- [ ] **Step 11: Commit**

```bash
git add src/morph.ts src/morph.test.ts src/sim/simulation.ts src/ui.ts src/main.ts
git commit -m "Reshape the organism on every keystroke"
git push
```

---

### Task 6: The activity channel

One extra buffer holds a fast-decaying record of where particles moved recently. Each cell reads and writes only its own slot, so it updates in place and needs no ping-pong. Nothing is drawn with it yet; that is the next task.

**Files:**
- Modify: `src/sim/simulation.ts`
- Modify: `src/sim/diffuse.wgsl`

**Interfaces:**
- Consumes: the `activityDecay` uniform from Task 2.
- Produces: an activity buffer bound at `@binding(4)` of the diffuse bind group as `storage, read_write`, and at `@binding(2)` of the render bind group as `storage, read`. Its values are in the same fixed point as the trail.

- [ ] **Step 1: Add the buffer and bindings**

In `src/sim/simulation.ts`, add this constant next to the others:

```ts
// Share of the fast channel kept per step. About 0.86 holds half a second at 60 fps.
const ACTIVITY_DECAY = 0.86
```

Add the field to the class next to `depositBuffer`:

```ts
  private readonly activityBuffer: GPUBuffer
```

In the constructor, immediately after the existing `this.depositBuffer = device.createBuffer({` block, add:

```ts
    this.activityBuffer = device.createBuffer({
      label: 'activity',
      size: cells * 4,
      usage: trailUsage,
    })
```

Add it to the destroy list by changing:

```ts
    this.buffers = [this.paramsBuffer, particles, this.depositBuffer, ...trails]
```

to:

```ts
    this.buffers = [this.paramsBuffer, particles, this.depositBuffer, this.activityBuffer, ...trails]
```

In the `diffuseLayout` entries array, add a fifth entry:

```ts
        { binding: 4, visibility: COMPUTE, buffer: readWrite },
```

In the `renderLayout` entries array, add a third entry:

```ts
        { binding: 2, visibility: FRAGMENT, buffer: readOnly },
```

In the `this.diffuseGroups` bind groups, add to each entries array:

```ts
          { binding: 4, resource: { buffer: this.activityBuffer } },
```

In the `this.renderGroups` bind groups, add to each entries array:

```ts
          { binding: 2, resource: { buffer: this.activityBuffer } },
```

- [ ] **Step 2: Clear it on reset**

In `runInit`, change:

```ts
    for (const trail of this.trails) encoder.clearBuffer(trail)
```

to:

```ts
    for (const trail of this.trails) encoder.clearBuffer(trail)
    encoder.clearBuffer(this.activityBuffer)
```

- [ ] **Step 3: Write the decay into the uniform**

In `writeParams`, change the `d.setFloat32(112, 0, true)` line to:

```ts
    d.setFloat32(112, ACTIVITY_DECAY, true)
```

- [ ] **Step 4: Update it in the diffuse pass**

In `src/sim/diffuse.wgsl`, add the new binding after the existing four:

```wgsl
@group(0) @binding(4) var<storage, read_write> activity: array<u32>;
```

At the very end of the `diffuse` function, after the `trailOut[...]` assignment, add:

```wgsl
  // The fast channel: where particles moved in roughly the last half second.
  // Each invocation touches only its own cell, so updating in place is safe and
  // no second buffer is needed.
  let index = gid.y * params.gridW + gid.x;
  let recent = f32(activity[index]) * params.activityDecay + f32(min(deposits[index], CELL_MAX >> 1u));
  activity[index] = u32(min(recent, f32(CELL_MAX)));
```

- [ ] **Step 5: Add the binding to the render shader so it validates**

In `src/sim/render.wgsl`, add after the existing `trail` binding:

```wgsl
@group(0) @binding(2) var<storage, read> activity: array<u32>;
```

Nothing reads it yet. WebGPU does not require a shader to use every binding in its layout, but the binding must exist in the layout, which step 1 did.

- [ ] **Step 6: Build and check for validation errors**

Run: `npm run build`
Then reload `http://localhost:5173/`.
Expected: no "WebGPU validation failed" message on the page and no console errors. The image looks exactly as it did before, since nothing draws the new channel yet.

- [ ] **Step 7: Confirm the channel actually holds something**

In the console:

```js
__dev.getSim().frameCount
```

Then check the frame rate has not dropped:

```bash
open -a "Google Chrome" "http://localhost:5173/?measure=m2-activity"
```

Wait 12 seconds, then `cat docs/measure-m2-activity.txt`.
Expected: 60 fps at the same tier.

- [ ] **Step 8: Commit**

```bash
rm -f docs/measure-m2-activity.txt
git add src/sim/simulation.ts src/sim/diffuse.wgsl src/sim/render.wgsl
git commit -m "Add a fast activity channel alongside the trail"
git push
```

---

### Task 7: Draw the flow

The renderer samples both channels and the colour ramp becomes four layers: halo, body, core and flow. This is the task that turns a flat texture into something that reads as circulating.

**Files:**
- Modify: `src/sim/render.wgsl`

**Interfaces:**
- Consumes: the activity binding from Task 6.
- Produces: nothing new. The shader's existing entry points are unchanged.

- [ ] **Step 1: Make the samplers return both channels**

In `src/sim/render.wgsl`, replace the `cell`, `bilinear` and `bicubic` functions with these. The change is that each returns `vec2<f32>`, holding trail in `x` and activity in `y`, so both channels are filtered identically in one pass.

```wgsl
fn cell(x: i32, y: i32) -> vec2<f32> {
  let w = i32(params.gridW);
  let h = i32(params.gridH);
  let cx = ((x % w) + w) % w;
  let cy = ((y % h) + h) % h;
  let index = u32(cy * w + cx);
  return vec2<f32>(f32(trail[index]), f32(activity[index])) / TRAIL_SCALE;
}

fn bilinear(g: vec2<f32>) -> vec2<f32> {
  let base = floor(g);
  let f = g - base;
  let x = i32(base.x);
  let y = i32(base.y);
  let top = mix(cell(x, y), cell(x + 1, y), f.x);
  let bottom = mix(cell(x, y + 1), cell(x + 1, y + 1), f.x);
  return mix(top, bottom, f.y);
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
```

- [ ] **Step 2: Rewrite the colour ramp**

Replace the body of the `fragment` function from `var value: f32;` down to but not including the `// A little noise` comment with:

```wgsl
  var sampled: vec2<f32>;
  if (params.quality == 1u) {
    sampled = bicubic(g);
  } else {
    sampled = bilinear(g);
  }
  let value = sampled.x;
  // The fast channel is far dimmer than the trail, so it is normalized against
  // the same exposure before being used as a highlight.
  let motion = 1.0 - exp(-max(sampled.y, 0.0) * params.exposure * 2.5);

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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Then reload the page and confirm no shader compile message appears.

- [ ] **Step 4: Verify flow is visible**

Open `http://localhost:5173/?w=ocean&warm=300` and watch for ten seconds without touching anything.
Expected: bright highlights travel along the filaments. The structure itself is recognizably the same organism as before; the difference is movement along it, not a different shape.

Drag the pointer across the canvas.
Expected: a bright streak of flow follows the drag, clearly brighter than the resting filaments.

- [ ] **Step 5: Check it does not look like noise at the lowest tier**

Open `http://localhost:5173/?w=ocean&warm=300&tier=0`.
Expected: flow reads as movement, not as static. If it sparkles like noise, reduce the `2.5` multiplier on `motion` and note the value you chose.

- [ ] **Step 6: Check the poster path**

In the console:

```js
const m = await import('/src/export.ts')
const blob = await m.renderPoster(__dev.device, __dev.getSim(), 2048, 'ocean')
await __dev.save('docs/flow-check.png', blob)
```

Open `docs/flow-check.png`.
Expected: a clean 2048 poster with no ringing artefacts around bright filaments. The bicubic path now filters two channels; ringing would show as dark halos.

- [ ] **Step 7: Check the frame rate**

```bash
open -a "Google Chrome" "http://localhost:5173/?measure=m2-flow"
```

Wait 12 seconds, then `cat docs/measure-m2-flow.txt`.
Expected: 60 fps at the same tier. The render pass now reads one more buffer per sample, which is 4 extra reads bilinear and 16 bicubic.

- [ ] **Step 8: Commit**

```bash
rm -f docs/measure-m2-flow.txt docs/flow-check.png
git add src/sim/render.wgsl
git commit -m "Show flow travelling along the filaments"
git push
```

---

### Task 8: The island boundary

An optional soft circular edge, so a colony has a silhouette instead of bleeding off every side. Off by default; each family opts in.

**Files:**
- Modify: `src/sim/diffuse.wgsl`
- Modify: `src/sim/simulation.ts`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: the `islandEdge` uniform from Task 2.
- Produces: an optional `island?: number` on the `Family` interface in `src/seed.ts`, and `island: number` on `Form`, where 0 disables the boundary and a positive value is the radius as a share of the half grid.

- [ ] **Step 1: Add the term to the diffuse shader**

In `src/sim/diffuse.wgsl`, immediately after the pointer block added in Task 3 and before the `trailOut[...]` assignment, add:

```wgsl
  // An optional soft edge, so the colony has a silhouette rather than filling
  // the frame. Trail outside the edge dies faster instead of being cut off,
  // which keeps the boundary organic rather than a hard circle.
  if (params.islandEdge > 0.0) {
    let grid = vec2<f32>(f32(params.gridW), f32(params.gridH));
    let centred = vec2<f32>(f32(gid.x), f32(gid.y)) - grid * 0.5;
    let radius = min(grid.x, grid.y) * 0.5 * params.islandEdge;
    let r = length(centred) / max(radius, 1.0);
    value *= 1.0 - smoothstep(0.85, 1.2, r) * 0.92;
  }
```

- [ ] **Step 2: Carry it on the Form**

In `src/sim/simulation.ts`, add to the `Form` interface, after `crowd`:

```ts
  island: number // 0 fills the frame, else the colony's radius as a share of the half grid
```

In `writeParams`, change the `d.setFloat32(116, 0, true)` line to:

```ts
    d.setFloat32(116, look.island, true)
```

- [ ] **Step 3: Let families opt in**

In `src/seed.ts`, add to the `Family` interface, next to `brightness`:

```ts
  island?: number // colony radius as a share of the half grid; omit to fill the frame
```

Add `island: 0.62,` to the `veins` family and to the `urchin` family, which are the two that already read as a single organism rather than a field.

In `organismFor`, add to the returned `form` object, after `crowd,`:

```ts
      island: family.island ?? 0,
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds. If TypeScript complains about `island` missing on a `Form` literal, the test fixture in `src/morph.test.ts` needs `island: 0` adding; do that.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. `island` is not a look key, so `easeLook` must not touch it, and the "never touches the seed parameters" test still passes.

- [ ] **Step 6: Verify the silhouette**

Open `http://localhost:5173/?w=videosdk&warm=400` (the `veins` family).
Expected: the colony has a visible soft edge with dark space around it, rather than running off all four sides.

Open `http://localhost:5173/?w=ocean&warm=400` (the `membrane` family, which does not opt in).
Expected: unchanged, still filling the frame.

- [ ] **Step 7: Commit**

```bash
git add src/sim/diffuse.wgsl src/sim/simulation.ts src/seed.ts src/morph.test.ts
git commit -m "Give opted-in families a soft edge instead of filling the frame"
git push
```

---

### Task 9: Per-particle parameter modulation, landing switched off

Each particle varies its own sensing and movement from the trail value it is standing in. It lands with the amount at 0 for every family, which must reproduce the current output byte for byte. Switching it on is the next task, so that a regression here is impossible to confuse with a tuning change.

**Files:**
- Modify: `src/sim/agents.wgsl`
- Modify: `src/sim/simulation.ts`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: the `modulation` uniform from Task 2.
- Produces: an optional `modulation?: number` on `Family`, and `modulation: number` on `Form`, 0 to 1.

- [ ] **Step 1: Record the hash to beat**

Open `http://localhost:5173/?w=tokyo&warm=300&freeze&tier=3` and take the snapshot hash as in Task 2 step 1. Write it down.

- [ ] **Step 2: Modulate the parameters in the agent shader**

In `src/sim/agents.wgsl`, inside `fn step`, replace these lines:

```wgsl
  let ahead = sense(pos, p.angle);
  let left = sense(pos, p.angle + params.sensorAngle);
  let right = sense(pos, p.angle - params.sensorAngle);
```

with:

```wgsl
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
```

Further down in the same function, replace:

```wgsl
    p.angle += select(-params.turnAngle, params.turnAngle, (coin & 1u) == 1u);
```

with:

```wgsl
    p.angle += select(-turnAngle, turnAngle, (coin & 1u) == 1u);
```

replace:

```wgsl
  } else if (left > right) {
    p.angle += params.turnAngle;
  } else if (right > left) {
    p.angle -= params.turnAngle;
  }
```

with:

```wgsl
  } else if (left > right) {
    p.angle += turnAngle;
  } else if (right > left) {
    p.angle -= turnAngle;
  }
```

and replace:

```wgsl
  let next = wrap(pos + vec2<f32>(cos(p.angle), sin(p.angle)) * params.stepSize);
```

with:

```wgsl
  let next = wrap(pos + vec2<f32>(cos(p.angle), sin(p.angle)) * stepSize);
```

- [ ] **Step 3: Let the sensing function take a distance**

Still in `src/sim/agents.wgsl`, replace the whole `sense` function:

```wgsl
fn sense(pos: vec2<f32>, angle: f32) -> f32 {
```

with a version that takes the distance as a parameter, since it is now per particle:

```wgsl
fn senseAt(pos: vec2<f32>, angle: f32, dist: f32) -> f32 {
  let p = wrap(pos + vec2<f32>(cos(angle), sin(angle)) * dist);
  // Attraction rises with the trail up to `crowd`, then falls: an overcrowded
  // filament pushes particles off to found new ones, which keeps networks fine.
  let value = f32(trail[cellIndex(p)]) / TRAIL_SCALE;
  return min(value, 2.0 * params.crowd - value);
}
```

Delete the old `sense` function entirely. It has no other callers.

- [ ] **Step 4: Carry modulation on the Form**

In `src/sim/simulation.ts`, add to the `Form` interface, after `island`:

```ts
  modulation: number // per-particle parameter variation, 0 to 1
```

In `writeParams`, change the `d.setFloat32(120, 0, true)` line to:

```ts
    d.setFloat32(120, look.modulation, true)
```

- [ ] **Step 5: Default every family to zero**

In `src/seed.ts`, add to the `Family` interface:

```ts
  modulation?: number // per-particle parameter variation; set per family after a sweep
```

In `organismFor`, add to the returned `form` object, after `island`:

```ts
      modulation: family.modulation ?? 0,
```

Do not set `modulation` on any family yet. That is the next task.

- [ ] **Step 6: Build and test**

Run: `npm run build && npm test`
Expected: both succeed. If TypeScript complains about `modulation` missing on the `Form` fixture in `src/morph.test.ts`, add `modulation: 0` to it.

- [ ] **Step 7: Verify nothing changed**

Reload `http://localhost:5173/?w=tokyo&warm=300&freeze&tier=3` and take the snapshot hash again.

Expected: exactly the hash from step 1. If it differs, the refactor changed behaviour somewhere; the usual cause is a `params.turnAngle` or `params.stepSize` reference left behind. Search the file: `grep -n "params.sensorAngle\|params.sensorDist\|params.turnAngle\|params.stepSize" src/sim/agents.wgsl` should return only the four lines inside the modulation block.

- [ ] **Step 8: Verify the modulation actually does something**

Open `http://localhost:5173/?w=tokyo&warm=400&modulation=0.6&tier=3`.
Expected: visibly different from `modulation=0`, with detail at more than one scale. This uses the existing dev URL override, which works because `modulation` is a `Form` field.

- [ ] **Step 9: Commit**

```bash
git add src/sim/agents.wgsl src/sim/simulation.ts src/seed.ts src/morph.test.ts
git commit -m "Let each particle set its own sensing and step from the local trail"
git push
```

---

### Task 10: Re-tune the families and switch modulation on

Feature 8 changes what every family's ranges produce, so the sweep that found them has to be re-run. Modulation is set family by family against a contact sheet, not globally.

**Files:**
- Modify: `src/seed.ts`
- Modify: `NOTES.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no new interfaces. Tuned constants and recorded measurements.

- [ ] **Step 1: Sweep modulation on one family**

Open `http://localhost:5173/?tier=3` and in the console:

```js
await __dev.sheet(
  [0, 0.2, 0.4, 0.6, 0.8, 1].map((m) => ({ modulation: m, sensorAngle: 35, sensorDist: 30, turnAngle: 12, stepSize: 2, decay: 0.75, crowd: 25, startShape: 0, heading: 0, shapeSize: 0.45 })),
  450,
  3,
)
```

Look at the six tiles. Note the highest modulation value that still produces a coherent network rather than mush. That is the ceiling for this family.

- [ ] **Step 2: Repeat for the other nine families**

Run the same sweep for each family in `FAMILIES`, substituting that family's mid-range values. Ten sweeps. Record the chosen amount per family.

- [ ] **Step 3: Set the amounts**

In `src/seed.ts`, add `modulation: <value>,` to each family that benefits. Leave it off any family that looked better without it; `?? 0` already covers that case.

- [ ] **Step 4: Check the ten words still differ**

```js
await __dev.sheet(['physarum', 'videosdk', 'amit', 'hello', 'love', 'ocean', 'coffee', 'tokyo', 'music', 'rain'], 450)
```

Expected: ten visibly different organisms, at least as varied as before. If modulation has made several families converge on a similar look, reduce the amounts on the ones that collided.

- [ ] **Step 5: Check they survive a long run**

```js
window.__done = false
__dev.sheet(['physarum', 'amit', 'ocean', 'zero', 'rain', 'hello', 'tokyo', 'coffee'], 1800).then(() => (window.__done = true))
```

Wait for `window.__done` to be `true`, which takes about 45 seconds, then look.
Expected: all eight still coherent after 30 seconds of simulated growth.

- [ ] **Step 6: Measure the cost**

```bash
open -a "Google Chrome" "http://localhost:5173/?measure=m2-modulation"
```

Wait 12 seconds, then `cat docs/measure-m2-modulation.txt`. Repeat with `&tier=4` for the 2M tier.
Expected: record whatever the numbers are. Modulation adds roughly a dozen instructions per particle per step, so a drop at the top tier would not be surprising, and the startup benchmark handles it automatically since it times real steps.

- [ ] **Step 7: Update NOTES.md**

Add a row per measurement to the performance table with today's date. Add a `Modulation` column to the families table with each family's amount. Add to the parameter sweep section, above "What did not work":

```markdown
7. **Per-particle modulation.** Varying sensor distance, sensor angle, turn
   angle and step size per particle from the locally sensed trail value. This is
   the difference between one scale of structure and several in the same image.
   Amounts above about <value> turn coherent networks into mush; the ceiling
   differs per family and is recorded in the families table.
```

Replace `<value>` with what the sweeps actually showed.

Add to the checks list, with today's date: pointer feeding and wounding verified, typing morph verified, a committed word still byte-identical to its share link, and flow visible at every tier.

- [ ] **Step 8: Update README.md**

Under "How it works", after the paragraph about crowding, add:

```markdown
Two further departures from the base model. Each particle varies its own sensor
distance, sensor angle, turn angle and step size according to the trail value it
senses locally, so one image carries fine detail where the network is crowded
and long reaching filaments where it is empty. And the pointer injects trail
directly into the field, so dragging feeds the organism and a click tears a hole
it then grows back into.
```

Under "The same word grows the same organism", add:

```markdown
Touching the organism breaks this by design. A fed or wounded organism is no
longer purely a function of its word. The share link is unaffected, because it
always grows from step zero and pointer input is never encoded in it.
```

In the credits list, add:

```markdown
- Per-particle parameter modulation follows an idea described by Sage Jenson.
  No source was published for it, so the implementation here is our own.
```

- [ ] **Step 9: Final check that nothing regressed**

Run: `npm run build && npm test`
Expected: both pass.

```bash
grep -c "__dev" dist/assets/*.js
```

Expected: 0. Dev tooling must not reach production.

Open `http://localhost:5173/?nogpu` and confirm the fallback video still plays.

- [ ] **Step 10: Commit**

```bash
rm -f docs/measure-m2-modulation.txt
git add src/seed.ts NOTES.md README.md
git commit -m "Tune per-particle modulation per family and record the measurements"
git push
```

---

## Phase one is done when

- Dragging moves the organism, clicking wounds it, and it heals.
- Typing reshapes it on every keystroke, and Enter still produces an image byte-identical to the word's share link.
- Flow is visible travelling along the filaments at every tier.
- Ten words still produce ten visibly different organisms, now with detail at more than one scale.
- `npm run build` and `npm test` both pass, the production bundle contains no dev tooling, and the no-WebGPU fallback still plays.
- `NOTES.md` carries real measurements for every change, taken in real Chrome.

Phase two, name mode and two competing species, gets its own plan written against the tuning this phase produces.
