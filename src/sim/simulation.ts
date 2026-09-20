import paramsWgsl from './params.wgsl?raw'
import agentsWgsl from './agents.wgsl?raw'
import diffuseWgsl from './diffuse.wgsl?raw'
import renderWgsl from './render.wgsl?raw'
import { driftAt, isIdle, IDLE_STRENGTH } from './drift'

// Everything the word decides. seed.ts builds one of these from the word's hash.
export interface Form {
  seed: number
  startShape: 0 | 1 | 2 // disc, ring, scatter
  heading: 0 | 1 | 2 | 3 // inward, outward, random, tangent
  shapeSize: number // start shape radius, share of the half grid
  sensorAngle: number // radians
  sensorDist: number // grid cells
  turnAngle: number // radians
  stepSize: number // grid cells per step
  decay: number // trail kept per step, 0..1
  crowd: number // trail amount where attraction peaks
  island: number // 0 fills the frame, else the colony's radius as a share of the half grid
  modulation: number // per-particle parameter variation, 0 to 1
  exposure: number
  hue: number // 0 blue .. 1 green
}

// Everything the device decides.
export interface SimSettings {
  grid: number
  count: number
}

const TRAIL_SCALE = 1024
const PARAMS_BYTES = 128
const PARTICLE_BYTES = 16
const AGENT_WORKGROUP = 64
const DIFFUSE_WORKGROUP = 8
const MAX_GROUPS_PER_ROW = 32768
// Deposit is scaled so total trail laid per step is the same at every particle
// count; a phone's organism is sparser but not dimmer than a desktop's.
const REFERENCE_COUNT = 1_000_000
const GATHER_STEPS = 50
const GATHER_DECAY = 0.82
const FADE_IN_STEPS = 45
// Pointer tuning, in grid cells and trail units. Found by eye; see NOTES.md.
// The wound was swept on "ocean" at 1M particles: 3 steps at radius 55 refilled
// before it could be seen, 30 steps emptied the area for good, and 18 steps at
// radius 70 leaves a plain dark hole that the network grows back through.
const FEED_RADIUS = 30
const FEED_STRENGTH = 5
const WOUND_RADIUS = 70
const WOUND_STEPS = 18
// Share of the fast channel kept per step. About 0.86 holds half a second at 60 fps.
const ACTIVITY_DECAY = 0.86


async function compile(device: GPUDevice, label: string, body: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code: `${paramsWgsl}\n${body}` })
  const info = await module.getCompilationInfo()
  const errors = info.messages.filter((m) => m.type === 'error')
  if (errors.length > 0) {
    const text = errors.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n')
    throw new Error(`Shader failed to compile\n${text}`)
  }
  return module
}

export class Simulation {
  readonly settings: SimSettings
  private form: Form
  private readonly device: GPUDevice
  private readonly paramsBuffer: GPUBuffer
  private readonly paramsData = new DataView(new ArrayBuffer(PARAMS_BYTES))
  private readonly depositBuffer: GPUBuffer
  private readonly activityBuffer: GPUBuffer
  private readonly initPipeline: GPUComputePipeline
  private readonly stepPipeline: GPUComputePipeline
  private readonly gatherPipeline: GPUComputePipeline
  private readonly posterPipeline: GPURenderPipeline
  private readonly buffers: GPUBuffer[]
  private readonly trails: GPUBuffer[]
  private readonly diffusePipeline: GPUComputePipeline
  private readonly renderPipeline: GPURenderPipeline
  // Index n: trail buffer n is the one being read this step.
  private readonly agentGroups: GPUBindGroup[]
  private readonly diffuseGroups: GPUBindGroup[]
  private readonly renderGroups: GPUBindGroup[]
  private readonly agentRowGroups: number
  private readonly agentRows: number
  private source = 0
  private canvasW = 1
  private canvasH = 1
  private frame = 0
  private pointerX = 0
  private pointerY = 0
  private pointerFeed = 0
  private pointerRadius = FEED_RADIUS
  // A wound keeps its own position: the release that fires it also stops the
  // feed, and that must not drag the hole somewhere else.
  private woundX = 0
  private woundY = 0
  private woundLeft = 0
  // Step of the last real input. Idle drift is timed from it; see drift.ts.
  private lastTouchStep = 0
  private gatherLeft = 0
  private pending: Form | null = null

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    settings: SimSettings,
    form: Form,
  ): Promise<Simulation> {
    device.pushErrorScope('validation')
    const [agents, diffuse, render] = await Promise.all([
      compile(device, 'agents', agentsWgsl),
      compile(device, 'diffuse', diffuseWgsl),
      compile(device, 'render', renderWgsl),
    ])
    const sim = new Simulation(device, format, settings, form, agents, diffuse, render)
    const error = await device.popErrorScope()
    if (error) throw new Error(`WebGPU validation failed: ${error.message}`)
    return sim
  }

  private constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    settings: SimSettings,
    form: Form,
    agents: GPUShaderModule,
    diffuse: GPUShaderModule,
    render: GPUShaderModule,
  ) {
    this.device = device
    this.settings = settings
    this.form = form

    const cells = settings.grid * settings.grid
    const groups = Math.ceil(settings.count / AGENT_WORKGROUP)
    this.agentRowGroups = Math.min(groups, MAX_GROUPS_PER_ROW)
    this.agentRows = Math.ceil(groups / this.agentRowGroups)

    this.paramsBuffer = device.createBuffer({
      label: 'params',
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const particles = device.createBuffer({
      label: 'particles',
      size: settings.count * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE,
    })
    const trailUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    const trails = (this.trails = [0, 1].map((n) =>
      device.createBuffer({ label: `trail ${n}`, size: cells * 4, usage: trailUsage }),
    ))
    this.depositBuffer = device.createBuffer({
      label: 'deposits',
      size: cells * 4,
      usage: trailUsage,
    })
    this.activityBuffer = device.createBuffer({
      label: 'activity',
      size: cells * 4,
      usage: trailUsage,
    })

    this.buffers = [this.paramsBuffer, particles, this.depositBuffer, this.activityBuffer, ...trails]

    const uniform: GPUBufferBindingLayout = { type: 'uniform' }
    const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' }
    const readWrite: GPUBufferBindingLayout = { type: 'storage' }
    const COMPUTE = GPUShaderStage.COMPUTE
    const FRAGMENT = GPUShaderStage.FRAGMENT

    const agentLayout = device.createBindGroupLayout({
      label: 'agents',
      entries: [
        { binding: 0, visibility: COMPUTE, buffer: uniform },
        { binding: 1, visibility: COMPUTE, buffer: readWrite },
        { binding: 2, visibility: COMPUTE, buffer: readOnly },
        { binding: 3, visibility: COMPUTE, buffer: readWrite },
      ],
    })
    const diffuseLayout = device.createBindGroupLayout({
      label: 'diffuse',
      entries: [
        { binding: 0, visibility: COMPUTE, buffer: uniform },
        { binding: 1, visibility: COMPUTE, buffer: readOnly },
        { binding: 2, visibility: COMPUTE, buffer: readOnly },
        { binding: 3, visibility: COMPUTE, buffer: readWrite },
        { binding: 4, visibility: COMPUTE, buffer: readWrite },
      ],
    })
    const renderLayout = device.createBindGroupLayout({
      label: 'render',
      entries: [
        { binding: 0, visibility: FRAGMENT, buffer: uniform },
        { binding: 1, visibility: FRAGMENT, buffer: readOnly },
        { binding: 2, visibility: FRAGMENT, buffer: readOnly },
      ],
    })

    const agentPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [agentLayout] })
    this.initPipeline = device.createComputePipeline({
      label: 'init',
      layout: agentPipelineLayout,
      compute: { module: agents, entryPoint: 'init' },
    })
    this.stepPipeline = device.createComputePipeline({
      label: 'step',
      layout: agentPipelineLayout,
      compute: { module: agents, entryPoint: 'step' },
    })
    this.gatherPipeline = device.createComputePipeline({
      label: 'gather',
      layout: agentPipelineLayout,
      compute: { module: agents, entryPoint: 'gather' },
    })
    this.diffusePipeline = device.createComputePipeline({
      label: 'diffuse',
      layout: device.createPipelineLayout({ bindGroupLayouts: [diffuseLayout] }),
      compute: { module: diffuse, entryPoint: 'diffuse' },
    })
    const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderLayout] })
    const renderTo = (label: string, target: GPUTextureFormat): GPURenderPipeline =>
      device.createRenderPipeline({
        label,
        layout: renderPipelineLayout,
        vertex: { module: render, entryPoint: 'vertex' },
        fragment: { module: render, entryPoint: 'fragment', targets: [{ format: target }] },
        primitive: { topology: 'triangle-list' },
      })
    this.renderPipeline = renderTo('render', format)
    this.posterPipeline = renderTo('poster', 'rgba8unorm')

    const params = { buffer: this.paramsBuffer }
    this.agentGroups = [0, 1].map((n) =>
      device.createBindGroup({
        layout: agentLayout,
        entries: [
          { binding: 0, resource: params },
          { binding: 1, resource: { buffer: particles } },
          { binding: 2, resource: { buffer: trails[n] } },
          { binding: 3, resource: { buffer: this.depositBuffer } },
        ],
      }),
    )
    this.diffuseGroups = [0, 1].map((n) =>
      device.createBindGroup({
        layout: diffuseLayout,
        entries: [
          { binding: 0, resource: params },
          { binding: 1, resource: { buffer: trails[n] } },
          { binding: 2, resource: { buffer: this.depositBuffer } },
          { binding: 3, resource: { buffer: trails[1 - n] } },
          { binding: 4, resource: { buffer: this.activityBuffer } },
        ],
      }),
    )
    this.renderGroups = [0, 1].map((n) =>
      device.createBindGroup({
        layout: renderLayout,
        entries: [
          { binding: 0, resource: params },
          { binding: 1, resource: { buffer: trails[n] } },
          { binding: 2, resource: { buffer: this.activityBuffer } },
        ],
      }),
    )

    this.runInit()
  }

  get frameCount(): number {
    return this.frame
  }

  get gathering(): boolean {
    return this.gatherLeft > 0
  }

  // Grow a new form. Particles first stream to the new start arrangement, then the
  // trail is wiped and the run starts from step 0, so the result depends only on
  // the word and never on what was on screen before.
  transitionTo(form: Form): void {
    this.pending = form
    this.gatherLeft = GATHER_STEPS
  }

  // Feed the organism at a point. Strength 0 stops feeding. Grid coordinates.
  setPointer(x: number, y: number, strength: number): void {
    const share = this.inGrid(x, y) ? Math.max(0, Math.min(1, strength)) : 0
    this.pointerX = x
    this.pointerY = y
    this.pointerFeed = share * FEED_STRENGTH
  }

  // Any real input, even one that feeds nothing, holds the idle drift off.
  touch(): void {
    this.lastTouchStep = this.frame
  }

  // Tear a hole. It applies over a few steps so it is unmistakable, then heals.
  wound(x: number, y: number): void {
    if (!this.inGrid(x, y)) return
    this.woundX = x
    this.woundY = y
    this.woundLeft = WOUND_STEPS
  }

  private inGrid(x: number, y: number): boolean {
    // Cell centres sit at whole numbers, so the field spans -0.5 to grid - 0.5.
    const grid = this.settings.grid
    return x >= -0.5 && y >= -0.5 && x <= grid - 0.5 && y <= grid - 0.5
  }

  // Replace the parameters that decide the form, leaving the arrangement alone.
  // Used while typing, so the organism reshapes without restarting.
  setLook(form: Form): void {
    const { seed, startShape, heading, shapeSize } = this.form
    this.form = { ...form, seed, startShape, heading, shapeSize }
  }

  get look(): Form {
    return this.form
  }

  // Cut straight to a form with no entrance (first load, tier change).
  reset(form: Form): void {
    this.form = form
    this.pending = null
    this.gatherLeft = 0
    this.runInit()
  }

  destroy(): void {
    for (const buffer of this.buffers) buffer.destroy()
  }

  // Resolves once the GPU has finished everything submitted so far.
  idle(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone()
  }

  private runInit(): void {
    this.frame = 0
    this.source = 0
    this.lastTouchStep = 0
    this.writeParams()
    const encoder = this.device.createCommandEncoder({ label: 'init' })
    for (const trail of this.trails) encoder.clearBuffer(trail)
    encoder.clearBuffer(this.activityBuffer)
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.initPipeline)
    pass.setBindGroup(0, this.agentGroups[0])
    pass.dispatchWorkgroups(this.agentRowGroups, this.agentRows)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  // Brightness envelope: dims out while gathering, blooms in from step 0.
  private fade(): number {
    if (this.gatherLeft > 0) {
      const t = this.gatherLeft / GATHER_STEPS
      return t * t * (3 - 2 * t)
    }
    const t = Math.min(this.frame / FADE_IN_STEPS, 1)
    return t * t * (3 - 2 * t)
  }

  private writeParams(quality = 0, fade = this.fade()): void {
    const s = this.settings
    // While gathering, the target arrangement comes from the pending form.
    const f = this.gatherLeft > 0 && this.pending ? this.pending : this.form
    const look = this.form
    const d = this.paramsData
    d.setUint32(0, s.grid, true)
    d.setUint32(4, s.grid, true)
    d.setUint32(8, s.count, true)
    d.setUint32(12, this.frame, true)
    d.setUint32(16, f.seed >>> 0, true)
    d.setUint32(20, this.agentRowGroups * AGENT_WORKGROUP, true)
    d.setUint32(24, Math.max(1, Math.round((TRAIL_SCALE * REFERENCE_COUNT) / s.count)), true)
    d.setUint32(28, f.startShape, true)
    d.setFloat32(32, look.sensorAngle, true)
    d.setFloat32(36, look.sensorDist, true)
    d.setFloat32(40, look.turnAngle, true)
    d.setFloat32(44, look.stepSize, true)
    d.setFloat32(48, this.gatherLeft > 0 ? Math.min(look.decay, GATHER_DECAY) : look.decay, true)
    d.setFloat32(52, this.canvasW, true)
    d.setFloat32(56, this.canvasH, true)
    d.setFloat32(60, look.exposure, true)
    d.setFloat32(64, look.hue, true)
    d.setFloat32(68, fade, true)
    // Ease in: particles peel away slowly, then rush, so the streaming is visible.
    const progress = 1 - this.gatherLeft / GATHER_STEPS
    d.setFloat32(72, 0.012 + 0.2 * progress * progress, true)
    d.setUint32(76, quality, true)
    d.setUint32(80, f.heading, true)
    d.setFloat32(84, f.shapeSize, true)
    d.setFloat32(88, look.crowd, true)
    const wounding = this.woundLeft > 0
    // Idle drift stands in for the pointer when nothing is feeding and nothing
    // has touched the field lately. It never runs during an entrance.
    const drifting =
      this.pointerFeed === 0 && this.gatherLeft === 0 && isIdle(this.frame, this.lastTouchStep)
    const at = drifting
      ? driftAt(this.frame, s.grid)
      : { x: this.pointerX, y: this.pointerY }
    const feed = drifting ? IDLE_STRENGTH * FEED_STRENGTH : this.pointerFeed
    d.setFloat32(92, wounding ? this.woundX : at.x, true)
    d.setFloat32(96, wounding ? this.woundY : at.y, true)
    d.setFloat32(100, wounding ? 0 : feed, true)
    d.setFloat32(104, wounding ? 1 : 0, true)
    d.setFloat32(108, wounding ? WOUND_RADIUS : this.pointerRadius, true)
    d.setFloat32(112, ACTIVITY_DECAY, true)
    d.setFloat32(116, look.island, true)
    d.setFloat32(120, look.modulation, true)
    this.device.queue.writeBuffer(this.paramsBuffer, 0, d.buffer)
  }

  // One simulation step. Each step is its own submit because the frame number
  // lives in the uniform buffer, and a buffer write lands between submits.
  step(): void {
    this.writeParams()
    const gathering = this.gatherLeft > 0
    const encoder = this.device.createCommandEncoder({ label: 'step' })
    encoder.clearBuffer(this.depositBuffer)
    const compute = encoder.beginComputePass()
    compute.setPipeline(gathering ? this.gatherPipeline : this.stepPipeline)
    compute.setBindGroup(0, this.agentGroups[this.source])
    compute.dispatchWorkgroups(this.agentRowGroups, this.agentRows)
    compute.setPipeline(this.diffusePipeline)
    compute.setBindGroup(0, this.diffuseGroups[this.source])
    const tiles = Math.ceil(this.settings.grid / DIFFUSE_WORKGROUP)
    compute.dispatchWorkgroups(tiles, tiles)
    compute.end()
    this.device.queue.submit([encoder.finish()])
    this.source = 1 - this.source
    this.frame += 1
    if (this.woundLeft > 0) this.woundLeft -= 1

    if (gathering) {
      this.gatherLeft -= 1
      if (this.gatherLeft === 0 && this.pending) this.reset(this.pending)
    }
  }

  draw(target: GPUTextureView, canvasW: number, canvasH: number): void {
    this.canvasW = canvasW
    this.canvasH = canvasH
    this.encodeDraw(target, this.renderPipeline, 0, this.fade())
  }

  // Poster draw: square, bicubic, full brightness. Restores the live canvas size after.
  drawPoster(target: GPUTextureView, size: number): void {
    const [w, h] = [this.canvasW, this.canvasH]
    this.canvasW = size
    this.canvasH = size
    this.encodeDraw(target, this.posterPipeline, 1, 1)
    this.canvasW = w
    this.canvasH = h
  }

  private encodeDraw(
    target: GPUTextureView,
    pipeline: GPURenderPipeline,
    quality: number,
    fade: number,
  ): void {
    this.writeParams(quality, fade)
    const encoder = this.device.createCommandEncoder({ label: 'draw' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.renderGroups[this.source])
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}
