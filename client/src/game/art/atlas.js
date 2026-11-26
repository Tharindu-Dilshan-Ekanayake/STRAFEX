import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'

import { mulberry32 } from '@shared/rng'
import { BLOCKS } from '@shared/voxel'

/**
 * Every block texture, painted pixel by pixel at start-up into one small atlas: 16x16
 * tiles in 20x20 cells on a 160x160 canvas (100 KB of texture memory). Nothing is
 * downloaded, and one texture means one material for all the terrain.
 *
 * Each tile is ringed by a 2-pixel copy of its own edge: with antialiasing the GPU may
 * sample a hair outside a face, and that must land on the same colour, not on the
 * neighbouring tile (which showed as thin coloured lines along block edges).
 */

import { CELL, GRID, PAD, SIZE, T, TILE_ORDER } from './atlasLayout'

export { tileRect, tileUV } from './atlasLayout'

const hex = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)))

/** A tile painter: `put(x, y, rgb, a)` writes a pixel; helpers for the common patterns. */
function painter(data, ox, oy, seed) {
  const rng = mulberry32(seed)
  const put = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= T || y >= T) return
    const i = ((oy + y) * SIZE + ox + x) * 4
    data[i] = clamp8(c[0])
    data[i + 1] = clamp8(c[1])
    data[i + 2] = clamp8(c[2])
    data[i + 3] = a
  }
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
  const vary = (c, amt) => {
    const k = 1 + (rng() - 0.5) * amt
    return shade(c, k)
  }
  const noise = (base, amt = 0.18) => {
    const c = hex(base)
    for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) put(x, y, vary(c, amt))
  }
  const speck = (color, chance, amt = 0.1) => {
    const c = hex(color)
    for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) if (rng() < chance) put(x, y, vary(c, amt))
  }
  const clear = () => {
    for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) put(x, y, [0, 0, 0], 0)
  }
  return { put, noise, speck, vary, shade, rng, clear }
}

/** The "?" on a lucky block, 1 = white, 2 = dark outline. 8 wide x 10 tall. */
const QUESTION = [
  '02222220',
  '22111122',
  '21122112',
  '22222112',
  '00022112',
  '00221122',
  '00211220',
  '00222200',
  '00211200',
  '00222200',
]

const TILES = {
  dirt: (p) => {
    p.noise('#8a5a3a', 0.22)
    p.speck('#6b4128', 0.12)
    p.speck('#a8774f', 0.06)
  },
  grass_top: (p) => {
    p.noise('#62c043', 0.2)
    p.speck('#7fd85a', 0.12)
    p.speck('#4c9a33', 0.1)
  },
  grass_side: (p) => {
    TILES.dirt(p)
    const g = hex('#62c043')
    for (let x = 0; x < T; x += 1) {
      const depth = 3 + Math.floor(p.rng() * 2.5)
      for (let y = 0; y < depth; y += 1) p.put(x, y, p.vary(g, 0.2))
    }
  },
  stone: (p) => {
    p.noise('#8d8d8d', 0.14)
    p.speck('#6f6f6f', 0.14)
    p.speck('#a3a3a3', 0.06)
  },
  ore: (p) => {
    TILES.stone(p)
    const c = hex('#4fe0e8')
    for (let k = 0; k < 4; k += 1) {
      const x = 2 + Math.floor(p.rng() * 11)
      const y = 2 + Math.floor(p.rng() * 11)
      p.put(x, y, c)
      p.put(x + 1, y, p.shade(c, 0.8))
      p.put(x, y + 1, p.shade(c, 0.7))
    }
  },
  stone_bricks: (p) => {
    p.noise('#8f8f93', 0.1)
    const m = hex('#5c5c60')
    for (let x = 0; x < T; x += 1) {
      p.put(x, 7, m)
      p.put(x, 15, m)
    }
    for (let y = 0; y < 7; y += 1) p.put(7, y, m)
    for (let y = 8; y < 15; y += 1) {
      p.put(0, y, m)
      p.put(15, y, m)
    }
  },
  brick: (p) => {
    p.noise('#b0503c', 0.14)
    const m = hex('#d8cfc4')
    for (let y = 3; y < T; y += 4) for (let x = 0; x < T; x += 1) p.put(x, y, p.vary(m, 0.1))
    for (let row = 0; row < 4; row += 1) {
      const off = row % 2 ? 4 : 0
      for (let x = off; x < T; x += 8) for (let y = row * 4; y < row * 4 + 3; y += 1) p.put(x, y, p.vary(m, 0.1))
    }
  },
  planks: (p) => {
    p.noise('#b8874b', 0.1)
    const seam = hex('#7c5530')
    for (let y = 3; y < T; y += 4) for (let x = 0; x < T; x += 1) p.put(x, y, seam)
    for (let row = 0; row < 4; row += 1) p.put((row * 5 + 3) % T, row * 4 + 1, seam)
  },
  log_side: (p) => {
    p.noise('#6d4a2a', 0.14)
    const d = hex('#4f3319')
    for (let x = 1; x < T; x += 3) for (let y = 0; y < T; y += 1) if (p.rng() < 0.7) p.put(x, y, p.vary(d, 0.1))
  },
  log_top: (p) => {
    p.noise('#b98c55', 0.08)
    const ring = hex('#8a6338')
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        const r = Math.hypot(x - 7.5, y - 7.5)
        if (r > 6.8) p.put(x, y, hex('#6d4a2a'))
        else if (Math.round(r) % 3 === 0) p.put(x, y, ring)
      }
    }
  },
  leaves: (p) => {
    const g = hex('#3f9a2e')
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        if (p.rng() < 0.16) p.put(x, y, [0, 0, 0], 0)
        else p.put(x, y, p.vary(g, 0.35))
      }
    }
  },
  sand: (p) => {
    p.noise('#e6d394', 0.1)
    p.speck('#cdb874', 0.1)
  },
  sandstone: (p) => {
    p.noise('#d8bf78', 0.08)
    const band = hex('#c2a65d')
    for (const y of [4, 5, 11]) for (let x = 0; x < T; x += 1) p.put(x, y, p.vary(band, 0.06))
  },
  sandstone_top: (p) => {
    p.noise('#dcc480', 0.06)
  },
  snow: (p) => {
    p.noise('#f2f7ff', 0.05)
    p.speck('#dfe9f7', 0.1, 0.03)
  },
  snow_side: (p) => {
    TILES.dirt(p)
    const s = hex('#f2f7ff')
    for (let x = 0; x < T; x += 1) {
      const depth = 3 + Math.floor(p.rng() * 3)
      for (let y = 0; y < depth; y += 1) p.put(x, y, p.vary(s, 0.05))
    }
  },
  ice: (p) => {
    p.noise('#9fd3f7', 0.06)
    const l = hex('#d6f0ff')
    for (let k = 0; k < 3; k += 1) {
      const x0 = Math.floor(p.rng() * T)
      for (let i = 0; i < 6; i += 1) p.put(x0 + i, 3 + k * 5 - i, l)
    }
  },
  wool_white: (p) => woolTile(p, '#eeeeee'),
  wool_red: (p) => woolTile(p, '#c8352e'),
  wool_blue: (p) => woolTile(p, '#3359c4'),
  wool_yellow: (p) => woolTile(p, '#f4cb35'),
  candy_pink: (p) => {
    p.noise('#ff8fc7', 0.08)
    const colors = ['#ffffff', '#7af0ff', '#fff37a', '#9cff8a']
    for (let k = 0; k < 7; k += 1) p.put(Math.floor(p.rng() * T), Math.floor(p.rng() * T), hex(colors[k % colors.length]))
  },
  candy_stripe: (p) => {
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) p.put(x, y, p.vary(hex((x + y) % 8 < 4 ? '#e8343a' : '#fafafa'), 0.05))
    }
  },
  frosting_top: (p) => {
    p.noise('#fff0f6', 0.04)
    const colors = ['#ff4f8b', '#4fd6ff', '#ffd84f', '#7cff6b']
    for (let k = 0; k < 9; k += 1) p.put(Math.floor(p.rng() * T), Math.floor(p.rng() * T), hex(colors[k % colors.length]))
  },
  frosting_side: (p) => {
    TILES.candy_pink(p)
    const w = hex('#fff0f6')
    for (let x = 0; x < T; x += 1) {
      const depth = 3 + Math.floor(Math.abs(Math.sin(x * 1.7)) * 4)
      for (let y = 0; y < depth; y += 1) p.put(x, y, p.vary(w, 0.03))
    }
  },
  glass: (p) => {
    p.clear()
    const f = hex('#dff4ff')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, f)
      p.put(i, 15, f)
      p.put(0, i, f)
      p.put(15, i, f)
    }
    for (let i = 0; i < 3; i += 1) p.put(3 + i, 5 - i, [255, 255, 255])
    for (let i = 0; i < 2; i += 1) p.put(9 + i, 12 - i, [255, 255, 255])
  },
  cage: (p) => {
    p.clear()
    const f = hex('#8fe3ff')
    for (let i = 0; i < T; i += 1) {
      for (const k of [0, 1, 14, 15]) {
        p.put(i, k, f)
        p.put(k, i, f)
      }
    }
    for (let i = 0; i < 4; i += 1) p.put(4 + i, 7 - i, [255, 255, 255], 200)
  },
  lucky: (p) => luckyTile(p, '#ffcb1f', '#e08a0c'),
  lucky_rare: (p) => luckyTile(p, '#b257ff', '#6b23b8'),
  gold: (p) => {
    p.noise('#ffd23b', 0.08)
    const shine = hex('#fff6b8')
    for (let i = 0; i < 5; i += 1) p.put(2 + i, 6 - i, shine)
    const edge = hex('#d49a12')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 15, edge)
      p.put(15, i, edge)
    }
  },
  darkstone: (p) => {
    p.noise('#2b2236', 0.2)
    p.speck('#4a3a5e', 0.1)
  },
  tnt_side: (p) => {
    p.noise('#d23a2a', 0.08)
    const w = hex('#f2f2f2')
    for (let y = 5; y < 11; y += 1) for (let x = 0; x < T; x += 1) p.put(x, y, w)
    const k = [0, 0, 0]
    const letters = ['111.1..1.111', '.1..11.1..1.', '.1..1.11..1.', '.1..1..1..1.']
    letters.forEach((row, y) => [...row].forEach((ch, x) => ch === '1' && p.put(x + 2, y + 6, k)))
  },
  tnt_top: (p) => {
    p.noise('#c9c9c9', 0.06)
    p.put(7, 7, [40, 40, 40])
    p.put(8, 7, [40, 40, 40])
    p.put(7, 8, [40, 40, 40])
    p.put(8, 8, [40, 40, 40])
  },
  lamp: (p) => {
    p.noise('#ffd774', 0.1)
    const g = hex('#a8661c')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, g)
      p.put(i, 15, g)
      p.put(0, i, g)
      p.put(15, i, g)
      p.put(i, 7, g)
      p.put(7, i, g)
    }
  },
  cactus_side: (p) => {
    p.noise('#3f9b39', 0.1)
    const d = hex('#2b6e27')
    for (let y = 0; y < T; y += 1) {
      p.put(0, y, d)
      p.put(15, y, d)
      p.put(5, y, d)
      p.put(10, y, d)
    }
    for (let k = 0; k < 6; k += 1) p.put(Math.floor(p.rng() * T), Math.floor(p.rng() * T), [20, 20, 20])
  },
  cactus_top: (p) => {
    p.noise('#53b34b', 0.08)
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, [43, 110, 39])
      p.put(i, 15, [43, 110, 39])
      p.put(0, i, [43, 110, 39])
      p.put(15, i, [43, 110, 39])
    }
  },
  path_top: (p) => {
    p.noise('#a8834f', 0.1)
    p.speck('#8f6d3f', 0.12)
  },
  flower_red: (p) => flowerTile(p, '#e8332b'),
  flower_yellow: (p) => flowerTile(p, '#ffd93b'),
  water: (p) => {
    p.noise('#2f86e0', 0.06)
    const l = hex('#7fc4ff')
    for (let y = 2; y < T; y += 5) for (let x = 0; x < T; x += 1) if ((x + y * 2) % 7 < 3) p.put(x, y + (x % 3 === 0 ? 1 : 0), l)
  },
  quartz: (p) => {
    p.noise('#efe9e1', 0.03)
    const l = hex('#d9d0c4')
    for (let y = 0; y < T; y += 1) {
      p.put(0, y, l)
      p.put(15, y, l)
    }
    for (let x = 0; x < T; x += 1) p.put(x, 15, l)
  },
  quartz_top: (p) => {
    p.noise('#f4efe8', 0.025)
    const l = hex('#ddd4c8')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, l)
      p.put(i, 15, l)
      p.put(0, i, l)
      p.put(15, i, l)
    }
  },
  tall_grass: (p) => {
    p.clear()
    const g = hex('#5cb83c')
    for (let k = 0; k < 7; k += 1) {
      const x = 1 + k * 2
      const h = 6 + Math.floor(p.rng() * 9)
      for (let y = 0; y < h; y += 1) p.put(x + (y > h - 3 ? (k % 2 ? 1 : -1) : 0), 15 - y, p.vary(g, 0.25))
    }
  },
}

function woolTile(p, base) {
  p.noise(base, 0.08)
  const c = hex(base)
  for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) if ((x * 3 + y * 5) % 7 === 0) p.put(x, y, p.shade(c, 0.88))
}

function luckyTile(p, face, edge) {
  p.noise(face, 0.05)
  const e = hex(edge)
  const hi = hex('#fff6c8')
  for (let i = 0; i < T; i += 1) {
    p.put(i, 0, e)
    p.put(i, 15, e)
    p.put(0, i, e)
    p.put(15, i, e)
  }
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) p.put(x, y, hi)
  QUESTION.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '1') p.put(x + 4, y + 3, [255, 255, 255])
      else if (ch === '2') p.put(x + 4, y + 3, p.shade(e, 0.7))
    }),
  )
}

function flowerTile(p, petal) {
  p.clear()
  const stem = hex('#3e8f2a')
  for (let y = 7; y < T; y += 1) p.put(7, y, stem)
  p.put(6, 11, stem)
  p.put(8, 12, stem)
  const c = hex(petal)
  for (const [x, y] of [[7, 3], [6, 4], [8, 4], [7, 5], [6, 5], [8, 5], [7, 4]]) p.put(x, y, c)
  p.put(7, 4, [255, 230, 80])
}

const TILE_NAMES = TILE_ORDER
if (import.meta.env.DEV && TILE_ORDER.some((name) => !TILES[name])) console.error('[atlas] TILE_ORDER names a tile with no painter')

let atlasTexture = null
let atlasCanvas = null
/** Average colour of each tile (for particles), filled with the atlas. */
const tileColors = new Map()

function paintAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(SIZE, SIZE)
  TILE_NAMES.forEach((name, i) => {
    const cx = (i % GRID) * CELL
    const cy = Math.floor(i / GRID) * CELL
    const ox = cx + PAD
    const oy = cy + PAD
    TILES[name](painter(img.data, ox, oy, 1000 + i * 7919))
    // The gutter: each border pixel copies the nearest edge pixel of the tile.
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        if (x >= PAD && x < PAD + T && y >= PAD && y < PAD + T) continue
        const sx = Math.min(T - 1, Math.max(0, x - PAD))
        const sy = Math.min(T - 1, Math.max(0, y - PAD))
        const from = ((oy + sy) * SIZE + ox + sx) * 4
        const to = ((cy + y) * SIZE + cx + x) * 4
        for (let k = 0; k < 4; k += 1) img.data[to + k] = img.data[from + k]
      }
    }
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        const k = ((oy + y) * SIZE + ox + x) * 4
        if (img.data[k + 3] < 128) continue
        r += img.data[k]
        g += img.data[k + 1]
        b += img.data[k + 2]
        n += 1
      }
    }
    tileColors.set(name, n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1])
  })
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function getAtlasCanvas() {
  if (!atlasCanvas) atlasCanvas = paintAtlas()
  return atlasCanvas
}

/** The terrain texture (shared by every chunk, the item models of blocks and the crack overlay). */
export function getAtlas() {
  if (atlasTexture) return atlasTexture
  atlasTexture = new CanvasTexture(getAtlasCanvas())
  atlasTexture.magFilter = NearestFilter
  atlasTexture.minFilter = NearestFilter
  atlasTexture.generateMipmaps = false
  atlasTexture.colorSpace = SRGBColorSpace
  return atlasTexture
}

export function tileColor(name) {
  getAtlasCanvas()
  return tileColors.get(name) || [1, 1, 1]
}

/** Average colour of a block's side, for its break particles. */
export function blockColor(id) {
  const def = BLOCKS[id]
  return tileColor(def?.tex[1] || 'dirt')
}

// --- Small extra textures ----------------------------------------------------------------

function canvasTex(w, h, paint, repeat = false) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  paint(ctx)
  const tex = new CanvasTexture(canvas)
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = SRGBColorSpace
  if (repeat) {
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
  }
  return tex
}

/** Five crack stages stacked vertically (16 x 80); pick one with `offset.y`. */
export function makeCrackTexture() {
  return canvasTex(16, 80, (ctx) => {
    const rng = mulberry32(99)
    const lines = []
    for (let k = 0; k < 16; k += 1) {
      let x = 8
      let y = 8
      const pts = []
      const a = rng() * Math.PI * 2
      for (let s = 0; s < 6; s += 1) {
        x += Math.cos(a + (rng() - 0.5)) * 1.4
        y += Math.sin(a + (rng() - 0.5)) * 1.4
        pts.push([Math.round(x), Math.round(y)])
      }
      lines.push(pts)
    }
    for (let stage = 0; stage < 5; stage += 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      const count = Math.min(lines.length, 3 + stage * 3)
      for (let k = 0; k < count; k += 1) {
        for (const [x, y] of lines[k].slice(0, 2 + stage)) {
          if (x >= 0 && y >= 0 && x < 16 && y < 16) ctx.fillRect(x, (4 - stage) * 16 + y, 1, 1)
        }
      }
    }
  })
}

/**
 * Tiling liquid textures, 32x32 pixel art: 'lava' (dark crust and bright channels),
 * 'water', and two overlay layers drawn additively on top - 'lavaGlow' (hot yellow
 * veins on black) and 'waterGlint' (sparse white glints on black).
 */
export function makeLiquidTexture(kind = 'lava') {
  return canvasTex(
    32,
    32,
    (ctx) => {
      const rng = mulberry32({ lava: 5, water: 6, lavaGlow: 7, waterGlint: 8 }[kind] || 5)
      // Smooth wrapping noise from a few sines (periodic over 32 pixels).
      const w = (2 * Math.PI) / 32
      const field = (x, y, k) => Math.sin(x * w * k + Math.sin(y * w * 2) * 1.6) + Math.sin(y * w * (k + 1) + Math.cos(x * w) * 1.3) * 0.8
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          const v = field(x, y, 2) + rng() * 0.35
          let c
          if (kind === 'lava') {
            const pal = ['#a8240a', '#d63e0d', '#f2620f', '#ff8a1c', '#ffb43b', '#ffd85c']
            c = pal[Math.max(0, Math.min(5, Math.floor((v + 1.9) * 1.5)))]
          } else if (kind === 'water') {
            const pal = ['#1f5fb8', '#2a73cf', '#3489e0', '#47a0ee', '#6bbdf7']
            c = pal[Math.max(0, Math.min(4, Math.floor((v + 1.9) * 1.25)))]
          } else if (kind === 'lavaGlow') {
            const vein = Math.abs(field(x, y, 3))
            c = vein < 0.12 ? '#ffe27a' : vein < 0.3 ? '#a85a10' : '#000000'
          } else {
            c = rng() < 0.035 ? '#ffffff' : Math.abs(field(x, y, 1)) < 0.08 ? '#7fb8e6' : '#000000'
          }
          ctx.fillStyle = c
          ctx.fillRect(x, y, 1, 1)
        }
      }
    },
    true,
  )
}
