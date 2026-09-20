# Seed: interactivity and depth

Design for the second build of Seed, the WebGPU Physarum page. The first build
grows an organism from a typed word and lets you save a poster. It has no
interaction beyond the text input, and most families render as flat texture
rather than as a living thing.

This design adds eight features in three phases. Each phase ends in a working,
committed, verifiable state.

## Goals

1. The visitor can touch the organism and it responds.
2. The organism reads as alive: flow is visible, and it has an edge.
3. Typing itself produces feedback, not a wait.
4. The visitor's name can appear inside the organism as negative space.
5. Two words can share one arena and compete.
6. The takeaway is a short video loop, not only a still.
7. Other words are visible, so "every word is different" is provable on sight.
8. Every family looks multi-scale rather than flat, because each particle runs
   its own parameters rather than the population's.

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
drift. A `src/sim/mapping.ts` module owns both directions, with a test pinning them
together.

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
second. Hue is a 0 to 1 blend between the two ends of the colour ramp rather
than an angle, so it eases linearly with no wraparound. The seed, start shape
and heading are untouched, so no particle is repositioned and no trail is cleared.

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

### 8. Per-particle parameter modulation

Each particle varies its own sensor distance, sensor angle, turn angle and step
size according to the trail value it senses locally, instead of every particle
in the population sharing one fixed set.

**Why.** A fixed parameter run produces structure at one scale, which is why
the current build reads as an even texture. Modulating per particle produces
fine detail inside dense regions and broad reaching filaments in empty ones, in
the same image. This is the main difference between an ordinary Physarum run
and the images most people have seen and admired.

**Approach.** In `step`, after sensing, compute a local intensity from the
sensed values, normalized against the family's crowding value so it stays in
roughly 0 to 1. Each of the four parameters becomes
`base * (1 + modulation * (intensity - 0.5) * 2)`, with a per-family
`modulation` amount from 0 to 1 and a clamp on each result so nothing goes
negative or explodes. A `modulation` of 0 reproduces today's behavior exactly,
which keeps this testable against the current build.

**Provenance.** Sage Jenson described this idea; his source was never released,
and the re-implementations of it are CC BY-NC-SA and therefore off limits. This
is written from the description, in our own WGSL. The README credits the idea.

**Where it sits.** Last in phase one, before name mode and two species. It
changes how every family looks, so the ten families need their ranges
re-checked against the contact sheet once. Doing it after phase two would mean
re-tuning twice, once for one species and again for two.

**Cost.** A dozen extra instructions per particle per step, no new buffer, no
new pass. Some frame time cost at high tiers; measure and record it.

**Verification.** With `modulation` at 0, output is byte-identical to the
previous commit for the same word. With it on, a contact sheet of the same ten
words shows visible detail at more than one scale, and all ten still look
different from each other.

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

A 1080 by 1080 MP4 alongside the existing poster. Six seconds, 30 fps.

**Why a video at all.** The strongest documented pattern in pieces that spread
is that the artifact leaving the site is a native object of the destination
rather than a link back. Wordle's emoji grid is the clearest case: plain
Unicode, pastes anywhere, no upload. A video is the closest equivalent here,
because a still of a simulation loses the only thing that makes it interesting.

**Encoder.** WebCodecs `VideoEncoder` with AVC, muxed to MP4, encoding offline
at fixed timestamps rather than in real time. Frame accurate, faster than real
time, and it produces a normal MP4 with a correct duration.

`MediaRecorder` is the fallback, not the primary path, for two reasons. It
records in real time, so six seconds of video costs six seconds of wall clock
and drops frames if a compute pass stalls. And Chrome and Safari both emit a
fragmented MP4 whose `moov` atom carries a zero duration, so players cannot
show length or seek without fetching the whole file. Detection order is
`VideoEncoder.isConfigSupported`, then `MediaRecorder.isTypeSupported` with
`video/mp4;codecs=avc1`. WebM is never the primary export, because neither
LinkedIn nor X lists it in their specifications.

**Muxer, and a dependency decision.** `mp4-muxer` is deprecated in favour of
Mediabunny by the same author. Mediabunny is pure TypeScript with no
dependencies of its own, is tree shakable, has a `CanvasSource` helper, and
writes AVC. It is **MPL-2.0, not MIT**. MPL is file level weak copyleft:
consuming it unmodified as a dependency carries no obligation on this project's
own code, and it is fine here. If its own source files are ever edited, those
changes have to be published.

This is the first runtime dependency in the project, so the README claim of
"zero runtime dependencies" becomes false and must be corrected in the same
commit. That is the cost of this feature and it is worth naming plainly.
Decided: take Mediabunny and correct the README. `canvas-record` (MIT) wraps
the same tier selection and supports WebGPU canvases, and stays on record as
the alternative, at the price of a larger dependency tree.

**WebGPU specific hazard.** A canvas presentation texture is destroyed at the
end of the animation frame that produced it. The recording context must be
configured with `COPY_SRC` usage, and the `VideoFrame` must be constructed
inside the same frame that renders it. Getting this wrong produces an empty or
black recording rather than an error.

**Audio.** LinkedIn and X both specify AAC in their accepted formats. I could
not find an authoritative statement that either rejects a video with no audio
track, and found no test either way, so a silent AAC track is muxed in as cheap
insurance. This must be tested on a real post before the feature is announced.

**Bitrate and size.** Physarum is high entropy, all thin filaments and fine
detail, so it compresses worse than live action. Budget 10 Mbps rather than the
2.5 to 5 Mbps typical of 1080p video. At 10 Mbps six seconds is roughly 7 MB,
three orders of magnitude under either platform's ceiling, so bias toward the
higher bitrate. That figure is arithmetic, not a measured encode, and must be
replaced with a real number in `NOTES.md` once one exists.

**Length.** LinkedIn requires at least three seconds. Six is the target, which
leaves margin.

**Looping.** Physarum is not periodic and no prior art solves this for it, so a
capture is a clip that will visibly cut. The last 400 ms cross-fades to the
first frame. This is honest and reads as a loop; it is not a true one, and the
README should not claim otherwise.

**Verification.** The file plays in a browser, reports a correct duration,
uploads to LinkedIn and to X, and is under about 8 MB. The `MediaRecorder`
fallback is exercised by forcing detection to fail.

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
- **WebCodecs is not Baseline.** Chrome and Edge since 94, Firefox desktop
  since 130 but not Firefox Android, Safari reaching parity in 26. Hence the
  detection and the `MediaRecorder` fallback, which is already proven in this
  codebase.
- **Feature 6 adds the project's first runtime dependency**, which invalidates a
  claim the README currently makes. Correct the claim in the same commit.
- **Per-particle modulation invalidates the family tuning.** The ten families
  were swept by eye with fixed parameters. Feature 8 changes what those ranges
  produce, so the contact sheet has to be re-run and some ranges will move. The
  `modulation` amount defaults to 0 per family until each one has been looked
  at, so the feature lands dark and is switched on family by family.
- **Everything is still unverified off the M2.** The PC, a phone and Safari
  remain unmeasured, and the README must keep saying so.

## Sequencing

Features ship in this order: 1, 2, 3 and 8 in phase one, then 4 and 5 in phase
two, then 6 and 7 in phase three. Feature 8 keeps its number for continuity
with the discussion that produced it, and runs last in phase one because it
changes how every family looks and the families should only be re-tuned once. Each feature is its own commit under Amit's git identity, pushed to
`am1t27/seed`, with no AI attribution in the message.

## References and licensing

This project may read and learn from permissively licensed work, and must not
copy from copyleft or non-commercial work. The distinction matters most in
phase two, where a widely copied pattern has a license that rules it out.

**Safe to read, permissive:**

- `amandaghassaei/gpu-io` (MIT), whose Physarum example injects attractant at
  the pointer. The closest readable reference to feature 1.
- `Bewelge/Physarum-WebGL` (MIT), three species with per-species sensing and
  cross-infection. The closest readable reference to feature 5.
- `tobiaslrn/physarum` (MIT), WebGPU, multiple colonies that can attract or
  repel each other.
- `fogleman/physarum` (MIT), already used for parameter ranges.

**Must not copy:**

- `SebLague/Slime-Simulation` is GPL-3.0 and is the origin of the RGBA
  species-mask pattern, where each species occupies one color channel and
  agents sense only their own. A large share of blog posts, tutorials and
  YouTube ports descend from it, so anything resembling that pattern needs its
  lineage checked. Feature 5 here uses separate trail buffers and a separate
  per-species uniform buffer, which is a different structure arrived at for a
  different reason, namely avoiding uniform array alignment rules.
- `SuboptimalEng/slime-sim-webgpu` is CC BY-NC-SA 4.0.
- `Bleuje/interactive-physarum` is CC BY-NC-SA 3.0. Its
  [explanation page](https://bleuje.com/physarum-explanation/) is excellent and
  already credited in the README. Read the page, not the code.
- Sage Jenson's work has no released source.

Obstacles and trail-age coloring have no licensed reference worth copying and
are a few lines each, so features 3 and 4 are written from scratch.

## Evidence behind the sequencing

The two mechanics with the clearest track record in pieces that spread are
already in this plan, which is why they come first.

- **State in the URL plus a visible per-keystroke response.** tixy.land holds a
  32 character program in the URL and re-renders as you type. Seed already has
  the URL half; feature 2 adds the other half.
- **A single text field that reacts to every character.** The Password Game is
  one input whose page mutates on each keystroke. Same shape as this page.
- **Pointer drag as the whole interface, no chrome.** The WebGL fluid
  simulation has no buttons and no onboarding. This is the retention mechanic
  rather than the sharing one, which is the right way to value feature 1.

None of this is causal evidence. It is journalism and creator self-reports
about pieces that did spread, and it is correlational. It is enough to order
the work and not enough to make a promise about outcomes.

## Considered and not included

**Shared global state**, where every visitor sees the same field. It spreads
well, needs a server, attracts bots quickly, and contradicts this project's
free and static constraint.
