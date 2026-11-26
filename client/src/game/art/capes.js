import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three'

import { CAPES } from '@shared/balance'
import { mulberry32 } from '@shared/rng'

/**
 * Capes, painted 10x16 pixels each into one small atlas (8 x 2 cells of 16x16), so
 * every cape in a round draws with one instanced mesh. Also gives each a preview image
 * for the backpack and the case reel.
 */

const W = 10
const H = 16
const COLS = 8
export const CAPE_IDS = Object.keys(CAPES)

const hex = (h) => {
  const n = parseInt((h || '#000000').slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`

/** Paints cape `id` with its top-left at (ox, oy). */
function paintCape(ctx, id, ox, oy) {
  const cape = CAPES[id]
  const [a, b, c] = (cape.colors || []).map(hex)
  const rng = mulberry32(id.length * 977 + id.charCodeAt(0))
  const put = (x, y, col) => {
    ctx.fillStyle = css(col)
    ctx.fillRect(ox + x, oy + y, 1, 1)
  }
  const each = (fn) => {
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, fn(x, y))
  }
  const dark = (col, k = 0.7) => col.map((v) => v * k)
  switch (cape.pattern) {
    case 'none':
      return
    case 'solid':
      each((x, y) => (x === 0 || x === W - 1 || y === H - 1 ? b : rng() < 0.15 ? dark(a, 0.9) : a))
      return
    case 'checker':
      each((x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? a : b))
      return
    case 'pixels': {
      const all = (cape.colors || []).map(hex)
      each(() => all[Math.floor(rng() * all.length)])
      return
    }
    case 'ghost':
      each((x, y) => {
        if ((y === 5 || y === 6) && (x === 3 || x === 6)) return b
        if (y === 10 && x >= 4 && x <= 5) return b
        return rng() < 0.2 ? dark(a, 0.92) : a
      })
      return
    case 'lucky': {
      const q = ['.####.', '##..##', '....##', '...##.', '..##..', '..##..', '......', '..##..']
      each((x, y) => {
        const qx = x - 2
        const qy = y - 4
        if (qx >= 0 && qx < 6 && qy >= 0 && qy < q.length && q[qy][qx] === '#') return b
        return x === 0 || x === W - 1 || y === 0 || y === H - 1 ? dark(a, 0.75) : a
      })
      return
    }
    case 'face':
      each((x, y) => {
        if ((y === 5 || y === 6) && (x === 2 || x === 3 || x === 6 || x === 7)) return b
        if (y === 10 && x >= 2 && x <= 7) return b
        if (y === 9 && (x === 2 || x === 7)) return b
        return rng() < 0.15 ? dark(a, 0.88) : a
      })
      return
    case 'flame':
      each((x, y) => {
        const h = 6 + Math.sin(x * 1.3) * 2 + rng() * 2
        return y > H - h ? (y > H - h * 0.5 ? c : b) : y > H - h - 3 ? a : dark(c, 0.5)
      })
      return
    case 'stars':
      each(() => (rng() < 0.08 ? b : rng() < 0.06 ? c : a))
      return
    case 'moon':
      each((x, y) => {
        const d = Math.hypot(x - 4.5, y - 5.5)
        return d < 3.2 ? (d < 2 ? b : dark(b, 0.8)) : rng() < 0.04 ? [255, 255, 255] : a
      })
      return
    case 'rainbow': {
      const bands = ['#ff4f4f', '#ff9f3b', '#ffe14d', '#5ee26a', '#3fa2ff', '#9d5cff'].map(hex)
      each((x, y) => bands[Math.floor((y / H) * bands.length)])
      return
    }
    case 'void':
      each((x, y) => {
        const d = Math.hypot(x - 4.5, y - 7.5)
        return d < 2 ? a : d < 3.5 + Math.sin(y) ? b : rng() < 0.1 ? c : a
      })
      return
    default:
      each(() => a || [200, 200, 200])
  }
}

let atlas = null
export function getCapeAtlas() {
  if (atlas) return atlas
  const canvas = document.createElement('canvas')
  canvas.width = COLS * 16
  canvas.height = Math.ceil(CAPE_IDS.length / COLS) * 16
  const ctx = canvas.getContext('2d')
  CAPE_IDS.forEach((id, i) => paintCape(ctx, id, (i % COLS) * 16, Math.floor(i / COLS) * 16))
  atlas = new CanvasTexture(canvas)
  atlas.magFilter = NearestFilter
  atlas.minFilter = NearestFilter
  atlas.generateMipmaps = false
  atlas.colorSpace = SRGBColorSpace
  return atlas
}

/** UV offset and scale of cape `id` in the atlas: [u0, v0, du, dv]. */
export function capeUV(id) {
  const i = Math.max(0, CAPE_IDS.indexOf(id))
  const rows = Math.ceil(CAPE_IDS.length / COLS)
  const w = COLS * 16
  const h = rows * 16
  return [((i % COLS) * 16) / w, 1 - (Math.floor(i / COLS) * 16 + H) / h, W / w, H / h]
}

const previews = new Map()
/** A 40x64 preview data URL of cape `id`. */
export function capePreview(id) {
  if (previews.has(id)) return previews.get(id)
  const canvas = document.createElement('canvas')
  canvas.width = W * 4
  canvas.height = H * 4
  const ctx = canvas.getContext('2d')
  ctx.scale(4, 4)
  if (CAPES[id]?.pattern === 'none') {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 0.5
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1)
    ctx.beginPath()
    ctx.moveTo(1, 1)
    ctx.lineTo(W - 1, H - 1)
    ctx.stroke()
  } else paintCape(ctx, id, 0, 0)
  const url = canvas.toDataURL()
  previews.set(id, url)
  return url
}
