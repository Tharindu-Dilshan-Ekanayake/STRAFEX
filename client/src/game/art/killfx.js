import { CAPES } from '@shared/balance'

/**
 * Kill effects: what bursts where your victim stood. Each has a style from its
 * `pattern` and colours from balance.js (they live in the save's old cape slots):
 *
 * - `killFxBurst(id)`: how Effects.jsx spawns it - particle colours (0..1 rgb), how many,
 *   how fast, which way they drift, and whether a flash ring goes with it
 * - `killFxPreview(id)`: a 64x64 badge picture for the backpack, cases and shop
 */

const hex = (h) => {
  const n = parseInt((h || '#ffffff').slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const RAINBOW = ['#ff4f4f', '#ff9f3b', '#ffe14d', '#5ee26a', '#3fa2ff', '#9d5cff']

const bursts = new Map()

/**
 * `{ colors: [[r, g, b]], count, speed, gravity, ring: css colour | null, rise }` for
 * kill effect `id` (null for none).
 */
export function killFxBurst(id) {
  if (bursts.has(id)) return bursts.get(id)
  const fx = CAPES[id]
  let out = null
  if (fx && fx.pattern !== 'none') {
    const cols = (fx.pattern === 'rainbow' ? RAINBOW : fx.colors || ['#ffffff']).map((c) => hex(c).map((v) => v / 255))
    const base = { colors: cols, count: 28, speed: 6, gravity: 10, ring: null }
    const style = {
      solid: base,
      checker: { ...base, count: 24, speed: 5 },
      pixels: { ...base, count: 36, speed: 7 },
      ghost: { ...base, count: 22, speed: 2.5, gravity: -3 },
      lucky: { ...base, count: 32, speed: 8, ring: fx.colors?.[0] },
      face: { ...base, count: 26, speed: 6, ring: fx.colors?.[1] },
      flame: { ...base, count: 34, speed: 4, gravity: -6 },
      stars: { ...base, count: 34, speed: 5, gravity: 1, ring: fx.colors?.[2] },
      moon: { ...base, count: 28, speed: 6, ring: fx.colors?.[1] },
      rainbow: { ...base, count: 40, speed: 7, ring: '#ffffff' },
      void: { ...base, count: 36, speed: 3, gravity: -1.5, ring: fx.colors?.[1] },
    }[fx.pattern]
    out = { ...(style || base), flash: (style || base).ring || fx.colors?.[0] || '#ffffff' }
  }
  bursts.set(id, out)
  return out
}

const previews = new Map()

/** A 64x64 badge of kill effect `id`: rays and sparks in its colours on a dark disc. */
export function killFxPreview(id) {
  if (previews.has(id)) return previews.get(id)
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const fx = CAPES[id]
  ctx.imageSmoothingEnabled = false
  // The disc.
  ctx.fillStyle = '#1b1430'
  ctx.beginPath()
  ctx.arc(32, 32, 30, 0, Math.PI * 2)
  ctx.fill()
  if (!fx || fx.pattern === 'none') {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(18, 18)
    ctx.lineTo(46, 46)
    ctx.stroke()
  } else {
    const cols = fx.pattern === 'rainbow' ? RAINBOW : fx.colors || ['#ffffff']
    // Rays out from the middle, in blocky pixels.
    const rays = fx.pattern === 'pixels' || fx.pattern === 'rainbow' ? 12 : 8
    for (let i = 0; i < rays; i += 1) {
      const a = (i / rays) * Math.PI * 2 + 0.2
      ctx.fillStyle = cols[i % cols.length]
      for (let r = 8; r < 27; r += 4) {
        const s = Math.max(2, 6 - r / 6)
        ctx.fillRect(Math.round(32 + Math.cos(a) * r - s / 2), Math.round(32 + Math.sin(a) * r - s / 2), s, s)
      }
    }
    // The core: a face, a question mark, a moon - or a plain bright square.
    ctx.fillStyle = cols[0]
    if (fx.pattern === 'face') {
      ctx.fillRect(22, 22, 20, 20)
      ctx.fillStyle = '#1b1430'
      ctx.fillRect(26, 27, 3, 3)
      ctx.fillRect(35, 27, 3, 3)
      ctx.fillRect(26, 35, 12, 2)
    } else if (fx.pattern === 'lucky') {
      ctx.fillRect(25, 22, 14, 3)
      ctx.fillRect(36, 25, 3, 5)
      ctx.fillRect(30, 30, 6, 3)
      ctx.fillRect(30, 33, 3, 3)
      ctx.fillRect(30, 38, 3, 3)
    } else if (fx.pattern === 'moon' || fx.pattern === 'void') {
      ctx.fillStyle = cols[1] || cols[0]
      ctx.beginPath()
      ctx.arc(32, 32, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = cols[0]
      ctx.beginPath()
      ctx.arc(32, 32, 5, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(27, 27, 10, 10)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(29, 29, 3, 3)
    }
  }
  const url = canvas.toDataURL()
  previews.set(id, url)
  return url
}
