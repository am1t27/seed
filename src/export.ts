import type { Simulation } from './sim/simulation'

// Poster export: draw the organism offscreen at poster size, read the pixels back,
// set the caption in 2D, encode a PNG.

const BYTES_PER_PIXEL = 4

// iOS caps canvas area at 4096 x 4096 and has tighter memory, so phones get 2048.
export function posterSize(device: GPUDevice, lowTier: boolean): number {
  const phone = matchMedia('(pointer: coarse)').matches
  const wanted = phone || lowTier ? 2048 : 4096
  const bufferCap = Math.floor(Math.sqrt(device.limits.maxBufferSize / BYTES_PER_PIXEL))
  return Math.min(wanted, device.limits.maxTextureDimension2D, bufferCap)
}

async function readPixels(device: GPUDevice, sim: Simulation, size: number): Promise<ImageData> {
  // size * 4 is a multiple of 256 for 2048 and 4096, which copyTextureToBuffer requires.
  const bytesPerRow = Math.ceil((size * BYTES_PER_PIXEL) / 256) * 256
  device.pushErrorScope('out-of-memory')
  device.pushErrorScope('validation')
  const texture = device.createTexture({
    label: 'poster',
    size: [size, size],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const buffer = device.createBuffer({
    label: 'poster readback',
    size: bytesPerRow * size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    sim.drawPoster(texture.createView(), size)
    const encoder = device.createCommandEncoder({ label: 'poster readback' })
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [size, size])
    device.queue.submit([encoder.finish()])
    const invalid = await device.popErrorScope()
    const exhausted = await device.popErrorScope()
    if (invalid || exhausted) throw new Error((invalid ?? exhausted)!.message)

    await buffer.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(buffer.getMappedRange())
    const pixels = new Uint8ClampedArray(size * size * BYTES_PER_PIXEL)
    if (bytesPerRow === size * BYTES_PER_PIXEL) {
      pixels.set(mapped)
    } else {
      for (let y = 0; y < size; y++) {
        const row = mapped.subarray(y * bytesPerRow, y * bytesPerRow + size * BYTES_PER_PIXEL)
        pixels.set(row, y * size * BYTES_PER_PIXEL)
      }
    }
    buffer.unmap()
    return new ImageData(pixels, size, size)
  } finally {
    texture.destroy()
    buffer.destroy()
  }
}

function drawCaption(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, size: number, word: string): void {
  const serif = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
  const fontSize = Math.round(size * 0.017)
  const y = size - Math.round(size * 0.04)
  const lead = 'grown from the word '
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(2, 5, 10, 0.95)'
  ctx.shadowBlur = fontSize * 0.9
  ctx.font = `italic 400 ${fontSize}px ${serif}`
  const leadWidth = ctx.measureText(lead).width
  const wordWidth = ctx.measureText(word).width
  const x = (size - leadWidth - wordWidth) / 2
  // Drawn twice: the first pass lays the shadow pool, the second keeps the glyphs crisp.
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = 'rgba(217, 242, 233, 0.66)'
    ctx.fillText(lead, x, y)
    ctx.fillStyle = 'rgba(217, 242, 233, 0.98)'
    ctx.fillText(word, x + leadWidth, y)
  }
}

export async function renderPoster(
  device: GPUDevice,
  sim: Simulation,
  size: number,
  word: string,
): Promise<Blob> {
  let image: ImageData
  try {
    image = await readPixels(device, sim, size)
  } catch (error) {
    if (size <= 1024) throw error
    // Not enough memory at this size: halve it rather than fail.
    return renderPoster(device, sim, size / 2, word)
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(image, 0, 0)
    drawCaption(ctx, image.width, word)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(image, 0, 0)
  drawCaption(ctx, image.width, word)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  )
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function posterFilename(word: string): string {
  const slug = word.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'organism'}.png`
}
