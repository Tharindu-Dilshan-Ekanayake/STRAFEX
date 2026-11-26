import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'

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
    p.noise('#7c5236', 0.2)
    p.speck('#5e3b25', 0.14)
    p.speck('#9a6c47', 0.07)
    p.speck('#8a8070', 0.03)
  },
  grass_top: (p) => {
    // Three greens in soft clumps, with darker blade tips: lively, not neon.
    const g = [hex('#4f9a35'), hex('#5aab3c'), hex('#6bba47')]
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        const k = (Math.sin(x * 1.3 + y * 0.7) + Math.sin(x * 0.6 - y * 1.7) + 2) / 4
        p.put(x, y, p.vary(g[Math.min(2, Math.floor(k * 3 + p.rng() * 0.6))], 0.12))
      }
    }
    p.speck('#3f7f2a', 0.1, 0.08)
    p.speck('#7fcf58', 0.05, 0.08)
  },
  grass_side: (p) => {
    TILES.dirt(p)
    const g = hex('#56a63a')
    for (let x = 0; x < T; x += 1) {
      const depth = 3 + Math.floor(p.rng() * 3)
      for (let y = 0; y < depth; y += 1) p.put(x, y, p.vary(y === depth - 1 ? p.shade(g, 0.78) : g, 0.14))
    }
  },
  stone: (p) => {
    p.noise('#878787', 0.12)
    p.speck('#6c6c6c', 0.16)
    p.speck('#a2a2a2', 0.08)
    // A couple of hairline cracks.
    const c = hex('#5e5e5e')
    for (let k = 0; k < 2; k += 1) {
      let x = Math.floor(p.rng() * T)
      let y = Math.floor(p.rng() * T)
      for (let i = 0; i < 5; i += 1) {
        p.put(x, y, c)
        x += p.rng() < 0.5 ? 1 : 0
        y += 1
      }
    }
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
    p.noise('#8c8c91', 0.08)
    bricks(p, [[0, 0, 8, 8], [8, 0, 8, 8], [0, 8, 4, 8], [4, 8, 8, 8], [12, 8, 4, 8]], hex('#55555a'), hex('#a6a6ac'))
  },
  brick: (p) => {
    p.noise('#a8503c', 0.12)
    const rows = []
    for (let r = 0; r < 4; r += 1) {
      const off = r % 2 ? 4 : 0
      for (let x = -off; x < T; x += 8) rows.push([x, r * 4, 8, 4])
    }
    bricks(p, rows, hex('#d6cbbd'), hex('#c46a54'))
  },
  planks: (p) => {
    // Four boards with grain, their ends staggered, edges lit and shaded.
    const wood = [hex('#b5844a'), hex('#a9793f'), hex('#bd8c52'), hex('#ae7e45')]
    for (let r = 0; r < 4; r += 1) {
      for (let y = r * 4; y < r * 4 + 4; y += 1) {
        for (let x = 0; x < T; x += 1) {
          const grain = Math.sin(x * 0.9 + r * 3 + Math.sin(y * 2.1) * 0.8) > 0.6 ? 0.88 : 1
          p.put(x, y, p.vary(p.shade(wood[r], grain), 0.05))
        }
      }
      for (let x = 0; x < T; x += 1) {
        p.put(x, r * 4, p.shade(wood[r], 1.12))
        p.put(x, r * 4 + 3, hex('#6e4a27'))
      }
      p.put((r * 5 + 3) % T, r * 4 + 1, hex('#6e4a27'))
      p.put((r * 5 + 3) % T, r * 4 + 2, hex('#6e4a27'))
    }
  },
  log_side: (p) => {
    p.noise('#634325', 0.1)
    const dark = hex('#47301a')
    const light = hex('#7d5a35')
    for (let x = 0; x < T; x += 1) {
      const kind = (x * 7 + 3) % 5
      for (let y = 0; y < T; y += 1) {
        if (kind === 0) p.put(x, y, p.vary(dark, 0.1))
        else if (kind === 2 && (y + x) % 6 < 4) p.put(x, y, p.vary(light, 0.08))
      }
    }
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
    // Leaf clusters: dark under, bright tops, a few gaps of sky.
    const dark = hex('#2f7524')
    const mid = hex('#3f8f2e')
    const lite = hex('#5aad3e')
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        const r = p.rng()
        if (r < 0.1) p.put(x, y, [0, 0, 0], 0)
        else {
          const cl = (x % 4) + (y % 4)
          p.put(x, y, p.vary(cl < 2 ? lite : cl < 5 ? mid : dark, 0.12))
        }
      }
    }
  },
  sand: (p) => {
    p.noise('#e3cf8e', 0.08)
    p.speck('#c9b16e', 0.12)
    p.speck('#f2e2a8', 0.06)
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
    p.noise('#2d7fd6', 0.05)
    const l = hex('#6fb8f5')
    const d = hex('#2368b8')
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        const w = Math.sin(x * 0.8 + Math.sin(y * 0.9) * 1.5)
        if (w > 0.85) p.put(x, y, l)
        else if (w < -0.9) p.put(x, y, d)
      }
    }
  },
  quartz: (p) => {
    p.noise('#ece6dd', 0.03)
    bevel(p, 0, 0, T, T, hex('#ffffff'), hex('#c9bfb1'))
  },
  quartz_top: (p) => {
    p.noise('#f2ede6', 0.025)
    bevel(p, 0, 0, T, T, hex('#ffffff'), hex('#cfc5b8'))
    bevel(p, 4, 4, 8, 8, hex('#d8cfc2'), hex('#ffffff'))
  },
  obsidian: (p) => {
    p.noise('#1a1026', 0.25)
    p.speck('#3b2160', 0.14)
    p.speck('#5c3a8f', 0.04)
  },
  crystal: (p) => {
    p.clear()
    // A faceted pink-violet gem in a dark cage: the frame stays solid, the gaps see-through.
    const cage = hex('#2a1b3d')
    for (let i = 0; i < T; i += 1) {
      for (const k of [0, 15]) {
        p.put(i, k, cage)
        p.put(k, i, cage)
      }
    }
    for (let y = 2; y < 14; y += 1) {
      for (let x = 2; x < 14; x += 1) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5)
        if (d > 6) continue
        const c = d < 2 ? '#ffe6ff' : d < 3.5 ? '#ff8ef0' : (x + y) % 2 ? '#c13ee6' : '#9a2cc4'
        p.put(x, y, hex(c))
      }
    }
  },
  corestone: (p) => {
    p.noise('#3b3d45', 0.3)
    p.speck('#1d1e24', 0.2)
    p.speck('#6a6d78', 0.06)
  },
  clay_orange: (p) => {
    p.noise('#d9782f', 0.07)
    p.speck('#c4682a', 0.08)
  },
  clay_red: (p) => {
    p.noise('#b8402e', 0.07)
    p.speck('#9e3424', 0.08)
  },
  mossy_bricks: (p) => {
    TILES.stone_bricks(p)
    const moss = [hex('#4f8f3a'), hex('#5fa245'), hex('#3f7a2e')]
    for (let y = 0; y < T; y += 1) {
      for (let x = 0; x < T; x += 1) {
        // Moss grows down from the top and gathers in the mortar.
        const chance = 0.45 - y * 0.03 + ((x * 5 + y * 3) % 7 === 0 ? 0.3 : 0)
        if (p.rng() < chance) p.put(x, y, p.vary(moss[(x + y) % 3], 0.15))
      }
    }
  },
  slate: (p) => {
    p.noise('#3d5788', 0.1)
    // Layered rock: thin bands, each a slightly different blue.
    for (let y = 0; y < T; y += 1) {
      const band = Math.floor((y + Math.sin(y * 0.5) * 2) / 3) % 3
      const c = hex(['#3a5384', '#45629a', '#324a78'][band])
      for (let x = 0; x < T; x += 1) if (p.rng() < 0.7) p.put(x, y, p.vary(c, 0.08))
    }
    p.speck('#6a88c0', 0.05)
  },
  pad_top: (p) => {
    // A springy green pad with an arrow: step here.
    p.noise('#3fcf5a', 0.08)
    const rim = hex('#1f7a33')
    for (let i = 0; i < T; i += 1) {
      for (const k of [0, 15]) {
        p.put(i, k, rim)
        p.put(k, i, rim)
      }
    }
    const arrow = ['...##...', '..####..', '.######.', '########', '..####..', '..####..', '..####..', '..####..']
    arrow.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && p.put(x + 4, y + 4, hex('#eaffd9'))))
  },
  pad_side: (p) => {
    p.noise('#5c5f68', 0.1)
    for (let x = 0; x < T; x += 1) {
      for (let y = 0; y < 4; y += 1) p.put(x, y, p.vary(hex('#3fcf5a'), 0.08))
      p.put(x, 4, hex('#1f7a33'))
    }
    for (let y = 6; y < T; y += 3) for (let x = 0; x < T; x += 1) if ((x + y) % 4 === 0) p.put(x, y, hex('#ffd23b'))
  },
  azure: (p) => {
    p.noise('#38b6d8', 0.06)
    bevel(p, 0, 0, T, T, hex('#9fe8f7'), hex('#1f7c99'))
    for (let i = 3; i < 13; i += 1) p.put(i, 16 - i, hex('#c9f6ff'))
  },
  finish_top: (p) => {
    for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) p.put(x, y, (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? hex('#1b1430') : hex('#ffd23b'))
  },
  hay_top: (p) => {
    p.noise('#d8b44a', 0.12)
    p.speck('#b8932f', 0.2)
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, hex('#8a6a1f'))
      p.put(0, i, hex('#8a6a1f'))
    }
  },
  hay_side: (p) => {
    p.noise('#d4ad42', 0.1)
    for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) if ((x + y * 2) % 5 === 0) p.put(x, y, hex('#b8932f'))
    for (const y of [3, 12]) for (let x = 0; x < T; x += 1) p.put(x, y, hex('#7a4a1f'))
  },
  mushroom: (p) => {
    p.noise('#c8352e', 0.08)
    for (const [cx, cy, r] of [[4, 4, 2], [11, 6, 1.6], [6, 11, 1.8], [12, 12, 1.2]]) {
      for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) if (Math.hypot(x - cx, y - cy) < r) p.put(x, y, hex('#f4ece2'))
    }
  },
  lantern: (p) => {
    p.noise('#ffc85a', 0.1)
    const frame = hex('#3a2a1a')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, frame)
      p.put(i, 15, frame)
      p.put(0, i, frame)
      p.put(15, i, frame)
      p.put(i, 1, frame)
      p.put(i, 14, frame)
    }
    for (let y = 4; y < 12; y += 1) for (let x = 6; x < 10; x += 1) p.put(x, y, hex('#fff3c2'))
  },
  lantern_top: (p) => {
    p.noise('#3a2a1a', 0.1)
    for (let y = 5; y < 11; y += 1) for (let x = 5; x < 11; x += 1) p.put(x, y, hex('#ffd774'))
  },
  torch: (p) => {
    // A stick with a flame on top.
    p.clear()
    for (let y = 6; y < T; y += 1) {
      p.put(7, y, hex(y % 3 ? '#8a5a2b' : '#6b4420'))
      p.put(8, y, hex('#a8703a'))
    }
    for (const [x, y, c] of [[7, 5, '#ffd23b'], [8, 5, '#ffd23b'], [7, 4, '#ffb347'], [8, 4, '#fff3b0'], [7, 3, '#ff8a1a'], [8, 3, '#ffd23b'], [8, 2, '#ff8a1a'], [7, 2, '#d8431a'], [6, 4, '#ff8a1a'], [9, 4, '#ff8a1a']]) p.put(x, y, hex(c))
  },
  campfire: (p) => {
    // Crossed logs, flames licking up from them.
    p.clear()
    for (let x = 1; x < 15; x += 1) {
      p.put(x, 14, hex(x % 4 ? '#6b4420' : '#4a2f16'))
      p.put(x, 15, hex('#4a2f16'))
      p.put(x, 12, hex(x % 3 ? '#8a5a2b' : '#6b4420'))
    }
    for (let k = 0; k < 5; k += 1) {
      const x0 = 3 + k * 2.2
      const h = 5 + Math.floor(p.rng() * 6)
      for (let y = 0; y < h; y += 1) {
        const t = y / h
        const c = t < 0.3 ? '#fff3b0' : t < 0.6 ? '#ffd23b' : t < 0.85 ? '#ff8a1a' : '#d8431a'
        p.put(Math.round(x0) + Math.round(Math.sin(t * 3 + k) * t), 11 - y, p.vary(hex(c), 0.1))
      }
    }
  },
  berry_bush: (p) => {
    // A leafy bush dotted with glowing blue-green berries.
    p.clear()
    for (let y = 3; y < T; y += 1) {
      for (let x = 1; x < 15; x += 1) {
        const d = Math.hypot(x - 7.5, (y - 10) * 1.2)
        if (d < 7 && p.rng() < 0.9 - d * 0.05) p.put(x, y, p.vary(hex(y > 12 ? '#2f7a2a' : '#3f9a35'), 0.2))
      }
    }
    for (const [x, y] of [[4, 6], [10, 5], [7, 8], [12, 9], [3, 10], [9, 11], [6, 13], [11, 13]]) {
      p.put(x, y, hex('#7dffd9'))
      p.put(x + 1, y, hex('#36c9a0'))
      p.put(x, y + 1, hex('#36c9a0'))
    }
  },
  chest_top: (p) => {
    // Oak boards in a dark frame.
    p.noise('#b07a3c', 0.12)
    const frame = hex('#4a2f16')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, frame)
      p.put(i, 15, frame)
      p.put(0, i, frame)
      p.put(15, i, frame)
    }
    for (let x = 1; x < 15; x += 1) for (const y of [5, 10]) p.put(x, y, hex('#8a5a2b'))
  },
  chest_side: (p) => {
    // Boards, a dark frame, the lid's seam and a gold latch.
    p.noise('#a8703a', 0.12)
    const frame = hex('#4a2f16')
    for (let i = 0; i < T; i += 1) {
      p.put(i, 0, frame)
      p.put(i, 15, frame)
      p.put(0, i, frame)
      p.put(15, i, frame)
      p.put(i, 5, frame)
    }
    for (let x = 1; x < 15; x += 1) p.put(x, 11, hex('#8a5a2b'))
    for (let y = 4; y <= 8; y += 1) for (let x = 7; x <= 8; x += 1) p.put(x, y, hex(y === 4 || y === 8 ? '#a8700f' : '#ffd23b'))
  },
  fire: (p) => {
    // Tongues of flame, white-hot at the base, licking up to dark orange tips.
    p.clear()
    for (let k = 0; k < 6; k += 1) {
      const x0 = 1 + k * 2.6
      const h = 7 + Math.floor(p.rng() * 8)
      for (let y = 0; y < h; y += 1) {
        const t = y / h
        const w = Math.max(1, Math.round((1 - t) * 2.2))
        const lean = Math.round(Math.sin(t * 3 + k) * 1.2 * t)
        const c = t < 0.25 ? '#fff3b0' : t < 0.5 ? '#ffd23b' : t < 0.78 ? '#ff8a1a' : '#d8431a'
        for (let dx = 0; dx < w; dx += 1) p.put(Math.round(x0) + dx + lean, 15 - y, p.vary(hex(c), 0.12))
      }
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

/** Light on the top and left edge of a rectangle, shade on the bottom and right: depth. */
function bevel(p, x0, y0, w, h, light, dark) {
  for (let x = x0; x < x0 + w; x += 1) {
    p.put(x, y0, light)
    p.put(x, y0 + h - 1, dark)
  }
  for (let y = y0; y < y0 + h; y += 1) {
    p.put(x0, y, light)
    p.put(x0 + w - 1, y, dark)
  }
}

/** Bricks `[x, y, w, h]` with mortar on their bottom and right, light on their top and left. */
function bricks(p, list, mortar, light) {
  for (const [bx, by, bw, bh] of list) {
    for (let y = by; y < by + bh; y += 1) {
      for (let x = bx; x < bx + bw; x += 1) {
        if (x < 0 || x >= T) continue
        const edgeR = x === bx + bw - 1 || x === T - 1
        const edgeB = y === by + bh - 1
        if (edgeR || edgeB) p.put(x, y, mortar)
        else if (x === bx || y === by) p.put(x, y, p.vary(light, 0.05))
      }
    }
  }
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
  // Crisp pixels up close; far away, the mipmaps blend them (no sparkling grass). The
  // terrain shader keeps to the first three levels, which never mix two tiles (a 20 px
  // cell is 10 px, then 5 px, at those levels).
  atlasTexture.magFilter = NearestFilter
  atlasTexture.minFilter = LinearMipmapLinearFilter
  atlasTexture.generateMipmaps = true
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
