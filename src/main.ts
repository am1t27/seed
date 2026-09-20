import { Simulation, type Form, type SimSettings } from './sim/simulation'
import { organismFor, DEFAULT_WORD, type Organism } from './seed'
import { createUi, withoutWord } from './ui'
import { download, posterFilename, posterSize, renderPoster } from './export'
import { attachPointer } from './pointer'
import { easeLook } from './morph'

// Get a WebGPU device, pick a particle count the machine can hold, run the frame loop.
// All four failure paths (no navigator.gpu, null adapter, rejected device, device
// lost later) end in the recorded video.

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const recording = document.querySelector<HTMLVideoElement>('#recording')!
const report = document.querySelector<HTMLPreElement>('#report')!

const GRID = 1024
// Particle tiers. The startup benchmark picks one; the frame loop can step down.
const TIERS = [150_000, 300_000, 600_000, 1_000_000, 2_000_000]
const BENCH_COUNT = 300_000
const BENCH_WARM_STEPS = 8
const BENCH_STEPS = 10
const BENCH_ROUNDS = 3
// Share of a 16.7 ms frame the simulation step may use, leaving room for the draw.
// Measured on an M2: 2.1 ms per step at 300k, and 2M particles still held 60 fps,
// so 10 ms is a safe budget. The frame loop steps down a tier if this guess is wrong.
const STEP_BUDGET_MS = 10
const STEP_MS = 1000 / 60
const MAX_STEPS_PER_FRAME = 2
const SLOW_FRAME_MS = 24
const SLOW_FRAMES_BEFORE_STEP_DOWN = 150
// Share of the remaining distance the look covers each frame while typing.
const MORPH_RATE = 0.12

const LIMITS_OF_INTEREST = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxStorageBuffersPerShaderStage',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupsPerDimension',
  'maxTextureDimension2D',
] as const

const ui = createUi({
  onWord: (word) => grow(word),
  onType: (word) => typeTarget(word),
  onSave: () => savePoster(),
})
// A word typed before the GPU is ready is kept and grown as soon as it is.
let queuedWord: string | null = null
let grow: (word: string) => void = (word) => (queuedWord = word)
// Typed characters before the GPU is ready are ignored; the committed word is queued instead.
let typeTarget: (word: string) => void = () => undefined
let savePoster: () => Promise<void> = () => Promise.reject(new Error('not ready'))

function fallback(reason: string): void {
  console.warn(`Falling back to the recording: ${reason}`)
  canvas.hidden = true
  recording.hidden = false
  // MP4 first: every Safari plays it. WebM covers browsers without H.264.
  for (const [src, type] of [
    ['/fallback.mp4', 'video/mp4'],
    ['/fallback.webm', 'video/webm'],
  ]) {
    const source = document.createElement('source')
    source.src = src
    source.type = type
    recording.append(source)
  }
  // The element was created without sources, so it has to be told to look again.
  const play = (): void => void recording.play().catch(() => undefined)
  recording.muted = true
  recording.load()
  recording.addEventListener('canplay', play, { once: true })
  document.addEventListener('visibilitychange', () => !document.hidden && recording.paused && play())
  ui.showRecording(
    'This is a recording. Growing it live needs WebGPU: a current Chrome, Edge or Safari.',
  )
  report.textContent = `WebGPU unavailable: ${reason}`
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('measure')) {
    // Rehearsal check: report whether the recording actually autoplayed.
    setTimeout(() => {
      const state = `paused ${recording.paused}, time ${recording.currentTime.toFixed(1)}, hidden ${document.hidden}, src ${recording.currentSrc}`
      void fetch('/__save?path=docs/measure-fallback.txt', { method: 'POST', body: state })
    }, 5000)
  }
}

function describe(adapter: GPUAdapter): string {
  const info = adapter.info
  const lines = [
    `vendor        ${info.vendor || 'unknown'}`,
    `architecture  ${info.architecture || 'unknown'}`,
    `device        ${info.device || 'unknown'}`,
    `fallback      ${info.isFallbackAdapter ? 'yes (software, lowest tier)' : 'no'}`,
    `canvas format ${navigator.gpu.getPreferredCanvasFormat()}`,
    '',
  ]
  for (const name of LIMITS_OF_INTEREST) {
    lines.push(`${name.padEnd(36)} ${adapter.limits[name].toLocaleString('en-US')}`)
  }
  return lines.join('\n')
}

// Time real simulation steps on this GPU and return milliseconds per step.
async function benchmark(device: GPUDevice, format: GPUTextureFormat, form: Form): Promise<number> {
  const probe = await Simulation.create(device, format, { grid: GRID, count: BENCH_COUNT }, form)
  for (let i = 0; i < BENCH_WARM_STEPS; i++) probe.step()
  await probe.idle()
  // Best of a few short rounds: one slow round is usually another tab, not this GPU.
  let best = Infinity
  for (let round = 0; round < BENCH_ROUNDS; round++) {
    const began = performance.now()
    for (let i = 0; i < BENCH_STEPS; i++) probe.step()
    await probe.idle()
    best = Math.min(best, (performance.now() - began) / BENCH_STEPS)
  }
  probe.destroy()
  return best
}

// A link opened in a background tab gets a throttled GPU. Benchmarking then would
// lock the visitor into the lowest tier, so wait until the tab is actually looked at.
// Some embedded browsers report hidden forever, so the wait is capped; a run that
// started hidden is benchmarked again the first time the tab is seen.
const VISIBLE_WAIT_MS = 3000

function whenVisible(limitMs: number): Promise<void> {
  if (!document.hidden) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      document.removeEventListener('visibilitychange', check)
      resolve()
    }
    const check = (): void => {
      if (!document.hidden) done()
    }
    document.addEventListener('visibilitychange', check)
    if (Number.isFinite(limitMs)) window.setTimeout(done, limitMs)
  })
}

function tierFor(msPerStep: number): number {
  const affordable = BENCH_COUNT * (STEP_BUDGET_MS / Math.max(msPerStep, 0.05))
  let tier = 0
  for (let i = 0; i < TIERS.length; i++) if (TIERS[i] <= affordable) tier = i
  return tier
}

async function start(): Promise<void> {
  // Dev server only: ?nogpu rehearses the fallback without touching browser flags.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('nogpu')) {
    return fallback('forced by ?nogpu')
  }
  if (!('gpu' in navigator)) return fallback('navigator.gpu is missing in this browser')

  // requestAdapter resolves to null instead of throwing when nothing suitable exists.
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return fallback('no GPU adapter was returned')

  let device: GPUDevice
  try {
    // Default limits are enough: the largest buffer is the 4096 poster readback at 67 MB.
    device = await adapter.requestDevice()
  } catch (error) {
    return fallback(`the device request was rejected (${String(error)})`)
  }

  let alive = true
  void device.lost.then((info) => {
    alive = false
    fallback(`the device was lost (${info.reason || 'unknown'}: ${info.message})`)
  })

  const context = canvas.getContext('webgpu')
  if (!context) return fallback('the canvas gave no webgpu context')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })

  const dev = import.meta.env.DEV ? await import('./dev') : null
  const organismOf = (word: string): Organism => {
    const organism = organismFor(word)
    dev?.applyOverrides(organism.form)
    return organism
  }

  const linked = new URLSearchParams(location.search).get('w')
  let organism = organismOf(linked ?? DEFAULT_WORD)

  let tier = 0
  let benchMs = 0
  let benchmarkedHidden = false
  let startupMs = 0
  let sim: Simulation
  try {
    const forcedTier = dev?.tierOverride(TIERS)
    if (forcedTier === undefined) await whenVisible(VISIBLE_WAIT_MS)
    const startedHidden = document.hidden
    const began = performance.now()
    if (!adapter.info.isFallbackAdapter && forcedTier === undefined) {
      benchMs = await benchmark(device, format, organism.form)
      tier = tierFor(benchMs)
    }
    tier = forcedTier ?? tier
    const settings: SimSettings = { grid: GRID, count: TIERS[tier] }
    sim = await Simulation.create(device, format, settings, organism.form)
    startupMs = performance.now() - began
    benchmarkedHidden = startedHidden && forcedTier === undefined
  } catch (error) {
    console.error(error)
    return fallback(String(error))
  }

  const resize = (): void => {
    // Lower tiers render fewer pixels too.
    const dpr = Math.min(window.devicePixelRatio || 1, tier <= 1 ? 1.5 : 2)
    const max = device.limits.maxTextureDimension2D
    canvas.width = Math.max(1, Math.min(max, Math.floor(canvas.clientWidth * dpr)))
    canvas.height = Math.max(1, Math.min(max, Math.floor(canvas.clientHeight * dpr)))
  }
  resize()
  window.addEventListener('resize', resize)

  ui.showWord(organism.word, linked !== null)

  // Idle drift lives in the simulation, timed in steps; see sim/drift.ts.
  attachPointer(canvas, GRID, {
    feed: (x, y, strength) => sim.setPointer(x, y, strength),
    wound: (x, y) => sim.wound(x, y),
    touched: () => sim.touch(),
  })

  let morphTo: Form | null = null
  typeTarget = (word) => {
    // An emptied input eases back to the word that is actually growing.
    morphTo = (word ? organismOf(word) : organism).form
  }

  grow = (word) => {
    morphTo = null
    organism = organismOf(word)
    sim.transitionTo(organism.form)
    ui.showWord(organism.word, true)
    // A word typed over a shared link replaces it, so the old word leaves the address too.
    history.replaceState(null, '', withoutWord(location.href))
  }

  if (queuedWord) grow(queuedWord)

  savePoster = async () => {
    const blob = await renderPoster(device, sim, posterSize(device, tier <= 1), organism.word)
    download(blob, posterFilename(organism.word))
  }

  // Debug overlay: press the backquote key (`) for frame time, tier and adapter info.
  const adapterReport = describe(adapter)
  window.addEventListener('keydown', (event) => {
    if (event.key !== '`') return
    event.preventDefault()
    report.hidden = !report.hidden
  })

  let stepsFrozen = false
  dev?.install({
    canvas,
    device,
    context,
    getSim: () => sim,
    getOrganism: () => organism,
    grow: (word) => grow(word),
    freeze: (on) => (stepsFrozen = on),
    stats: () => stats(),
  })

  // Fixed 60 Hz simulation clock, so a 120 Hz display doesn't grow it twice as fast.
  let last = performance.now()
  let owed = 0
  let smoothedMs = STEP_MS
  let slowFrames = 0
  let rebuilding = false
  let overlayAt = 0

  // Swap to another particle tier, keeping the current word.
  const rebuild = async (nextTier: number): Promise<void> => {
    if (rebuilding || nextTier === tier) return
    rebuilding = true
    try {
      const next = await Simulation.create(
        device,
        format,
        { grid: GRID, count: TIERS[nextTier] },
        organism.form,
      )
      sim.destroy()
      sim = next
      tier = nextTier
      resize()
    } finally {
      slowFrames = 0
      rebuilding = false
    }
  }

  if (benchmarkedHidden) {
    void whenVisible(Infinity).then(async () => {
      benchMs = await benchmark(device, format, organism.form)
      await rebuild(Math.max(tier, tierFor(benchMs)))
    })
  }

  const stats = (): string =>
    `frame ${smoothedMs.toFixed(1)} ms (${(1000 / smoothedMs).toFixed(0)} fps)\n` +
    `particles ${TIERS[tier].toLocaleString('en-US')} (tier ${tier + 1} of ${TIERS.length}), grid ${GRID}, step ${sim.frameCount}\n` +
    `benchmark ${benchMs.toFixed(2)} ms per step at ${BENCH_COUNT.toLocaleString('en-US')}, startup ${startupMs.toFixed(0)} ms\n` +
    `canvas ${canvas.width} x ${canvas.height}\n` +
    `word "${organism.word}", family ${organism.family}`

  const frame = (now: number): void => {
    if (!alive) return
    const elapsed = Math.min(now - last, 100)
    last = now
    smoothedMs += (elapsed - smoothedMs) * 0.05
    owed += elapsed

    let steps = 0
    while (!stepsFrozen && owed >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      sim.step()
      owed -= STEP_MS
      steps += 1
    }
    if (owed > STEP_MS) owed = 0 // too far behind: drop the debt instead of spiralling

    if (morphTo) {
      const live = { ...sim.look }
      easeLook(live, morphTo, MORPH_RATE)
      sim.setLook(live)
    }

    sim.draw(context.getCurrentTexture().createView(), canvas.width, canvas.height)

    // Sustained slow frames while visible: quietly drop a tier. No warning is shown.
    slowFrames = smoothedMs > SLOW_FRAME_MS && !document.hidden ? slowFrames + 1 : 0
    if (slowFrames > SLOW_FRAMES_BEFORE_STEP_DOWN && tier > 0) void rebuild(tier - 1)

    if (!report.hidden && now - overlayAt > 250) {
      overlayAt = now
      report.textContent = `${stats()}\n\n${adapterReport}`
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start().catch((error) => fallback(String(error)))
