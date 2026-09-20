import type { Form, Simulation } from './sim/simulation'
import type { Organism } from './seed'

// Development tools. main.ts imports this file only under import.meta.env.DEV, so
// none of it reaches the production bundle.
//
//   ?sensorDist=9&decay=0.85   override any Form field (angles in degrees)
//   ?tier=2                    force a particle tier (0 based)
//   ?warm=600                  run that many steps before the first frame
//   ?freeze                    stop stepping after the warm-up

const query = new URLSearchParams(location.search)
const DEGREES = new Set(['sensorAngle', 'turnAngle'])

export function applyOverrides(form: Form): void {
  const fields = form as unknown as Record<string, number>
  for (const key of Object.keys(fields)) {
    const raw = query.get(key)
    if (raw === null || raw === '' || Number.isNaN(Number(raw))) continue
    fields[key] = DEGREES.has(key) ? (Number(raw) * Math.PI) / 180 : Number(raw)
  }
}

export function tierOverride(tiers: number[]): number | undefined {
  const raw = query.get('tier')
  if (raw === null) return undefined
  return Math.max(0, Math.min(tiers.length - 1, Number(raw) || 0))
}

interface Hooks {
  canvas: HTMLCanvasElement
  device: GPUDevice
  context: GPUCanvasContext
  getSim(): Simulation
  getOrganism(): Organism
  grow(word: string): void
  freeze(on: boolean): void
}

export function install(hooks: Hooks): void {
  const warm = Math.min(Number(query.get('warm')) || 0, 5000)
  for (let i = 0; i < warm; i++) hooks.getSim().step()
  if (query.has('freeze')) hooks.freeze(true)

  const snapshot = (): string => {
    // Draw and read back in one task; a WebGPU canvas is only readable before it presents.
    const { canvas, context } = hooks
    hooks.getSim().draw(context.getCurrentTexture().createView(), canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }

  // Write a file into the project through the dev server (see vite.config.ts).
  const save = async (path: string, body: Blob): Promise<string> => {
    const response = await fetch(`/__save?path=${encodeURIComponent(path)}`, { method: 'POST', body })
    return response.text()
  }

  // Contact sheet: grow several forms one after another and tile their snapshots,
  // so a parameter sweep is judged side by side. Each entry is a word or a set of
  // Form overrides (angles in degrees).
  const sheet = async (
    entries: (string | Record<string, number>)[],
    steps = 400,
    columns = 4,
  ): Promise<void> => {
    hooks.freeze(true)
    const { organismFor } = await import('./seed')
    const tileW = 480
    const tileH = Math.round((tileW * hooks.canvas.height) / hooks.canvas.width)
    const board = document.createElement('canvas')
    board.width = tileW * columns
    board.height = tileH * Math.ceil(entries.length / columns)
    board.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:9'
    const ctx = board.getContext('2d')!
    document.getElementById('sheet')?.remove()
    board.id = 'sheet'
    document.body.append(board)
    for (const [n, entry] of entries.entries()) {
      const organism = organismFor(typeof entry === 'string' ? entry : 'sweep')
      if (typeof entry !== 'string') {
        const fields = organism.form as unknown as Record<string, number>
        for (const [key, value] of Object.entries(entry)) {
          fields[key] = DEGREES.has(key) ? (value * Math.PI) / 180 : value
        }
      }
      const sim = hooks.getSim()
      sim.reset(organism.form)
      for (let i = 0; i < steps; i++) sim.step()
      await sim.idle()
      const image = new Image()
      image.src = snapshot()
      await image.decode()
      const x = (n % columns) * tileW
      const y = Math.floor(n / columns) * tileH
      ctx.drawImage(image, x, y, tileW, tileH)
      ctx.fillStyle = '#fff'
      ctx.font = '15px ui-monospace, monospace'
      const label = typeof entry === 'string' ? `${entry} (${organism.family})` : String(n)
      ctx.fillText(label, x + 8, y + 20)
    }
  }

  Object.assign(window, { __dev: { ...hooks, snapshot, save, sheet } })
}
