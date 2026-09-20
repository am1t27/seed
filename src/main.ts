import { Simulation, type SimSettings } from './sim/simulation'

// Get a WebGPU device, build the simulation, run the frame loop.
// All four failure paths (no navigator.gpu, null adapter, rejected device,
// device lost later) end in fallback(), which step 7 replaces with a video loop.

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const report = document.querySelector<HTMLPreElement>('#report')!

// Limits the simulation will depend on. Logged now so step 4 can tier from them.
const LIMITS_OF_INTEREST = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxStorageBuffersPerShaderStage',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupsPerDimension',
  'maxTextureDimension2D',
] as const

// Step 2: fixed by hand. Step 3 derives these from the word.
const SETTINGS: SimSettings = {
  grid: 1024,
  count: 1_000_000,
  seed: 1,
  startShape: 0,
  sensorAngle: (35 * Math.PI) / 180,
  sensorDist: 30,
  turnAngle: (12 * Math.PI) / 180,
  stepSize: 2,
  deposit: 1,
  decay: 0.75,
  exposure: 0.02,
}

// Dev server only: override any setting from the URL for hand tuning, for example
// ?sensorDist=9&decay=0.85. Angles are in degrees here. Stripped from production.
if (import.meta.env.DEV) {
  const query = new URLSearchParams(location.search)
  const degrees = new Set(['sensorAngle', 'turnAngle'])
  for (const key of Object.keys(SETTINGS) as (keyof SimSettings)[]) {
    const raw = query.get(key)
    if (raw === null || Number.isNaN(Number(raw))) continue
    const value = degrees.has(key) ? (Number(raw) * Math.PI) / 180 : Number(raw)
    ;(SETTINGS as unknown as Record<string, number>)[key] = value
  }
}

const STEP_MS = 1000 / 60
const MAX_STEPS_PER_FRAME = 2

function fallback(reason: string): void {
  report.hidden = false
  report.textContent = `WebGPU unavailable: ${reason}\n(The video fallback arrives in step 7.)`
}

function describe(adapter: GPUAdapter): string {
  const info = adapter.info
  const lines = [
    'WebGPU ready',
    '',
    `vendor        ${info.vendor || 'unknown'}`,
    `architecture  ${info.architecture || 'unknown'}`,
    `device        ${info.device || 'unknown'}`,
    `description   ${info.description || 'unknown'}`,
    `fallback      ${info.isFallbackAdapter ? 'yes (software, low tier)' : 'no'}`,
    `canvas format ${navigator.gpu.getPreferredCanvasFormat()}`,
    '',
  ]
  for (const name of LIMITS_OF_INTEREST) {
    lines.push(`${name.padEnd(36)} ${adapter.limits[name].toLocaleString('en-US')}`)
  }
  return lines.join('\n')
}

function resize(device: GPUDevice): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const max = device.limits.maxTextureDimension2D
  canvas.width = Math.max(1, Math.min(max, Math.floor(canvas.clientWidth * dpr)))
  canvas.height = Math.max(1, Math.min(max, Math.floor(canvas.clientHeight * dpr)))
}

async function start(): Promise<void> {
  if (!('gpu' in navigator)) return fallback('navigator.gpu is missing in this browser')

  // requestAdapter resolves to null instead of throwing when nothing suitable exists.
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return fallback('no GPU adapter was returned')

  let device: GPUDevice
  try {
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

  const adapterReport = describe(adapter)
  console.info(adapterReport)

  let sim: Simulation
  try {
    sim = await Simulation.create(device, format, SETTINGS)
  } catch (error) {
    console.error(error)
    return fallback(String(error))
  }

  // Dev server only: ?warm=600 runs that many steps up front, to inspect a grown form.
  if (import.meta.env.DEV) {
    const warm = Number(new URLSearchParams(location.search).get('warm')) || 0
    for (let i = 0; i < Math.min(warm, 5000); i++) sim.step()
    // Draw and read back in one task; a WebGPU canvas is only readable before it presents.
    Object.assign(window, {
      __snapshot: () => {
        sim.draw(context.getCurrentTexture().createView(), canvas.width, canvas.height)
        return canvas.toDataURL('image/png')
      },
    })
  }
  const frozen = import.meta.env.DEV && new URLSearchParams(location.search).has('freeze')

  resize(device)
  window.addEventListener('resize', () => resize(device))

  // Debug overlay: press the backquote key (`) to show frame time and adapter info.
  report.hidden = true
  window.addEventListener('keydown', (event) => {
    if (event.key === '`') report.hidden = !report.hidden
  })

  // Fixed 60 Hz simulation clock, so a 120 Hz display doesn't grow it twice as fast.
  let last = performance.now()
  let owed = 0
  let smoothedMs = STEP_MS
  let overlayAt = 0

  const frame = (now: number): void => {
    if (!alive) return
    const elapsed = Math.min(now - last, 100)
    last = now
    smoothedMs += (elapsed - smoothedMs) * 0.05
    owed += elapsed

    let steps = 0
    while (!frozen && owed >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      sim.step()
      owed -= STEP_MS
      steps += 1
    }
    if (owed > STEP_MS) owed = 0 // too far behind: drop the debt instead of spiralling

    sim.draw(context.getCurrentTexture().createView(), canvas.width, canvas.height)

    if (!report.hidden && now - overlayAt > 250) {
      overlayAt = now
      report.textContent =
        `frame ${smoothedMs.toFixed(1)} ms (${(1000 / smoothedMs).toFixed(0)} fps)\n` +
        `particles ${SETTINGS.count.toLocaleString('en-US')}, grid ${SETTINGS.grid}, step ${sim.frameCount}\n` +
        `canvas ${canvas.width} x ${canvas.height}\n\n${adapterReport}`
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

start().catch((error) => fallback(String(error)))
