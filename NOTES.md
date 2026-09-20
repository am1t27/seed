# Notes: measurements and the parameter ranges that work

Everything here was measured or observed in this project. Nothing is borrowed from
someone else's benchmark.

## Performance

Grid is 1024 x 1024 cells at every tier. Tiers are 150k, 300k, 600k, 1M and 2M particles.

| Machine | Browser | Particles | Frame rate | Startup (device to first frame, includes benchmark) | Measured |
| --- | --- | --- | --- | --- | --- |
| MacBook, Apple M2, 8 GB | Chrome 153 | 1,000,000 (tier the benchmark picks) | 60 fps | 100 to 180 ms | 2026-09-20 |
| MacBook, Apple M2, 8 GB | Chrome 153 | 2,000,000 (forced) | 60 fps | about 100 ms | 2026-09-20 |
| MacBook, Apple M2, 8 GB | Chrome 153 | 1,000,000 (benchmark's pick), pointer, flow and modulation 0.4 on | 60 fps | about 140 ms | 2026-09-20 |
| MacBook, Apple M2, 8 GB | Chrome 153 | 2,000,000 (forced), same build, modulation 0.4 | 60 fps | not comparable (benchmark skipped) | 2026-09-20 |
| MacBook, Apple M2, 8 GB | Chrome 153 | 150,000 (forced), same build, modulation 0.4 | 60 fps | not comparable (benchmark skipped) | 2026-09-20 |
| MacBook, Apple M2, 8 GB | Chrome 153 | 1,000,000, during a full-strength pointer drag | 60 fps | | 2026-09-20 |
| PC, Ryzen 6800H, RTX 3050 Ti 4 GB | not measured yet | | | | |
| Android phone | not measured yet | | | | |
| Safari 26 | not measured yet | | | | |

Notes on these numbers:

- Frame rate is the smoothed requestAnimationFrame interval shown by the debug overlay
  (press the backquote key). The display refreshes at 60 Hz, so 60 fps is the ceiling
  this method can report. Canvas was 2940 x 1492 pixels.
- The startup benchmark times real simulation steps at 300k particles. On the M2 it
  read 2.1 to 2.9 ms per step. It reads much higher (6 to 11 ms) when the tab is in the
  background, which is why the page waits for the tab to be visible before benchmarking.
- After the interactivity work the startup benchmark read 1.5 to 2.1 ms per step at
  300k, the same band as before. 60 fps is the display ceiling, so these rows show that
  the pointer terms, the activity channel and per-particle modulation did not push the
  M2 under it; they do not show how much headroom is left. The benchmark picked the 1M
  tier on some runs and the 2M tier on others on the same machine.
- Poster export at 4096 x 4096 took about 1.8 s on the M2, render and readback and PNG
  encode together.
- To measure another machine: run the dev server, open `/?measure=<name>`, wait 12 s,
  and read `docs/measure-<name>.txt`. Or open the production page and press backquote.

## Parameter sweep

Method: the dev contact sheet (`__dev.sheet([...])` in the console) grows several
settings one after another and tiles the results, so they are judged side by side.
Most sweeps ran 400 to 450 steps; the families were rechecked at 1,800 steps (30 s).

What changes the look, strongest first:

1. **Crowding** (`crowd`). Attraction rises with trail amount up to this value, then
   falls. Without it, a million particles collapse into a handful of thick lines in
   every setting tried, and every word looks alike. Useful range 9 to 30. Low values
   give foam and coral textures, high values give thin clean filaments.
2. **Sensor angle against turn angle.** Turn smaller than sensor angle gives smooth
   flowing lines. Turn larger than sensor angle gives ragged, cellular walls.
3. **Sensor distance.** Sets the cell size of the network. 5 gives fine texture, 50
   gives cells a fifth of the screen wide.
4. **Start arrangement and heading.** Disc heading inward gives radial veins. A ring
   heading along its tangent keeps a braided ring. Scatter gives an even field.
5. **Decay.** 0.68 to 0.8 gives crisp thin walls. 0.9 and up gives soft, thick, glowing ones.
6. **Step size.** Mostly speed. Above 3 the filaments break into dashes.
7. **Per-particle modulation.** Varying sensor distance, sensor angle, turn
   angle and step size per particle from the locally sensed trail value. This is
   the difference between one scale of structure and several in the same image.
   Amounts above about 0.4 to 0.6 turn coherent networks into mush: every family
   swept broke into separate droplets by 0.8, and the fast-decaying or fat-walled
   ones (foam, lace) already lost their character at 0.2. The ceiling differs per
   family and is recorded in the families table.

What did not work:

- Small disc heading outward: an expanding ring that leaves the screen empty within 4 s.
- Any setting with `crowd` effectively off (1000): collapses to a few fat loops by step 400.
- Sensor distance below 4 with a wide sensor angle: flat noise, no structure.

For reference, fogleman/physarum (MIT) samples sensor angle 0 to 120 degrees, sensor
distance 0 to 64, rotation angle 0 to 120 degrees and step distance 0.2 to 2. The
families below sit inside those ranges except for step size, which goes to 3.2 here.

## Families

The word's hash picks one family, then a point inside its ranges, plus a hue and the
particle seed. Exact ranges live in `src/seed.ts`.

| Family | What it grows | Sensor angle | Sensor dist | Turn | Decay | Crowd | Start | Modulation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| veins | radial veins feeding central cells | 31 to 39 | 26 to 34 | 10 to 14 | 0.72 to 0.78 | 20 to 30 | disc, inward | 0.4 |
| halo | braided ring with bridges | 26 to 34 | 19 to 25 | 13 to 17 | 0.83 to 0.87 | 12 to 18 | ring, tangent | 0.4 |
| silk | long crossing threads | 10 to 15 | 34 to 46 | 5 to 8 | 0.83 to 0.87 | 12 to 18 | scatter | 0.2 |
| foam | fat-walled cells | 52 to 68 | 10 to 14 | 70 to 90 | 0.83 to 0.87 | 10 to 14 | scatter | off |
| coral | dense texture with pores | 80 to 100 | 4 to 6 | 25 to 35 | 0.88 to 0.92 | 9 to 12 | scatter or disc | off |
| net | thick glowing wide net | 17 to 23 | 44 to 56 | 26 to 34 | 0.88 to 0.92 | 17 to 23 | scatter | 0.4 |
| mesh | crisp thin polygons | 40 to 50 | 12 to 27 | 20 to 45 | 0.68 to 0.80 | 9 to 13 | scatter or ring | 0.4 |
| membrane | slow folded sheets | 62 to 78 | 30 to 40 | 6 to 10 | 0.90 to 0.93 | 21 to 29 | scatter | 0.2 |
| lace | ragged restless lattice | 13 to 18 | 13 to 17 | 52 to 68 | 0.78 to 0.82 | 10 to 14 | scatter | off |
| urchin | coral body with spines | 19 to 25 | 8 to 10 | 40 to 50 | 0.88 to 0.92 | 9 to 11 | small disc | off |

Modulation was swept per family at 0, 0.2, 0.4, 0.6, 0.8 and 1, each at the
family's mid-range values, 450 steps, 1M particles. "Ceiling" is the highest
value that still grew a connected network; "Set" is what `src/seed.ts` uses.

| Family | Ceiling | Set | Why |
| --- | --- | --- | --- |
| veins | 0.4 | 0.4 | small cells inside, long spines outside; clumps from 0.6 |
| halo | 0.4 | 0.4 | fine cells inside the ring, wide ones outside; ring shatters at 0.6 |
| silk | 0.6 | 0.2 | above 0.2 the long threads shorten into an ordinary mesh |
| foam | 0 | off | walls turn into beaded chains at 0.2 |
| coral | 1 | off | pores only get smaller; nothing gained |
| net | 0.6 | 0.4 | more spread in cell size, walls stay thick |
| mesh | 0.6 | 0.4 | mixed cell sizes and faint secondary threads |
| membrane | 0.2 | 0.2 | fragments from 0.4 |
| lace | 0.4 | off | at 0.2 it smooths out and starts to look like net |
| urchin | 0.2 | off | the body whites out as modulation rises |

The island boundary (a soft circular edge, radius as a share of the half grid)
is on for veins only, at 0.5. At 0.62 the colony ran off the top and bottom of a
laptop screen, because the cover fit shows only about half the grid's height at
2940 x 1492. On urchin it held every particle in a ball and the spines never
formed, so urchin keeps the full frame.

Pointer tuning: feed radius 30 cells at strength 5; wound radius 70 cells held
for 18 steps. A 3 step wound at radius 55 refilled before it could be seen, and
30 steps emptied the area for good. With these values a tap drops brightness at
the spot by about half to four fifths and the network is back within about one
second, which is faster than the five seconds the design aimed for: particles
inside the hole deposit again at once, and constants alone cannot stretch that.

The activity channel is converted into trail-equivalent units before it is
drawn, using both decay rates. Without that, families with a fast trail decay
(lace, halo) had 70 to 85 percent of their filament pixels at full flow
brightness, which reads as a flat whitening and not as movement. With it the
five families measured (lace, net, membrane, halo, veins) sit between 10 and 47
percent. The other five were not measured.

## Checks run on 2026-09-20 (M2, Chrome 153 and the Chromium pane in the editor)

- Twelve words side by side gave twelve visibly different organisms across six families.
- The same word loaded twice and run 300 steps gave a byte-identical canvas (SHA-256 of
  the PNG). "Tokyo " and "tokyo" gave the same one. A different word did not.
- A word typed after another word gave the same canvas as that word opened from a fresh
  share link, so what was on screen before does not leak into the result.
- The 150k tier grows the same forms as the 1M tier, because deposit per particle
  scales with 1M / count.
- With WebGPU forced off, the recorded loop autoplayed.
- 4096 x 4096 poster exported with the caption set; 2048 also.

After the interactivity work, same day:

- Pointer feeding and wounding verified in real Chrome with synthetic Pointer
  Events: hover brightened the spot from 26 to 59 (mean of 0 to 255), a drag fed
  at full strength, a tap wounded at the tap point, a touch drag fed and a touch
  move without a press did not. `touch-action: none` is set and the page does not scroll.
- Idle drift starts after 240 untouched steps and is timed by the step count. A
  word grown from another word and the same word from a share link gave the same
  SHA-256 at step 300, with the drift active in both.
- Typing morph verified: five letters gave five eased shifts, the step counter
  kept running, and the seed and start shape never changed. A word typed letter
  by letter and then committed with Enter was byte-identical to its share link.
- With modulation at 0 the canvas hash was identical before and after the agent
  shader change.
- Flow visible at the 1M and the 150k tier. At 150k the filament walls show fine
  grain, which reads as fibre and not as static.
- A 2048 poster through the two-channel bicubic path showed no dark rings.
- Ten words at 450 steps and eight at 1,800 steps all stayed coherent. Those ten
  words land in only five of the ten families, which is the hash's doing.
- `npm test` passes (12 tests), and the production bundle has no dev tooling in it.

Not checked yet: the PC, a real phone, Safari, and anything on a production URL.
