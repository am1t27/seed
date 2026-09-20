# Notes: measurements and the parameter ranges that work

Everything here was measured or observed in this project. Nothing is borrowed from
someone else's benchmark.

## Performance

Grid is 1024 x 1024 cells at every tier. Tiers are 150k, 300k, 600k, 1M and 2M particles.

| Machine | Browser | Particles | Frame rate | Startup (device to first frame, includes benchmark) | Measured |
| --- | --- | --- | --- | --- | --- |
| MacBook, Apple M2, 8 GB | Chrome 153 | 1,000,000 (tier the benchmark picks) | 60 fps | 100 to 180 ms | 2026-09-20 |
| MacBook, Apple M2, 8 GB | Chrome 153 | 2,000,000 (forced) | 60 fps | about 100 ms | 2026-09-20 |
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

| Family | What it grows | Sensor angle | Sensor dist | Turn | Decay | Crowd | Start |
| --- | --- | --- | --- | --- | --- | --- | --- |
| veins | radial veins feeding central cells | 31 to 39 | 26 to 34 | 10 to 14 | 0.72 to 0.78 | 20 to 30 | disc, inward |
| halo | braided ring with bridges | 26 to 34 | 19 to 25 | 13 to 17 | 0.83 to 0.87 | 12 to 18 | ring, tangent |
| silk | long crossing threads | 10 to 15 | 34 to 46 | 5 to 8 | 0.83 to 0.87 | 12 to 18 | scatter |
| foam | fat-walled cells | 52 to 68 | 10 to 14 | 70 to 90 | 0.83 to 0.87 | 10 to 14 | scatter |
| coral | dense texture with pores | 80 to 100 | 4 to 6 | 25 to 35 | 0.88 to 0.92 | 9 to 12 | scatter or disc |
| net | thick glowing wide net | 17 to 23 | 44 to 56 | 26 to 34 | 0.88 to 0.92 | 17 to 23 | scatter |
| mesh | crisp thin polygons | 40 to 50 | 12 to 27 | 20 to 45 | 0.68 to 0.80 | 9 to 13 | scatter or ring |
| membrane | slow folded sheets | 62 to 78 | 30 to 40 | 6 to 10 | 0.90 to 0.93 | 21 to 29 | scatter |
| lace | ragged restless lattice | 13 to 18 | 13 to 17 | 52 to 68 | 0.78 to 0.82 | 10 to 14 | scatter |
| urchin | coral body with spines | 19 to 25 | 8 to 10 | 40 to 50 | 0.88 to 0.92 | 9 to 11 | small disc |

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

Not checked yet: the PC, a real phone, Safari, and anything on a production URL.
