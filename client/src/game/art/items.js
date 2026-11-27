import { BufferAttribute, BufferGeometry, MeshBasicMaterial } from 'three'

import { ITEMS, SWORD_SKINS } from '@shared/balance'
import { B, BLOCKS } from '@shared/voxel'

import { getAtlas, getAtlasCanvas, tileRect, tileUV } from './atlas'

/**
 * Items as 16x16 pixel art, painted in code. Each sprite becomes:
 * - a hotbar icon (a data URL, drawn crisp with `image-rendering: pixelated`), and
 * - a 3D model: every pixel pushed out one pixel thick, like held items in classic
 *   block games. Built once per item (and sword skin) and shared.
 * Block items are little textured cubes instead.
 */

const S = 16

const TIERS = {
  iron: ['#d9dde2', '#ffffff', '#6d4a2a', '#4f3319'],
  diamond: ['#45dbe6', '#bdfaff', '#2b8c94', '#4f3319'],
  cinder: ['#6b4fa8', '#b89cff', '#2a1d45', '#3a2a1a'],
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const darker = (c, k = 0.7) => c.map((v) => Math.round(v * k))

/** A 16x16 RGBA pixel grid: `null` for empty. */
function grid() {
  return Array.from({ length: S * S }, () => null)
}

function painters(px) {
  const put = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < S && y < S) px[y * S + x] = typeof c === 'string' ? hex(c) : c
  }
  const disc = (cx, cy, r, color, shadeFn) => {
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d <= r) put(x, y, shadeFn ? shadeFn(x, y, d) : color)
      }
    }
  }
  return { put, disc }
}

const SPRITES = {
  sword: (px, opts) => {
    const { put } = painters(px)
    const [blade, edge, guard, handle] = (opts.colors || TIERS[opts.tier] || TIERS.wood).map(hex)
    const side = darker(blade, 0.72)
    for (let i = 1; i <= 9; i += 1) {
      put(5 + i, 10 - i, blade)
      if (i < 9) {
        put(5 + i, 11 - i, side)
        put(4 + i, 10 - i, edge)
      }
    }
    for (let k = -2; k <= 2; k += 1) put(5 + k, 10 + k, guard)
    put(4, 9, darker(guard, 0.85))
    for (let k = 1; k <= 3; k += 1) put(5 - k, 10 + k, handle)
    put(1, 14, guard)
  },
  axe: (px, opts) => {
    const { put } = painters(px)
    const [blade, edge] = (TIERS[opts.tier] || TIERS.diamond).map(hex)
    for (let k = 0; k < 11; k += 1) put(2 + k, 13 - k, k % 2 ? '#7a5530' : '#5c3d20')
    // The head: a broad blade off one side of the haft, near the top.
    const rows = [[9, 1, 3], [8, 2, 5], [8, 3, 6], [8, 4, 6], [9, 5, 5], [10, 6, 3]]
    for (const [x0, y, w] of rows) for (let x = x0; x < x0 + w; x += 1) put(x, y, x === x0 + w - 1 ? edge : blade)
    put(9, 2, darker(blade, 0.75))
    put(9, 3, darker(blade, 0.75))
  },
  mace: (px) => {
    const { put, disc } = painters(px)
    for (let k = 0; k < 8; k += 1) put(2 + k, 13 - k, k % 2 ? '#8a6a3a' : '#5c4320')
    disc(11, 4.5, 3.6, null, (x, y) => (x + y < 14 ? hex('#e6e9ef') : x + y < 17 ? hex('#a9b0bd') : hex('#6b7280')))
    for (const [x, y] of [[11, 0], [15, 4], [7, 5], [11, 9], [14, 1], [8, 1], [14, 8]]) put(x, y, '#cfd6e0')
    put(10, 3, '#ffffff')
  },
  spear: (px) => {
    const { put } = painters(px)
    for (let k = 0; k < 12; k += 1) put(1 + k, 14 - k, k % 3 === 0 ? '#5c4320' : '#8a6a3a')
    // A long iron tip and a cloth binding.
    for (const [x, y, c] of [[12, 3, '#cfd6e0'], [13, 2, '#e6e9ef'], [14, 1, '#ffffff'], [15, 0, '#ffffff'], [13, 3, '#a9b0bd'], [12, 2, '#a9b0bd'], [14, 2, '#cfd6e0'], [13, 1, '#cfd6e0']]) put(x, y, c)
    put(10, 5, '#d8443a')
    put(11, 4, '#d8443a')
  },
  shield: (px) => {
    const { put } = painters(px)
    for (let y = 1; y <= 14; y += 1) {
      const inset = y > 10 ? y - 10 : 0
      for (let x = 2 + inset; x <= 13 - inset; x += 1) {
        const rim = x === 2 + inset || x === 13 - inset || y === 1 || y === 14 - (y > 10 ? 0 : 0)
        put(x, y, rim ? '#9aa3b2' : (x + y) % 5 === 0 ? '#8a5a2b' : '#a8703a')
      }
    }
    // The STRAFEX diamond on the face.
    for (const [x, y] of [[7, 4], [8, 4], [6, 5], [9, 5], [6, 6], [9, 6], [7, 7], [8, 7], [7, 5], [8, 5], [7, 6], [8, 6]]) put(x, y, y < 6 ? '#ffd23b' : '#e0a21b')
    put(7, 8, '#3fa2ff')
    put(8, 8, '#3fa2ff')
  },
  gust: (px) => {
    const { disc, put } = painters(px)
    disc(8, 8, 5.2, null, (x, y, d) => (d < 2 ? hex('#ffffff') : d < 3.6 ? hex('#cfeeff') : hex('#8fd0ff')))
    // A swirl through it.
    for (const [x, y] of [[5, 6], [6, 5], [7, 5], [8, 6], [9, 7], [9, 8], [8, 9], [7, 9], [10, 10], [11, 9]]) put(x, y, '#5fa8d8')
  },
  splash: (px, opts) => {
    const { disc, put } = painters(px)
    const liquid = hex(opts.color || '#ff4f6d')
    disc(8, 10, 4.8, null, (x, y) => (y < 7 ? hex('#dff4ff') : x + y < 17 ? liquid : darker(liquid, 0.75)))
    for (let y = 2; y <= 5; y += 1) {
      put(7, y, '#dff4ff')
      put(8, y, '#c5e6f7')
    }
    put(6, 3, '#c5e6f7')
    put(9, 3, '#c5e6f7')
    put(7, 1, '#8a5a2b')
    put(8, 1, '#8a5a2b')
    put(6, 8, '#ffffff')
    put(11, 12, '#ffffff')
  },
  crystal: (px) => {
    const { put } = painters(px)
    for (let y = 1; y < 15; y += 1) {
      for (let x = 1; x < 15; x += 1) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5)
        if (d > 7) continue
        const c = d > 6 ? '#2a1b3d' : d < 2 ? '#ffe6ff' : d < 3.5 ? '#ff8ef0' : (x + y) % 2 ? '#c13ee6' : '#9a2cc4'
        put(x, y, c)
      }
    }
  },
  charm: (px) => {
    const { disc, put } = painters(px)
    // A gold medallion with a green gem, on a red ribbon.
    for (const [x, y] of [[6, 0], [7, 1], [9, 1], [10, 0], [8, 2]]) put(x, y, '#d8443a')
    disc(8, 9, 5.2, null, (x, y, d) => (d > 4.3 ? hex('#a8700f') : x + y < 15 ? hex('#ffe27a') : hex('#e0a21b')))
    disc(8, 9, 2.2, null, (x, y) => (x + y < 16 ? hex('#7cff9e') : hex('#1fae55')))
    put(7, 8, '#e8fff0')
  },
  bow: (px, opts) => {
    const { put } = painters(px)
    // A fire bow: a glowing string and an ember at each tip.
    for (let i = 0; i <= 11; i += 1) put(2 + i, 13 - i, opts.color ? (i % 3 ? '#ffb347' : '#ff6a1a') : '#e8e8e8')
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const bx = 2 + 11 * t
      const by = 13 - 11 * t
      const off = Math.sin(Math.PI * t) * 4.2
      put(Math.round(bx - off * 0.707), Math.round(by - off * 0.707), t > 0.4 && t < 0.6 ? '#4f3319' : '#8a5a2b')
    }
    put(1, 14, opts.color ? '#ff6a1a' : '#a0a0a0')
    put(14, 1, opts.color ? '#ffd23b' : '#a0a0a0')
  },
  bucket: (px, opts) => {
    const { put } = painters(px)
    // A stone-grey pail with a handle; water in it if it's full.
    for (let y = 5; y <= 14; y += 1) {
      const inset = Math.floor((y - 5) / 4)
      for (let x = 3 + inset; x <= 12 - inset; x += 1) {
        const edge = x === 3 + inset || x === 12 - inset || y === 14
        put(x, y, edge ? '#5d6470' : x < 7 ? '#c9ced8' : x < 10 ? '#a9b0bd' : '#878e9b')
      }
    }
    for (let x = 3; x <= 12; x += 1) put(x, 5, '#5d6470')
    for (const [x, y] of [[3, 4], [4, 2], [5, 1], [6, 1], [9, 1], [10, 1], [11, 2], [12, 4], [7, 1], [8, 1]]) put(x, y, '#5d6470')
    if (opts.color) {
      for (let x = 4; x <= 11; x += 1) put(x, 6, x % 3 ? '#3f8cff' : '#8fc4ff')
      for (let x = 4; x <= 11; x += 1) put(x, 7, '#2f6fd8')
    }
  },
  ingot: (px) => {
    const { put } = painters(px)
    // A bar of iron, lit along its top.
    for (let y = 6; y <= 11; y += 1) {
      for (let x = 2 + (11 - y); x <= 13 - (y - 6); x += 1) put(x, y, y === 6 ? '#ffffff' : y < 9 ? '#d9dde5' : '#a9b0bd')
    }
    for (let x = 4; x <= 12; x += 1) put(x, 12, '#6b7280')
  },
  gem: (px) => {
    const { put } = painters(px)
    // A cut diamond.
    for (let y = 3; y < 14; y += 1) {
      const half = y < 7 ? (y - 3) * 1.6 + 2 : (13 - y) * 0.9 + 1
      for (let x = Math.round(8 - half); x <= Math.round(7 + half); x += 1) put(x, y, y < 6 ? '#e8ffff' : (x + y) % 3 ? '#5fe8e0' : '#2fb8b0')
    }
    put(6, 5, '#ffffff')
  },
  pickaxe: (px, opts) => {
    const { put } = painters(px)
    const [head] = (TIERS[opts.tier] || TIERS.iron).map(hex)
    for (let k = 0; k < 11; k += 1) put(2 + k, 13 - k, k % 2 ? '#8a5a2b' : '#6b4420')
    // The head: a curved bar across the top of the haft.
    for (const [x, y] of [[4, 3], [5, 2], [6, 2], [7, 2], [8, 2], [9, 3], [10, 4], [11, 5], [12, 6], [13, 7], [3, 4], [12, 8]]) put(x, y, head)
    put(6, 3, darker(head, 0.75))
    put(11, 6, darker(head, 0.75))
  },
  torch: (px) => {
    const { put } = painters(px)
    for (let k = 0; k < 9; k += 1) put(4 + k, 14 - k, k % 2 ? '#8a5a2b' : '#6b4420')
    for (const [x, y, c] of [[12, 5, '#ffd23b'], [13, 4, '#fff3b0'], [12, 4, '#ffb347'], [13, 5, '#ff8a1a'], [14, 3, '#ff8a1a'], [12, 3, '#ff8a1a'], [13, 3, '#ffd23b'], [13, 2, '#d8431a'], [11, 4, '#d8431a']]) put(x, y, c)
  },
  campfire: (px) => {
    const { put } = painters(px)
    for (let x = 1; x < 15; x += 1) {
      put(x, 13, x % 4 ? '#6b4420' : '#4a2f16')
      put(x, 12, x % 3 ? '#8a5a2b' : '#6b4420')
    }
    for (const [x, y] of [[1, 14], [3, 14], [12, 14], [14, 14]]) put(x, y, '#9aa3b2')
    for (let k = 0; k < 4; k += 1) {
      const x = 4 + k * 2
      for (let y = 0; y < 6 + (k % 2) * 2; y += 1) put(x + (y > 4 ? (k % 2 ? 1 : -1) : 0), 11 - y, y < 2 ? '#fff3b0' : y < 4 ? '#ffd23b' : y < 6 ? '#ff8a1a' : '#d8431a')
    }
  },
  berry: (px) => {
    const { disc, put } = painters(px)
    // Three glowing berries on a sprig.
    for (const [cx, cy] of [[5.5, 9.5], [10.5, 9], [8, 12.5]]) disc(cx, cy, 2.6, null, (x, y, d) => (d < 1 ? hex('#e8fff6') : x + y < cx + cy ? hex('#7dffd9') : hex('#1f9c85')))
    for (const [x, y] of [[8, 3], [8, 4], [7, 5], [9, 5], [6, 6], [10, 6]]) put(x, y, '#3f9a35')
    put(9, 2, '#5cd65c')
    put(10, 2, '#5cd65c')
  },
  pearl: (px) => {
    const { disc, put } = painters(px)
    disc(8, 8, 4.6, null, (x, y, d) => (d < 2 ? hex('#7dffd9') : d < 3.4 ? hex('#1f9c85') : hex('#0d5c4f')))
    put(6, 6, '#e8fff9')
  },
  gapple: (px) => {
    const { disc, put } = painters(px)
    disc(8, 9.5, 5, null, (x, y) => (x + y < 14 ? hex('#fff1a0') : x + y < 19 ? hex('#ffd23b') : hex('#d49a12')))
    put(8, 3, '#6d4a2a')
    put(8, 4, '#6d4a2a')
    put(9, 3, '#5cd65c')
    put(10, 2, '#5cd65c')
  },
  potion: (px, opts) => {
    const { disc, put } = painters(px)
    const liquid = hex(opts.color || '#ff5050')
    disc(8, 10.5, 4.6, null, (x, y) => (y < 8 ? hex('#dff4ff') : x + y < 17 ? liquid : darker(liquid, 0.75)))
    for (let y = 3; y <= 6; y += 1) {
      put(7, y, '#dff4ff')
      put(8, y, '#c5e6f7')
    }
    put(7, 2, '#8a5a2b')
    put(8, 2, '#8a5a2b')
    put(6, 9, '#ffffff')
  },
  fist: () => {},
}

/** Sprite pixels for an item id (with a sword skin), cached. */
const spriteCache = new Map()
function spriteFor(id, skin = 'classic') {
  const item = ITEMS[id]
  const key = item?.kind === 'sword' ? `${id}:${skin}` : id
  if (spriteCache.has(key)) return spriteCache.get(key)
  const px = grid()
  const draw = SPRITES[item?.icon] || SPRITES.fist
  draw(px, { tier: item?.tier, colors: item?.kind === 'sword' && skin !== 'classic' ? SWORD_SKINS[skin]?.colors : null, color: item?.color })
  spriteCache.set(key, px)
  return px
}

export const isBlockItem = (id) => ITEMS[id]?.kind === 'block' && !ITEMS[id].sprite
export const blockOfItem = (id) => (ITEMS[id]?.kind === 'crystal' ? B.CRYSTAL : ITEMS[id]?.block)

// --- Icons ------------------------------------------------------------------------------

const iconCache = new Map()

/** A 32x32 data URL for the hotbar/backpack. */
export function itemIcon(id, skin = 'classic') {
  const key = `${id}:${skin}`
  if (iconCache.has(key)) return iconCache.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  if (isBlockItem(id)) drawIsoBlock(ctx, blockOfItem(id))
  else {
    const px = spriteFor(id, skin)
    px.forEach((c, i) => {
      if (!c) return
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`
      ctx.fillRect((i % S) * 2, Math.floor(i / S) * 2, 2, 2)
    })
  }
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

/** A little isometric cube from a block's atlas tiles. */
function drawIsoBlock(ctx, blockId) {
  const def = BLOCKS[blockId]
  const atlas = getAtlasCanvas()
  const [tx, ty] = tileRect(def.tex[0])
  const [sx, sy] = tileRect(def.tex[1])
  // Top face.
  ctx.save()
  ctx.setTransform(1, 0.5, -1, 0.5, 16, 2)
  ctx.drawImage(atlas, tx, ty, 16, 16, 0, 0, 14, 14)
  ctx.restore()
  // Left face.
  ctx.save()
  ctx.setTransform(1, 0.5, 0, 1, 2, 9)
  ctx.drawImage(atlas, sx, sy, 16, 16, 0, 0, 14, 15)
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(0, 0, 14, 15)
  ctx.restore()
  // Right face.
  ctx.save()
  ctx.setTransform(1, -0.5, 0, 1, 16, 16)
  ctx.drawImage(atlas, sx, sy, 16, 16, 0, 0, 14, 15)
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(0, 0, 14, 15)
  ctx.restore()
}

/** A cape or other cosmetic preview: drawn by its own module; re-exported for one import. */
export { SPRITES }

// --- 3D models ----------------------------------------------------------------------------

export const itemMaterial = new MeshBasicMaterial({ vertexColors: true })
export const blockItemMaterial = new MeshBasicMaterial({ vertexColors: true })
let blockMatReady = false

const modelCache = new Map()

/** Extruded sprite: 1 unit tall, centred on the origin, 1/16 thick. */
function extrude(px) {
  const pos = []
  const col = []
  const p = 1 / S
  const d = p / 2
  const face = (verts, c, shade) => {
    // Two triangles from a quad a-b-c-d.
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...verts[i])
      col.push((c[0] / 255) * shade, (c[1] / 255) * shade, (c[2] / 255) * shade)
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : px[y * S + x])
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const c = at(x, y)
      if (!c) continue
      const x0 = x * p - 0.5
      const x1 = x0 + p
      const y1 = 0.5 - y * p
      const y0 = y1 - p
      face([[x0, y0, d], [x1, y0, d], [x1, y1, d], [x0, y1, d]], c, 1)
      face([[x1, y0, -d], [x0, y0, -d], [x0, y1, -d], [x1, y1, -d]], c, 0.7)
      if (!at(x - 1, y)) face([[x0, y0, -d], [x0, y0, d], [x0, y1, d], [x0, y1, -d]], c, 0.8)
      if (!at(x + 1, y)) face([[x1, y0, d], [x1, y0, -d], [x1, y1, -d], [x1, y1, d]], c, 0.8)
      if (!at(x, y - 1)) face([[x0, y1, d], [x1, y1, d], [x1, y1, -d], [x0, y1, -d]], c, 0.95)
      if (!at(x, y + 1)) face([[x0, y0, -d], [x1, y0, -d], [x1, y0, d], [x0, y0, d]], c, 0.6)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.computeBoundingSphere()
  return geo
}

/** A unit cube with a block's atlas tiles and baked shading. */
function blockCube(blockId) {
  const def = BLOCKS[blockId]
  const pos = []
  const uv = []
  const col = []
  const faces = [
    { c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]], t: 1, s: 0.8 },
    { c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]], t: 1, s: 0.7 },
    { c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]], t: 0, s: 1 },
    { c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], t: 2, s: 0.5 },
    { c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], t: 1, s: 0.9 },
    { c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]], t: 1, s: 0.65 },
  ]
  for (const f of faces) {
    const [u0, v0, u1, v1] = tileUV(def.tex[f.t])
    const quv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...f.c[i])
      uv.push(...quv[i])
      col.push(f.s, f.s, f.s)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.computeBoundingSphere()
  return geo
}

/**
 * `{ geometry, material, block }` for holding item `id` (null for an empty hand).
 * Shared and cached: never dispose these.
 */
export function itemModel(id, skin = 'classic') {
  if (!id || id === 'fist' || !ITEMS[id]) return null
  const key = ITEMS[id].kind === 'sword' ? `${id}:${skin}` : id
  if (modelCache.has(key)) return modelCache.get(key)
  let model
  if (isBlockItem(id)) {
    if (!blockMatReady) {
      blockItemMaterial.map = getAtlas()
      blockMatReady = true
    }
    model = { geometry: blockCube(blockOfItem(id)), material: blockItemMaterial, block: true }
  } else {
    model = { geometry: extrude(spriteFor(id, skin)), material: itemMaterial, block: false }
  }
  modelCache.set(key, model)
  return model
}

/** Every model a round can need, so nothing is built mid-fight (called while loading). */
export function warmItemModels() {
  for (const id of Object.keys(ITEMS)) {
    itemModel(id)
    itemIcon(id)
  }
}
