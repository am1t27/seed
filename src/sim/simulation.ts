import paramsWgsl from './params.wgsl?raw'
import agentsWgsl from './agents.wgsl?raw'
import diffuseWgsl from './diffuse.wgsl?raw'
import renderWgsl from './render.wgsl?raw'

// Step 2 values, fixed by hand. Step 3 replaces these with the word's hash.
export interface SimSettings {
  grid: number
  count: number
  seed: number
  startShape: 0 | 1 | 2
  sensorAngle: number // radians
  sensorDist: number // grid cells
  turnAngle: number // radians
  stepSize: number // grid cells per step
  deposit: number // trail amount per particle per step
  decay: number // trail kept per step, 0..1
  exposure: number
}

const TRAIL_SCALE = 1024
const PARAMS_BYTES = 64
const PARTICLE_BYTES = 16
const AGENT_WORKGROUP = 64
const DIFFUSE_WORKGROUP = 8
const MAX_GROUPS_PER_ROW = 32768

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
  private readonly device: GPUDevice
  private readonly paramsBuffer: GPUBuffer
  private readonly paramsData = new DataView(new ArrayBuffer(PARAMS_BYTES))
  private readonly depositBuffer: GPUBuffer
  private readonly initPipeline: GPUComputePipeline
  private readonly stepPipeline: GPUComputePipeline
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

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    settings: SimSettings,
  ): Promise<Simulation> {
    device.pushErrorScope('validation')
    const [agents, diffuse, render] = await Promise.all([
      compile(device, 'agents', agentsWgsl),
      compile(device, 'diffuse', diffuseWgsl),
      compile(device, 'render', renderWgsl),
    ])
    const sim = new Simulation(device, format, settings, agents, diffuse, render)
    const error = await device.popErrorScope()
    if (error) throw new Error(`WebGPU validation failed: ${error.message}`)
    return sim
  }

  private constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    settings: SimSettings,
    agents: GPUShaderModule,
    diffuse: GPUShaderModule,
    render: GPUShaderModule,
  ) {
    this.device = device
    this.settings = settings

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
    const trails = [0, 1].map((n) =>
      device.createBuffer({ label: `trail ${n}`, size: cells * 4, usage: trailUsage }),
    )
    this.depositBuffer = device.createBuffer({
      label: 'deposits',
      size: cells * 4,
      usage: trailUsage,
    })

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
      ],
    })
    const renderLayout = device.createBindGroupLayout({
      label: 'render',
      entries: [
        { binding: 0, visibility: FRAGMENT, buffer: uniform },
        { binding: 1, visibility: FRAGMENT, buffer: readOnly },
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
    this.diffusePipeline = device.createComputePipeline({
      label: 'diffuse',
      layout: device.createPipelineLayout({ bindGroupLayouts: [diffuseLayout] }),
      compute: { module: diffuse, entryPoint: 'diffuse' },
    })
    this.renderPipeline = device.createRenderPipeline({
      label: 'render',
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
      vertex: { module: render, entryPoint: 'vertex' },
      fragment: { module: render, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })

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
        ],
      }),
    )
    this.renderGroups = [0, 1].map((n) =>
      device.createBindGroup({
        layout: renderLayout,
        entries: [
          { binding: 0, resource: params },
          { binding: 1, resource: { buffer: trails[n] } },
        ],
      }),
    )

    // Buffers start zeroed, so only the particles need a first pass.
    this.writeParams()
    const encoder = device.createCommandEncoder({ label: 'init' })
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.initPipeline)
    pass.setBindGroup(0, this.agentGroups[0])
    pass.dispatchWorkgroups(this.agentRowGroups, this.agentRows)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  get frameCount(): number {
    return this.frame
  }

  private writeParams(): void {
    const s = this.settings
    const d = this.paramsData
    d.setUint32(0, s.grid, true)
    d.setUint32(4, s.grid, true)
    d.setUint32(8, s.count, true)
    d.setUint32(12, this.frame, true)
    d.setUint32(16, s.seed >>> 0, true)
    d.setUint32(20, this.agentRowGroups * AGENT_WORKGROUP, true)
    d.setUint32(24, Math.round(s.deposit * TRAIL_SCALE), true)
    d.setUint32(28, s.startShape, true)
    d.setFloat32(32, s.sensorAngle, true)
    d.setFloat32(36, s.sensorDist, true)
    d.setFloat32(40, s.turnAngle, true)
    d.setFloat32(44, s.stepSize, true)
    d.setFloat32(48, s.decay, true)
    d.setFloat32(52, this.canvasW, true)
    d.setFloat32(56, this.canvasH, true)
    d.setFloat32(60, s.exposure, true)
    this.device.queue.writeBuffer(this.paramsBuffer, 0, d.buffer)
  }

  // One simulation step. Each step is its own submit because the frame number
  // lives in the uniform buffer, and a buffer write lands between submits.
  step(): void {
    this.writeParams()
    const encoder = this.device.createCommandEncoder({ label: 'step' })
    encoder.clearBuffer(this.depositBuffer)
    const compute = encoder.beginComputePass()
    compute.setPipeline(this.stepPipeline)
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
  }

  draw(target: GPUTextureView, canvasW: number, canvasH: number): void {
    this.canvasW = canvasW
    this.canvasH = canvasH
    this.writeParams()
    const encoder = this.device.createCommandEncoder({ label: 'draw' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    })
    pass.setPipeline(this.renderPipeline)
    pass.setBindGroup(0, this.renderGroups[this.source])
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}
