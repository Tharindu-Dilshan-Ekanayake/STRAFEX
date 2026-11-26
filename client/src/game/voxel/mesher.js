import { B, BLOCKS, isWater } from '@shared/voxel'

import { tileUV } from '../art/atlasLayout'
import { SUN } from '../sun'

/**
 * Turns a chunk of the voxel grid into triangles.
 *
 * - Only faces that border air (or a see-through block) are kept.
 * - Greedy meshing: neighbouring faces of the same block with the same baked light are
 *   merged into one big quad (a flat field of grass is a handful of quads, not hundreds).
 *   The texture still tiles once per block: each vertex carries its tile's corner in the
 *   atlas (`tile`) and a position in blocks across the quad (`uv`); the terrain shader
 *   wraps it (see Terrain.jsx).
 * - All light is baked into the vertex colours, nothing is lit at runtime: a shade per
 *   direction, per-corner ambient occlusion, sky occlusion under overhangs, and sun
 *   shadows traced through the grid toward the sun (trees, walls and spires cast them).
 * - `tile.z` marks what moves in the shader: 1 leaves, 2 plants (sway in the wind on
 *   MEDIUM and HIGH), 3 water (flows).
 *
 * Output goes into reusable scratch buffers (no garbage per re-mesh); the caller copies
 * what it needs.
 */

/** Face table: normal, corners counter-clockwise seen from outside, tile slot, shade. */
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], t: 1, s: 0.8 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], t: 1, s: 0.8 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], t: 0, s: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], t: 2, s: 0.55 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], t: 1, s: 0.9 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], t: 1, s: 0.68 },
]
// Per face: the axis of its normal, and the axes the texture runs along (corner 0 -> 1
// is the texture's horizontal, corner 0 -> 3 its vertical).
for (const f of FACES) {
  f.d = f.n.findIndex((v) => v !== 0)
  f.sa = [0, 1, 2].find((a) => f.c[0][a] !== f.c[1][a])
  f.ta = [0, 1, 2].find((a) => f.c[0][a] !== f.c[3][a])
  // How much sun the face takes when nothing is in the way (0 = faces away).
  f.sun = Math.max(0, f.n[0] * SUN[0] + f.n[1] * SUN[1] + f.n[2] * SUN[2])
}
const AO = [0.5, 0.67, 0.84, 1]
/** Texture position per corner of a one-block quad (corner 0 at the tile's bottom left). */
const CORNER_S = [0, 1, 1, 0]
const CORNER_T = [0, 0, 1, 1]

/** Per block id: does it hide the faces behind it, its kind, its tiles, and what moves. */
const OPAQUE = new Uint8Array(256)
const KIND = new Uint8Array(256) // 0 none, 1 solid, 2 cutout, 3 cross
/** Casts a sun shadow (solid blocks and leaves; not glass, not flowers). */
const CASTS = new Uint8Array(256)
const MOTION = new Uint8Array(256)
const UVS = []
/** How far each block's light reaches at night (0 = gives none). */
const LIGHT = new Uint8Array(256)
/** The farthest any light reaches: light sources this far outside a chunk still light it. */
const MAX_REACH = 10
// The light sources round the chunk being meshed: x, y, z (cell centres) and reach.
let srcN = 0
let src = new Float32Array(4 * 256)
for (let id = 0; id < BLOCKS.length; id += 1) {
  const def = BLOCKS[id]
  if (!def) continue
  // Water hides nothing behind it: the sea floor and the banks show through.
  OPAQUE[id] = def.render === 'solid' && !isWater(id) ? 1 : 0
  KIND[id] = { none: 0, solid: 1, cutout: 2, cross: 3 }[def.render] ?? 0
  CASTS[id] = (def.render === 'solid' && !isWater(id)) || id === B.LEAVES ? 1 : 0
  MOTION[id] = id === B.LEAVES ? 1 : def.render === 'cross' ? 2 : isWater(id) ? 3 : 0
  UVS[id] = def.tex.map((name) => (name ? tileUV(name) : [0, 0, 0, 0]))
  LIGHT[id] = def.light || 0
}

function makeBuffer(cap) {
  return {
    pos: new Float32Array(cap * 3),
    uv: new Float32Array(cap * 2),
    tile: new Float32Array(cap * 3),
    col: new Uint8Array(cap * 3),
    idx: new Uint32Array(cap * 1.5),
    verts: 0,
    tris: 0,
  }
}
function grow(buf) {
  const next = makeBuffer((buf.pos.length / 3) * 2)
  next.pos.set(buf.pos)
  next.uv.set(buf.uv)
  next.tile.set(buf.tile)
  next.col.set(buf.col)
  next.idx.set(buf.idx)
  next.verts = buf.verts
  next.tris = buf.tris
  return next
}

/** Scratch output: `solid` and `cutout` (leaves, glass, flowers) meshes of the last chunk. */
/**
 * The chunk's meshes. Each vertex's `tile.z` holds its motion (0 none, 1 leaves, 2 plants,
 * 3 water) plus 4 x its block light (0-15: how lit it is by torches, campfires, lanterns
 * and fire nearby) - the terrain shader shows that light at night.
 */
export const out = { solid: makeBuffer(16384), cutout: makeBuffer(4096) }

/** How lit the cell (x, y, z) is by the light sources near the chunk: 0-15. */
function blockLight(x, y, z) {
  if (!srcN) return 0
  let best = 0
  const cx = x + 0.5
  const cy = y + 0.5
  const cz = z + 0.5
  for (let i = 0; i < srcN * 4; i += 4) {
    const r = src[i + 3]
    const dx = cx - src[i]
    const dy = cy - src[i + 1]
    const dz = cz - src[i + 2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r * r) continue
    const k = 1 - Math.sqrt(d2) / r
    if (k > best) best = k
  }
  return Math.round(best * 15)
}

const to8 = (v) => (v > 255 ? 255 : v < 0 ? 0 : Math.round(v))

/**
 * Writes one quad: `pos` 4 corners [x, y, z], `rgb` 12 bytes (4 corners), the tile's
 * atlas corner and motion, and each corner's position across the quad in blocks.
 */
function emit(key, pos, rgb, u0, v0, motion, st) {
  let buf = out[key]
  if ((buf.verts + 4) * 3 > buf.pos.length || (buf.tris + 2) * 3 > buf.idx.length) buf = out[key] = grow(buf)
  const v = buf.verts
  for (let i = 0; i < 4; i += 1) {
    const p = pos[i]
    buf.pos[(v + i) * 3] = p[0]
    buf.pos[(v + i) * 3 + 1] = p[1]
    buf.pos[(v + i) * 3 + 2] = p[2]
    buf.col[(v + i) * 3] = rgb[i * 3]
    buf.col[(v + i) * 3 + 1] = rgb[i * 3 + 1]
    buf.col[(v + i) * 3 + 2] = rgb[i * 3 + 2]
    buf.uv[(v + i) * 2] = st[i * 2]
    buf.uv[(v + i) * 2 + 1] = st[i * 2 + 1]
    buf.tile[(v + i) * 3] = u0
    buf.tile[(v + i) * 3 + 1] = v0
    buf.tile[(v + i) * 3 + 2] = motion
  }
  const t = buf.tris * 3
  // Flip the diagonal where the shading would otherwise crease the wrong way.
  const b0 = rgb[0] + rgb[1] + rgb[2]
  const b1 = rgb[3] + rgb[4] + rgb[5]
  const b2 = rgb[6] + rgb[7] + rgb[8]
  const b3 = rgb[9] + rgb[10] + rgb[11]
  if (b0 + b2 < b1 + b3) {
    buf.idx[t] = v + 1
    buf.idx[t + 1] = v + 2
    buf.idx[t + 2] = v + 3
    buf.idx[t + 3] = v + 1
    buf.idx[t + 4] = v + 3
    buf.idx[t + 5] = v
  } else {
    buf.idx[t] = v
    buf.idx[t + 1] = v + 1
    buf.idx[t + 2] = v + 2
    buf.idx[t + 3] = v
    buf.idx[t + 4] = v + 2
    buf.idx[t + 5] = v + 3
  }
  buf.verts += 4
  buf.tris += 2
}

/**
 * Per-face colour grading: warm sunlight on tops, cool sky light on the sides, a blue
 * bounce underneath; shadows lean blue. A cheap stand-in for real lighting.
 */
const FACE_TINT = [
  [0.96, 0.98, 1.03],
  [0.96, 0.98, 1.03],
  [1.06, 1.02, 0.9],
  [0.82, 0.88, 1.06],
  [0.99, 0.99, 1.0],
  [0.9, 0.95, 1.07],
]
const SHADOW_TINT = [0.88, 0.93, 1.1]

/** Height of the topmost block in each column of the chunk being meshed. */
let colTop = new Int16Array(32 * 32)
// Scratch for one slice of faces: merge key (0 none, -1 can't merge), and colours.
let maskKey = new Float64Array(64 * 64)
let maskRgb = new Uint8Array(64 * 64 * 12)
/** Each face's block light (0-15), and how the merge key keeps different light apart. */
let maskLight = new Uint8Array((64 * 64 * 12) / 12)
const LIGHT_KEY = 2 ** 40
let maskId = new Uint8Array(64 * 64)
const pos4 = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
const rgb12 = new Uint8Array(12)
const st8 = new Float32Array(8)
const ONE_ST = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
const CROSS_A = [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]]
const CROSS_B = [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15]]
const SUN_STEP = 0.5
const SUN_STEPS = 44

/**
 * Meshes the blocks with x0 <= x < x0+size and z0 <= z < z0+size (all heights) into
 * `out`. Returns `out`.
 */
export function meshChunk(world, x0, z0, size) {
  out.solid.verts = out.solid.tris = 0
  out.cutout.verts = out.cutout.tris = 0
  const { sx, sy, sz, data } = world
  const layer = sx * sz
  // Past the box: air - or, in a sealed world, solid below and at the sides (unseen faces).
  const outside = world.sealed ? B.CORESTONE : 0
  const get = (x, y, z) => (y >= sy ? 0 : x < 0 || y < 0 || z < 0 || x >= sx || z >= sz ? outside : data[x + z * sx + y * layer])
  const x1 = Math.min(sx, x0 + size)
  const z1 = Math.min(sz, z0 + size)
  if (colTop.length < size * size) colTop = new Int16Array(size * size)
  // Column tops (sides darken with depth under the surface) and the band of heights used.
  let yLo = sy
  let yHi = -1
  for (let z = z0; z < z1; z += 1) {
    for (let x = x0; x < x1; x += 1) {
      let top = -1
      let high = -1
      for (let y = sy - 1; y >= 0; y -= 1) {
        const id = data[x + z * sx + y * layer]
        if (id === B.AIR) continue
        if (high < 0) high = y
        if (KIND[id] !== 3) {
          top = y
          break
        }
      }
      colTop[(z - z0) * size + (x - x0)] = top
      if (high > yHi) yHi = high
      if (high >= 0) {
        let low = 0
        while (low < high && data[x + z * sx + low * layer] === B.AIR) low += 1
        if (low < yLo) yLo = low
      }
    }
  }
  if (yHi < 0) return out
  yLo = Math.max(0, yLo)

  // The light sources in and round the chunk (their light crosses chunk edges).
  srcN = 0
  const lx0 = Math.max(0, x0 - MAX_REACH)
  const lz0 = Math.max(0, z0 - MAX_REACH)
  const lx1 = Math.min(sx, x1 + MAX_REACH)
  const lz1 = Math.min(sz, z1 + MAX_REACH)
  const ly0 = Math.max(0, yLo - MAX_REACH)
  const ly1 = Math.min(sy - 1, yHi + MAX_REACH)
  for (let y = ly0; y <= ly1; y += 1) {
    for (let z = lz0; z < lz1; z += 1) {
      for (let x = lx0; x < lx1; x += 1) {
        const r = LIGHT[data[x + z * sx + y * layer]]
        if (!r) continue
        if ((srcN + 1) * 4 > src.length) {
          const bigger = new Float32Array(src.length * 2)
          bigger.set(src)
          src = bigger
        }
        src[srcN * 4] = x + 0.5
        src[srcN * 4 + 1] = y + 0.5
        src[srcN * 4 + 2] = z + 0.5
        src[srcN * 4 + 3] = r
        srcN += 1
      }
    }
  }

  /** Is the point (x, y, z) in the shadow of anything between it and the sun? */
  const shadowed = (px, py, pz) => {
    let x = px
    let y = py
    let z = pz
    for (let i = 0; i < SUN_STEPS; i += 1) {
      x += SUN[0] * SUN_STEP
      y += SUN[1] * SUN_STEP
      z += SUN[2] * SUN_STEP
      if (y >= sy) return false
      const bx = Math.floor(x)
      const bz = Math.floor(z)
      if (bx < 0 || bz < 0 || bx >= sx || bz >= sz) return false
      if (CASTS[data[bx + bz * sx + Math.floor(y) * layer]]) return true
    }
    return false
  }

  // Plants: two crossed quads each, swaying, a little darker in the shade.
  for (let y = yLo; y <= yHi; y += 1) {
    for (let z = z0; z < z1; z += 1) {
      for (let x = x0; x < x1; x += 1) {
        const id = data[x + z * sx + y * layer]
        if (KIND[id] !== 3) continue
        const top = colTop[(z - z0) * size + (x - x0)]
        const lit = shadowed(x + 0.5, y + 0.6, z + 0.5) ? 0.72 : 1
        const c = (232 + ((x * 7 + z * 13) % 22)) * (top - y > 0 ? 0.78 : 1) * lit
        for (let i = 0; i < 4; i += 1) {
          rgb12[i * 3] = to8(c * 1.02)
          rgb12[i * 3 + 1] = to8(c * 1.03)
          rgb12[i * 3 + 2] = to8(c * 0.9)
        }
        const [u0, v0] = UVS[id][1]
        for (const shape of [CROSS_A, CROSS_B]) {
          for (let i = 0; i < 4; i += 1) {
            pos4[i][0] = x + shape[i][0]
            pos4[i][1] = y + shape[i][1]
            pos4[i][2] = z + shape[i][2]
          }
          emit('cutout', pos4, rgb12, u0, v0, MOTION[id] + 4 * blockLight(x, y, z), ONE_ST)
        }
      }
    }
  }

  // Cube faces, one direction at a time, slice by slice, merged greedily.
  const lo = [x0, yLo, z0]
  const hi = [x1, yHi + 1, z1]
  const p = [0, 0, 0]
  for (let f = 0; f < 6; f += 1) {
    const face = FACES[f]
    const { n, d, sa, ta } = face
    const S = hi[sa] - lo[sa]
    const T = hi[ta] - lo[ta]
    if (maskKey.length < S * T) {
      maskKey = new Float64Array(S * T)
      maskRgb = new Uint8Array(S * T * 12)
      maskId = new Uint8Array(S * T)
      maskLight = new Uint8Array(S * T)
    }
    const tint = FACE_TINT[f]
    for (let slice = lo[d]; slice < hi[d]; slice += 1) {
      p[d] = slice
      let any = false
      for (let t = 0; t < T; t += 1) {
        p[ta] = lo[ta] + t
        for (let s = 0; s < S; s += 1) {
          p[sa] = lo[sa] + s
          const m = t * S + s
          maskKey[m] = 0
          const x = p[0]
          const y = p[1]
          const z = p[2]
          const id = data[x + z * sx + y * layer]
          const kind = KIND[id]
          if (kind !== 1 && kind !== 2) continue
          const nb = get(x + n[0], y + n[1], z + n[2])
          // No faces between leaves and leaves, or water and water (still or flowing).
          if (OPAQUE[nb] || (kind === 2 && nb === id) || (MOTION[id] === 3 && MOTION[nb] === 3)) continue
          // The open sea's surface is the sea plane's job (one quad to the horizon).
          if (f === 2 && MOTION[id] === 3 && y === world.seaLevel) continue
          any = true
          maskId[m] = id
          const def = BLOCKS[id]
          const o = m * 12
          const light = def.glow ? 15 : blockLight(x + n[0], y + n[1], z + n[2])
          maskLight[m] = light
          if (def.glow) {
            const g = to8(255 * Math.max(0.88, face.s))
            maskRgb.fill(g, o, o + 12)
            maskKey[m] = id * 16777216 + g * 65793 + light * LIGHT_KEY
            continue
          }
          const depth = colTop[(z - z0) * size + (x - x0)] - y
          // Sky light: tops under an overhang are dim; sides dim the deeper they sit.
          let k = face.s * (f === 2 ? (depth > 0 ? 0.82 : 1) : Math.max(0.58, 1 - depth * 0.03))
          let tr = tint[0]
          let tg = tint[1]
          let tb = tint[2]
          // Sun: faces turned to it take more light, unless something casts a shadow.
          if (face.sun > 0.05 && MOTION[id] !== 3) {
            if (shadowed(x + 0.5 + n[0] * 0.55, y + 0.5 + n[1] * 0.55, z + 0.5 + n[2] * 0.55)) {
              k *= 0.62
              tr *= SHADOW_TINT[0]
              tg *= SHADOW_TINT[1]
              tb *= SHADOW_TINT[2]
            } else k *= 1 + face.sun * 0.12
          }
          // Corner shading from the blocks around each corner on the outside.
          let uniform = true
          let first = -1
          for (let i = 0; i < 4; i += 1) {
            const c = face.c[i]
            let s1x = 0
            let s1y = 0
            let s1z = 0
            let s2x = 0
            let s2y = 0
            let s2z = 0
            if (n[0] !== 0) {
              s1y = c[1] ? 1 : -1
              s2z = c[2] ? 1 : -1
            } else if (n[1] !== 0) {
              s1x = c[0] ? 1 : -1
              s2z = c[2] ? 1 : -1
            } else {
              s1x = c[0] ? 1 : -1
              s2y = c[1] ? 1 : -1
            }
            const bx = x + n[0]
            const by = y + n[1]
            const bz = z + n[2]
            const a = OPAQUE[get(bx + s1x, by + s1y, bz + s1z)]
            const b = OPAQUE[get(bx + s2x, by + s2y, bz + s2z)]
            const cc = OPAQUE[get(bx + s1x + s2x, by + s1y + s2y, bz + s1z + s2z)]
            const ao = a && b ? 0 : 3 - (a + b + cc)
            if (first < 0) first = ao
            else if (ao !== first) uniform = false
            const l = 255 * k * AO[ao]
            maskRgb[o + i * 3] = to8(l * tr)
            maskRgb[o + i * 3 + 1] = to8(l * tg)
            maskRgb[o + i * 3 + 2] = to8(l * tb)
          }
          maskKey[m] = uniform ? id * 16777216 + maskRgb[o] * 65536 + maskRgb[o + 1] * 256 + maskRgb[o + 2] + light * LIGHT_KEY : -1
        }
      }
      if (!any) continue

      // Greedy merge: grow each face right, then down, while the faces stay identical.
      for (let t = 0; t < T; t += 1) {
        for (let s = 0; s < S; s += 1) {
          const m = t * S + s
          const key = maskKey[m]
          if (key === 0) continue
          let w = 1
          let h = 1
          if (key > 0) {
            while (s + w < S && maskKey[m + w] === key) w += 1
            grow: while (t + h < T) {
              const row = (t + h) * S + s
              for (let q = 0; q < w; q += 1) if (maskKey[row + q] !== key) break grow
              h += 1
            }
          }
          for (let r = 0; r < h; r += 1) maskKey.fill(0, (t + r) * S + s, (t + r) * S + s + w)
          // Corners in the world, and across the quad in blocks (for the tiling).
          const base = [0, 0, 0]
          base[d] = slice
          base[sa] = lo[sa] + s
          base[ta] = lo[ta] + t
          for (let i = 0; i < 4; i += 1) {
            const c = face.c[i]
            for (let a = 0; a < 3; a += 1) pos4[i][a] = base[a] + (a === d ? c[a] : c[a] * (a === sa ? w : h))
            st8[i * 2] = CORNER_S[i] * w
            st8[i * 2 + 1] = CORNER_T[i] * h
          }
          const id = maskId[m]
          const [u0, v0] = UVS[id][face.t]
          const o = m * 12
          for (let i = 0; i < 12; i += 1) rgb12[i] = maskRgb[o + i]
          emit(KIND[id] === 2 ? 'cutout' : 'solid', pos4, rgb12, u0, v0, MOTION[id] + 4 * maskLight[m], st8)
        }
      }
    }
  }
  return out
}
