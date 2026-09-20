import type { Form } from './sim/simulation'

// The word is a pure seed: it is hashed, and the hash picks the organism's
// parameters. Nothing here draws letters.

export const DEFAULT_WORD = 'physarum'
const MAX_LENGTH = 40

// Same word, same organism: case, stray spaces and Unicode look-alikes are folded.
export function normalizeWord(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH)
}

// FNV-1a over the UTF-8 bytes. Integer only, identical in every browser.
export function hashWord(word: string): number {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(word)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// Same PCG hash as agents.wgsl.
function pcg(v: number): number {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}

// Independent 0..1 values from one hash: stream k is pcg(hash + k * golden ratio).
function stream(hash: number): () => number {
  let k = 0
  return () => {
    k += 1
    return pcg((hash + Math.imul(k, 0x9e3779b9)) >>> 0) / 4294967296
  }
}

const DEG = Math.PI / 180
const lerp = (lo: number, hi: number, t: number): number => lo + (hi - lo) * t

type Range = [number, number]

// A family is a region of parameter space that reliably grows a distinct kind of
// structure. The hash picks a family, then a point inside it. NOTES.md records how
// these ranges were found and what falls outside them.
interface Family {
  name: string
  sensorAngle: Range // degrees
  sensorDist: Range
  turnAngle: Range // degrees
  stepSize: Range
  decay: Range
  crowd: Range
  shapes: Form['startShape'][]
  headings: Form['heading'][]
  shapeSize: Range
  brightness?: number // thin-filament families need a lift to read on screen
  // Colony radius as a share of the half grid; omit to fill the frame. Only veins
  // uses it: on urchin it held every particle in a ball and the spines, which are
  // the point of that family, never formed. 0.5 keeps
  // the whole silhouette on a laptop screen, where the cover fit shows about half
  // the grid's height; 0.62 ran off the top and bottom there.
  island?: number
  // Per-particle parameter variation, 0 to 1. Set per family from a sweep of 0 to 1
  // in steps of 0.2; NOTES.md has the ceilings. Families without it looked better fixed.
  modulation?: number
}

const DISC = 0
const RING = 1
const SCATTER = 2
const INWARD = 0
const RANDOM = 2
const TANGENT = 3

export const FAMILIES: Family[] = [
  {
    // Radial veins feeding a few cells at the center.
    name: 'veins',
    sensorAngle: [31, 39],
    sensorDist: [26, 34],
    turnAngle: [10, 14],
    stepSize: [1.8, 2.2],
    decay: [0.72, 0.78],
    crowd: [20, 30],
    shapes: [DISC],
    headings: [INWARD],
    shapeSize: [0.38, 0.5],
    modulation: 0.4,
    brightness: 1.6,
    island: 0.5,
  },
  {
    // A braided ring that throws out bridges.
    name: 'halo',
    sensorAngle: [26, 34],
    sensorDist: [19, 25],
    turnAngle: [13, 17],
    stepSize: [1.8, 2.2],
    decay: [0.83, 0.87],
    crowd: [12, 18],
    shapes: [RING],
    headings: [TANGENT],
    shapeSize: [0.45, 0.7],
    modulation: 0.4,
  },
  {
    // Long crossing threads, like pulled silk.
    name: 'silk',
    sensorAngle: [10, 15],
    sensorDist: [34, 46],
    turnAngle: [5, 8],
    stepSize: [2.6, 3.2],
    decay: [0.83, 0.87],
    crowd: [12, 18],
    shapes: [SCATTER],
    headings: [RANDOM],
    shapeSize: [1, 1],
    modulation: 0.2,
  },
  {
    // Fat-walled cells.
    name: 'foam',
    sensorAngle: [52, 68],
    sensorDist: [10, 14],
    turnAngle: [70, 90],
    stepSize: [1.3, 1.7],
    decay: [0.83, 0.87],
    crowd: [10, 14],
    shapes: [SCATTER],
    headings: [RANDOM],
    shapeSize: [1, 1],
  },
  {
    // Dense brain-coral texture with dark pores.
    name: 'coral',
    sensorAngle: [80, 100],
    sensorDist: [4, 6],
    turnAngle: [25, 35],
    stepSize: [0.9, 1.1],
    decay: [0.88, 0.92],
    crowd: [9, 12],
    shapes: [SCATTER, DISC],
    headings: [RANDOM],
    shapeSize: [0.5, 0.7],
  },
  {
    // A thick, softly glowing net with wide cells.
    name: 'net',
    sensorAngle: [17, 23],
    sensorDist: [44, 56],
    turnAngle: [26, 34],
    stepSize: [1.3, 1.7],
    decay: [0.88, 0.92],
    crowd: [17, 23],
    shapes: [SCATTER],
    headings: [RANDOM],
    shapeSize: [1, 1],
    modulation: 0.4,
  },
  {
    // Crisp thin-walled polygons.
    name: 'mesh',
    sensorAngle: [40, 50],
    sensorDist: [12, 27],
    turnAngle: [20, 45],
    stepSize: [2.4, 3.1],
    decay: [0.68, 0.8],
    crowd: [9, 13],
    shapes: [SCATTER, RING],
    headings: [RANDOM, INWARD],
    shapeSize: [0.55, 0.75],
    modulation: 0.4,
  },
  {
    // Slow folded sheets, like smoke under water.
    name: 'membrane',
    sensorAngle: [62, 78],
    sensorDist: [30, 40],
    turnAngle: [6, 10],
    stepSize: [1.0, 1.4],
    decay: [0.9, 0.93],
    crowd: [21, 29],
    shapes: [SCATTER],
    headings: [RANDOM],
    shapeSize: [1, 1],
    modulation: 0.2,
  },
  {
    // A ragged, restless lattice.
    name: 'lace',
    sensorAngle: [13, 18],
    sensorDist: [13, 17],
    turnAngle: [52, 68],
    stepSize: [1.8, 2.2],
    decay: [0.78, 0.82],
    crowd: [10, 14],
    shapes: [SCATTER],
    headings: [RANDOM],
    shapeSize: [1, 1],
  },
  {
    // A coral body that sends out spines.
    name: 'urchin',
    sensorAngle: [19, 25],
    sensorDist: [8, 10],
    turnAngle: [40, 50],
    stepSize: [0.9, 1.1],
    decay: [0.88, 0.92],
    crowd: [9, 11],
    shapes: [DISC],
    headings: [RANDOM],
    shapeSize: [0.24, 0.36],
  },
]

// Brightness tracks crowding: a form whose filaments saturate at a low trail
// amount needs more exposure to read the same on screen.
const BRIGHTNESS: Range = [0.9, 1.1]

export interface Organism {
  word: string
  family: string
  form: Form
}

export function organismFor(rawWord: string): Organism {
  const word = normalizeWord(rawWord) || DEFAULT_WORD
  const hash = hashWord(word)
  const next = stream(hash)
  const family = FAMILIES[Math.floor(next() * FAMILIES.length)]
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)]
  const within = (range: Range): number => lerp(range[0], range[1], next())
  const crowd = within(family.crowd)

  return {
    word,
    family: family.name,
    form: {
      seed: hash,
      startShape: pick(family.shapes),
      heading: pick(family.headings),
      shapeSize: within(family.shapeSize),
      sensorAngle: within(family.sensorAngle) * DEG,
      sensorDist: within(family.sensorDist),
      turnAngle: within(family.turnAngle) * DEG,
      stepSize: within(family.stepSize),
      decay: within(family.decay),
      crowd,
      island: family.island ?? 0,
      modulation: family.modulation ?? 0,
      exposure: (within(BRIGHTNESS) * (family.brightness ?? 1)) / crowd,
      hue: next(),
    },
  }
}
