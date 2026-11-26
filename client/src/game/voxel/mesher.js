import { B, BLOCKS } from '@shared/voxel'

import { tileUV } from '../art/atlasLayout'

/**
 * Turns a chunk of the voxel grid into triangles: only faces that border air (or a
 * see-through block) are kept, each with its atlas tile, a fixed shade per direction
 * (sun from above, like the classic look) and per-corner ambient occlusion. No lights
 * are computed at runtime - the colour is baked into the vertices.
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
const AO = [0.52, 0.68, 0.84, 1]

/** Per block id: does it hide the faces behind it, and its three tile UV rects. */
const OPAQUE = new Uint8Array(256)
const KIND = new Uint8Array(256) // 0 none, 1 solid, 2 cutout, 3 cross
const UVS = []
for (let id = 0; id < BLOCKS.length; id += 1) {
  const def = BLOCKS[id]
  if (!def) continue
  OPAQUE[id] = def.render === 'solid' ? 1 : 0
  KIND[id] = { none: 0, solid: 1, cutout: 2, cross: 3 }[def.render] ?? 0
  UVS[id] = def.tex.map((name) => (name ? tileUV(name) : [0, 0, 0, 0]))
}

function makeBuffer(cap) {
  return { pos: new Float32Array(cap * 3), uv: new Float32Array(cap * 2), col: new Uint8Array(cap * 3), idx: new Uint32Array(cap * 1.5), verts: 0, tris: 0 }
}
function grow(buf) {
  const next = makeBuffer((buf.pos.length / 3) * 2)
  next.pos.set(buf.pos)
  next.uv.set(buf.uv)
  next.col.set(buf.col)
  next.idx.set(buf.idx)
  next.verts = buf.verts
  next.tris = buf.tris
  return next
}

/** Scratch output: `solid` and `cutout` (leaves, glass, flowers) meshes of the last chunk. */
export const out = { solid: makeBuffer(16384), cutout: makeBuffer(4096) }

/** Colour tint of the face being written (sunlit tops warm, shaded sides cool), 0..1+. */
let tintR = 1
let tintG = 1
let tintB = 1
const to8 = (v) => (v > 255 ? 255 : v)

function quad(key, x, y, z, corners, uv, colors) {
  let buf = out[key]
  if ((buf.verts + 4) * 3 > buf.pos.length || ((buf.tris + 2) * 3) > buf.idx.length) buf = out[key] = grow(buf)
  const v = buf.verts
  for (let i = 0; i < 4; i += 1) {
    const c = corners[i]
    buf.pos[(v + i) * 3] = x + c[0]
    buf.pos[(v + i) * 3 + 1] = y + c[1]
    buf.pos[(v + i) * 3 + 2] = z + c[2]
    const col = colors[i]
    buf.col[(v + i) * 3] = to8(col * tintR)
    buf.col[(v + i) * 3 + 1] = to8(col * tintG)
    buf.col[(v + i) * 3 + 2] = to8(col * tintB)
  }
  buf.uv[v * 2] = uv[0]
  buf.uv[v * 2 + 1] = uv[1]
  buf.uv[v * 2 + 2] = uv[2]
  buf.uv[v * 2 + 3] = uv[1]
  buf.uv[v * 2 + 4] = uv[2]
  buf.uv[v * 2 + 5] = uv[3]
  buf.uv[v * 2 + 6] = uv[0]
  buf.uv[v * 2 + 7] = uv[3]
  const t = buf.tris * 3
  // Flip the diagonal where the shading would otherwise crease the wrong way.
  if (colors[0] + colors[2] < colors[1] + colors[3]) {
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
 * bounce underneath. Cheap stand-in for real lighting, baked like everything else.
 */
const FACE_TINT = [
  [0.95, 0.98, 1.04],
  [0.95, 0.98, 1.04],
  [1.05, 1.01, 0.9],
  [0.82, 0.88, 1.06],
  [0.98, 0.98, 1.0],
  [0.9, 0.95, 1.07],
]
/** Height of the topmost block in each column of the chunk being meshed. */
let colTop = new Int16Array(32 * 32)

const corners4 = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
const colors4 = [0, 0, 0, 0]
const CROSS_A = [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]]
const CROSS_B = [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15]]

/**
 * Meshes the blocks with x0 <= x < x0+size and z0 <= z < z0+size (all heights) into
 * `out`. Returns `out`.
 */
export function meshChunk(world, x0, z0, size) {
  out.solid.verts = out.solid.tris = 0
  out.cutout.verts = out.cutout.tris = 0
  const { sx, sy, sz, data } = world
  const layer = sx * sz
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : data[x + z * sx + y * layer])
  const x1 = Math.min(sx, x0 + size)
  const z1 = Math.min(sz, z0 + size)
  // Column tops: sides fade darker the deeper they sit under the surface (the
  // undersides of the islands), and ground under a tree or ledge is in its shade.
  if (colTop.length < size * size) colTop = new Int16Array(size * size)
  // ...and the band of heights that has any blocks at all: only that is scanned.
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
        // The lowest block in the column (an underside can hang below a gap).
        let low = 0
        while (low < high && data[x + z * sx + low * layer] === B.AIR) low += 1
        if (low < yLo) yLo = low
      }
    }
  }
  for (let y = Math.max(0, yLo); y <= yHi; y += 1) {
    for (let z = z0; z < z1; z += 1) {
      for (let x = x0; x < x1; x += 1) {
        const id = data[x + z * sx + y * layer]
        if (id === B.AIR) continue
        const kind = KIND[id]
        const uvs = UVS[id]
        const top = colTop[(z - z0) * size + (x - x0)]
        const depth = top - y
        // A little brightness noise per block, so big flat areas don't look printed.
        const jitter = 0.97 + (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 15) / 250
        if (kind === 3) {
          const c = (235 + ((x * 7 + z * 13) % 20)) * (depth > 0 ? 0.75 : 1)
          tintR = 1.02
          tintG = 1.02
          tintB = 0.92
          colors4[0] = colors4[1] = colors4[2] = colors4[3] = c
          quad('cutout', x, y, z, CROSS_A, uvs[1], colors4)
          quad('cutout', x, y, z, CROSS_B, uvs[1], colors4)
          continue
        }
        const key = kind === 2 ? 'cutout' : 'solid'
        const glow = BLOCKS[id].glow || BLOCKS[id].lucky
        for (let f = 0; f < 6; f += 1) {
          const face = FACES[f]
          const n = face.n
          const nb = get(x + n[0], y + n[1], z + n[2])
          if (OPAQUE[nb] || (kind === 2 && nb === id)) continue
          if (glow) {
            tintR = tintG = tintB = 1
          } else {
            const t = FACE_TINT[f]
            // Tops under something are in shade; sides darken with depth.
            const shade = (f === 2 ? (depth > 0 ? 0.74 : 1) : Math.max(0.56, 1 - depth * 0.032)) * jitter
            tintR = t[0] * shade
            tintG = t[1] * shade
            tintB = t[2] * shade
          }
          // Corner shading from the three blocks around each corner on the outside.
          for (let i = 0; i < 4; i += 1) {
            const c = face.c[i]
            corners4[i] = c
            if (glow) {
              colors4[i] = 255
              continue
            }
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
            colors4[i] = Math.round(255 * face.s * AO[ao])
          }
          if (glow) colors4[0] = colors4[1] = colors4[2] = colors4[3] = Math.round(255 * Math.max(0.85, face.s))
          quad(key, x, y, z, corners4, uvs[face.t], colors4)
        }
      }
    }
  }
  return out
}
