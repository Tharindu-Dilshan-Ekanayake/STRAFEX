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
  wood: ['#a77a47', '#cfa06a', '#6d4a2a', '#4f3319'],
  stone: ['#8f8f8f', '#bdbdbd', '#6d4a2a', '#4f3319'],
  iron: ['#d9dde2', '#ffffff', '#6d4a2a', '#4f3319'],
  diamond: ['#45dbe6', '#bdfaff', '#2b8c94', '#4f3319'],
  blaze: ['#ff7a1a', '#ffe14d', '#b3200e', '#3a1405'],
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
  pickaxe: (px) => {
    const { put } = painters(px)
    for (let k = 0; k < 10; k += 1) put(2 + k, 13 - k, k % 2 ? '#7a5530' : '#5c3d20')
    const head = hex('#ffcb1f')
    for (let k = -5; k <= 3; k += 1) {
      put(10 + k, 3 + k, head)
      put(11 + k, 3 + k, darker(head, 0.8))
    }
    put(5, 0, '#fff6c8')
    put(14, 7, '#fff6c8')
  },
  bow: (px) => {
    const { put } = painters(px)
    for (let i = 0; i <= 11; i += 1) put(2 + i, 13 - i, '#e8e8e8')
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const bx = 2 + 11 * t
      const by = 13 - 11 * t
      const off = Math.sin(Math.PI * t) * 4.2
      put(Math.round(bx - off * 0.707), Math.round(by - off * 0.707), t > 0.4 && t < 0.6 ? '#4f3319' : '#8a5a2b')
    }
    put(1, 14, '#a0a0a0')
    put(14, 1, '#a0a0a0')
  },
  snowball: (px) => {
    const { disc } = painters(px)
    disc(8, 8, 5, null, (x, y) => (x + y < 13 ? hex('#ffffff') : x + y < 17 ? hex('#e6f2ff') : hex('#bcd6f2')))
  },
  pearl: (px) => {
    const { disc, put } = painters(px)
    disc(8, 8, 4.6, null, (x, y, d) => (d < 2 ? hex('#7dffd9') : d < 3.4 ? hex('#1f9c85') : hex('#0d5c4f')))
    put(6, 6, '#e8fff9')
  },
  bread: (px) => {
    const { put } = painters(px)
    for (let y = 5; y <= 11; y += 1) {
      for (let x = 2; x <= 13; x += 1) {
        const e = ((x - 7.5) / 6) ** 2 + ((y - 8) / 3.6) ** 2
        if (e <= 1) put(x, y, y < 8 ? (x % 4 === 1 ? '#f2d08a' : '#c98a3f') : '#a8692b')
      }
    }
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
  heart: (px) => {
    const { put } = painters(px)
    const rows = ['..xx...xx..', '.xxxx.xxxx.', 'xxoxxxxxxxx', 'xoxxxxxxxxx', 'xxxxxxxxxxx', '.xxxxxxxxx.', '..xxxxxxx..', '...xxxxx...', '....xxx....', '.....x.....']
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && put(x + 2, y + 3, ch === 'o' ? '#ffd0d8' : y > 5 ? '#b3122c' : '#ff2f55')))
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

export const isBlockItem = (id) => ITEMS[id]?.kind === 'block' || ITEMS[id]?.kind === 'tnt'
export const blockOfItem = (id) => (ITEMS[id]?.kind === 'tnt' ? B.TNT : ITEMS[id]?.block)

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
