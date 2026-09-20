# Seed: interactivity and depth

Design for the second build of Seed, the WebGPU Physarum page. The first build
grows an organism from a typed word and lets you save a poster. It has no
interaction beyond the text input, and most families render as flat texture
rather than as a living thing.

This design adds seven features in three phases. Each phase ends in a working,
committed, verifiable state.

## Goals

1. The visitor can touch the organism and it responds.
2. The organism reads as alive: flow is visible, and it has an edge.
3. Typing itself produces feedback, not a wait.
4. The visitor's name can appear inside the organism as negative space.
5. Two words can share one arena and compete.
6. The takeaway is a short video loop, not only a still.
7. Other words are visible, so "every word is different" is provable on sight.

## Non-goals

- No backend, no accounts, no analytics beyond what the host provides. The page
  stays a static site on the free tier.
- No microphone, camera, geolocation or motion permission prompts. A shared link
  gets one chance, and a permission dialog spends it.
- No WebGL2 fallback. Browsers without WebGPU keep the recorded video.
- No per-word social preview image. Still out of scope, same reason as before:
  it would mean drawing the art a second way.

## Current architecture, for reference

Four WGSL files and one TypeScript class own the simulation.

- `params.wgsl` holds a 96 byte uniform struct shared by every pass, written
  from a `DataView` in `simulation.ts`. Fields are all 4 byte scalars, so the
  layout has no padding surprises.
- `agents.wgsl` has three entry points: `init` seeds particles from a PCG hash,
  `gather` streams them toward a new arrangement during a transition, and `step`
  senses, turns, moves and deposits.
- `diffuse.wgsl` runs over every cell: it blurs the sum of last frame's trail
  and this frame's deposits with a 3 by 3 box, scales by the decay factor, and
  writes to the other ping-pong buffer.
- `render.wgsl` reads a trail buffer, fits the square grid over the canvas,
  filters by hand, and maps through the color ramp.
- `simulation.ts` owns the buffers, pipelines, two bind groups per pass for the
  ping-pong, the frame counter and the brightness envelope.

Trail cells are `atomic<u32>` in fixed point, 1024 units to 1.0. The grid is
1024 by 1024 at every tier. Particle tiers run 150k to 2M and are chosen by a
startup benchmark.

Two facts constrain everything below. WGSL has no texture atomics, which is why
the trail is a buffer. And particles read last frame's trail while writing into
a separate deposit buffer, which is what makes a word reproducible.

## Phase one: the toy

### 1. Pointer interaction, feed and wound

Dragging feeds the organism: the pointer injects trail into the field and
particles stream toward it. Clicking wounds it: trail in a small radius is
destroyed, and the network grows back over a few seconds.

**Approach.** No new compute pass. The diffuse pass already visits every cell,
so both effects become extra terms there:

- Feed adds a Gaussian falloff around the pointer to the cell's incoming value.
- Wound multiplies the cell's value down by a falloff, floor around 0.05.

This costs a handful of ALU operations per cell and no extra dispatch, no extra
buffer and no extra synchronization.

**Uniform fields added:** `pointerX`, `pointerY` in grid coordinates,
`pointerFeed`, `pointerWound`, `pointerRadius`.

**Input mapping.** `render.wgsl` maps the square grid onto the canvas with a
cover fit: `scale = max(canvasW / gridW, canvasH / gridH)`. Pointer input needs
the inverse of exactly that, and it must live in one place so the two can never
drift. A `gridFromClient(x, y)` helper in `simulation.ts` owns it.

**Events.** Pointer Events only, so mouse, touch and pen share one path.
`pointerdown` starts feeding and sets `setPointerCapture`. `pointermove` while
down continues feeding. A `pointerup` under 180 ms with under 8 px of travel is
a click, and fires a wound. `pointercancel` and `pointerleave` stop feeding.
Hover without buttons feeds at about a third strength on fine pointers only, so
a desktop visitor sees a response before they think to click.

**Idle drift.** With no pointer for 4 seconds, a slow attractant wanders the
field on a Lissajous path at low strength, so the organism is never static.
Any real pointer input cancels it immediately.

**Reproducibility.** Pointer input breaks the "same word, same image" property
by design. A wounded organism is no longer purely a function of its word. The
share link keeps growing the same organism from step zero, because the pointer
state is never encoded in the URL. The README must say that the claim covers an
untouched organism.

**Verification.** Drag and the filaments visibly converge on the cursor within
about half a second. Click and a dark hole appears that closes within roughly
five seconds. Frame time does not change measurably, since the work is per cell
and the cell count is unchanged.

### 2. Typing is alive

While the visitor types, the organism morphs continuously. Pressing Enter
commits and triggers the full regrowth that already exists.

**Approach.** `writeParams` already distinguishes the seed parameters, which
decide the arrangement, from the look parameters, which decide the form. Only
the look parameters move while typing.

On each `input` event, hash the current prefix, build its `Form`, and set it as
a target. Each frame, the live look parameters ease toward that target by about
12 percent of the remaining distance, which converges in roughly a third of a
second. Hue takes the shortest path around its range. The seed, start shape and
heading are untouched, so no particle is repositioned and no trail is cleared.

On Enter, the existing `transitionTo` runs: particles stream to the new
arrangement, the trail is wiped, and the run starts from step zero. This keeps
the committed organism a pure function of the word.

**Verification.** Typing five letters produces five visible shifts in the
network with no flicker and no reseeding. Pressing Enter still produces a
byte-identical image to opening the same word from a fresh share link, which is
the existing reproducibility check.

### 3. A living surface

Two changes: a fast channel that makes flow visible, and an optional boundary
that gives the colony an edge.

**Activity channel.** One extra `u32` buffer the size of the grid. In the
diffuse pass, each cell updates its own activity in place:
`activity = activity * activityDecay + deposits`, with `activityDecay` around
0.86, so it holds roughly the last half second of movement. Each invocation
reads and writes only its own cell, so an in-place read-write binding is safe
and no ping-pong is needed.

The render pass reads both buffers. Structure comes from the slow trail and
carries the deep color. Activity is drawn as a brighter, slightly whiter
highlight on top. The result is visible pulses travelling along the filaments.

**Island boundary.** A per-family flag. When set, the diffuse pass multiplies
decay by a radial falloff, so trail outside a soft circular edge dies faster
and the colony has a silhouette instead of bleeding off screen. Families that
already look right filling the frame keep it off.

**Color ramp rewrite.** The current ramp mixes three layers from one number.
With activity available it becomes four: halo, body, core, and flow. The
existing hue parameter continues to select between the blue and green ends.

**Cost.** One 4 MB buffer at a 1024 grid, one extra buffer read in the render
pass, a few operations per cell in diffuse.

**Verification.** Side by side against the current build at the same word and
step count, filaments show visible directional movement. Frame time stays
within one millisecond at the same tier on the M2.

## Phase two: the flex

### 4. Name mode

A toggle. Default stays abstract. When on, the word is rendered as an obstacle
mask and the organism grows around it, so the name reads as negative space
inside the network.

**Approach.** Rasterize the word to an `OffscreenCanvas` at grid resolution in
the app's serif, fitted to about 80 percent of the grid width and centered.
Read the alpha channel, threshold it, and upload one `u32` per cell to a mask
buffer. 4 MB at a 1024 grid, uploaded once per word rather than per frame.

Two shader changes:

- `agents.wgsl`: if the cell a particle would step into is masked, it does not
  move there. It turns by its turn angle away and stays put for that step. This
  produces a crisp edge rather than a smear.
- `diffuse.wgsl`: masked cells write zero trail, so nothing accumulates inside
  the letterforms even from wrapped blur.

**Why a mask rather than a repellent field.** A repellent produces soft,
illegible edges at the sizes a word needs. A hard mask keeps the letterforms
readable while the organism supplies all the texture.

**Reuse.** The mask is a general obstacle field. Any shape can be loaded the
same way later, including a logo. Not in scope now, but the interface should
take an `ImageBitmap` or a canvas rather than a string, with the word-to-canvas
step sitting above it.

**Edge cases.** An empty word disables the mask. A word wider than the grid is
shrunk to fit rather than clipped. Words at the 40 character limit will be
small; that is acceptable and legible enough at poster resolution.

**Verification.** The word is readable in the exported poster at 4096. The
organism visibly wraps the letterforms rather than stopping at a rectangle.
Toggling off restores the previous behavior exactly.

### 5. Two words, one arena

Two words produce two species with different rules on one field. Each is
attracted to its own trail and repelled by the other's, which produces
territories, borders and invasion fronts.

**Approach.** Generalize the existing single population rather than special
casing two.

- Trail buffers become two sets of ping-pong pairs, one per species.
- Deposits become one buffer per species.
- Particles stay in one buffer, split into two contiguous ranges, so no
  allocation changes when the mode toggles.
- Per-species parameters move into their own small uniform buffer bound at a
  new binding. The agent pass is dispatched once per species with a different
  bind group. This avoids uniform array stride and alignment rules entirely,
  which is the usual source of silent corruption here.

Sensing becomes `own * attract - other * repel`, with the existing crowding
saturation applied to the own term only. Both attraction and repulsion strength
are derived from the pair of word hashes, so a pair is reproducible the same
way a single word is.

The render pass blends two color ramps, one per species, with the hue of each
taken from its own word. Where they meet, the two ramps overlap and the border
is visible as a distinct color.

**Cost, stated honestly.** This roughly doubles agent work and adds a second
trail read per cell in diffuse. Expect the affordable particle count at a given
frame rate to fall by about half. The startup benchmark must therefore measure
in the mode that will actually run, not in single species mode, and the tier
tables need a separate set of measurements in `NOTES.md`.

**Entry point.** Two words separated by a `+` in the same input, for example
`amit + ocean`. The share link carries both: `?w=amit&w2=ocean`. A single word
keeps the current behavior and the current cost.

**Verification.** Two visibly distinct territories with a border that moves.
The same pair of words twice on one machine gives a byte-identical image.
Measured frame rate and tier recorded in `NOTES.md` before this ships as
anything other than an option.

## Phase three: the spread

### 6. Export a loop

A five second 1080 by 1080 video alongside the existing poster.

**Approach.** A hidden second canvas at 1080 by 1080 with its own WebGPU
context, drawn each frame while recording, so the visible canvas is never
resized or disturbed.

Two encoders are possible and the choice is recorded here rather than left
open:

- **WebCodecs `VideoEncoder` plus an MP4 muxer** is the primary path. It
  encodes a known number of frames with no real-time requirement, produces MP4
  with H.264, and does not depend on the tab staying in the foreground. It
  needs one small MIT dependency for muxing.
- **`MediaRecorder`** is the fallback where WebCodecs or the H.264 codec is
  unavailable. It records the canvas stream in real time, which means five real
  seconds and a tab that must stay visible. This path is already proven in this
  codebase: the fallback video was recorded with it.

Feature detection picks the path at click time, via
`VideoEncoder.isConfigSupported` and then `MediaRecorder.isTypeSupported`.

**Loop quality.** The recording starts from a grown organism, not from black,
and the simulation continues through the recording. A true seamless loop is not
achievable from a chaotic system, so the last 400 ms cross-fades to the first
frame. This is honest and it reads as a loop.

**Feedback.** The button reports progress and disables itself while recording.
The real time path must say that the tab needs to stay visible.

**Verification.** The file plays in a browser, uploads to LinkedIn and X, and
is under roughly 8 MB. Tested on the M2 in Chrome at minimum, with the
fallback path exercised by forcing detection to fail.

### 7. Other words, visible

A row of four small thumbnails of other words below the caption. Clicking one
grows it.

**Approach.** Pre-rendered static JPEGs in `public/`, generated by me through
the existing dev save endpoint, at about 320 px square each. No second WebGPU
context, no runtime cost. Clicking calls the same `grow` path as typing, so
there is exactly one code path for changing the organism.

Words chosen to span visually distinct families, verified with the contact
sheet tool, so the row actually demonstrates the claim rather than showing four
similar textures.

**Verification.** Four visibly different thumbnails. Clicking one produces the
organism shown. Total added page weight under 120 KB.

## Data and layout changes

The uniform struct grows past its current 96 bytes. All fields stay 4 byte
scalars in one flat struct, written from the same `DataView`, because that is
what keeps the CPU and GPU layouts impossible to desynchronize.

Fields added across all phases: `pointerX`, `pointerY`, `pointerFeed`,
`pointerWound`, `pointerRadius`, `activityDecay`, `islandEdge`, `maskOn`,
`speciesCount`. Per-species fields move to a separate uniform buffer in phase
two.

Buffers added: activity (phase one), mask (phase two), a second trail pair and
second deposit buffer (phase two).

At a 1024 grid, total GPU buffer use goes from about 12 MB to about 36 MB in
two species mode with a mask, plus particles. This is far below the default
`maxBufferSize` and well within a phone's budget.

## Testing

The project has no automated test suite, and adding a GPU test harness is not
justified for a page of this size. Verification is therefore explicit and
manual, and every phase has named checks listed above. Three existing checks
must keep passing after every phase, and they are the regression suite:

1. The same word twice on one machine gives a byte-identical canvas, with no
   pointer input. The existing dev snapshot hash does this.
2. Ten words side by side still produce ten visibly different organisms, judged
   with the existing contact sheet tool.
3. With WebGPU forced off, the recorded loop still plays.

Frame time at the chosen tier is recorded in `NOTES.md` after each phase, on
the M2 in real Chrome, because the in-app browser pane throttles the GPU and
reports meaningless numbers.

## Risks

- **Pointer interaction breaks reproducibility.** Handled by scoping the claim
  to an untouched organism and saying so in the README.
- **Two species halves the particle count.** Measure before making it a
  default. If the cost is worse than expected, it stays an explicit mode rather
  than something a visitor stumbles into.
- **Name mode can dominate the art.** It stays off by default, which is the
  decision already taken.
- **The activity channel can look like noise** at low particle tiers, where
  deposits are sparse. Its strength should scale with the tier, the same way
  deposit strength already does.
- **WebCodecs support is uneven.** Hence the detection and the proven
  `MediaRecorder` fallback.
- **Everything is still unverified off the M2.** The PC, a phone and Safari
  remain unmeasured, and the README must keep saying so.

## Sequencing

Features ship in the order they are numbered above: 1, 2 and 3 in phase one, 4
and 5 in phase two, 6 and 7 in phase three. Each feature is its own commit under Amit's git identity, pushed to
`am1t27/seed`, with no AI attribution in the message.
