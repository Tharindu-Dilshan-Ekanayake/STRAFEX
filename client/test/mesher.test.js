import { describe, expect, it } from 'vitest'

import { B, VoxelWorld } from '@shared/voxel'

import { meshChunk } from '../src/game/voxel/mesher'

/** Brightness of the top-face vertex colours of the quad covering (x, y, z). */
function brightnessAt(out, x, y, z) {
  const b = out.solid
  for (let q = 0; q < b.verts; q += 4) {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let top = true
    for (let i = 0; i < 4; i += 1) {
      const v = (q + i) * 3
      if (b.pos[v + 1] !== y) top = false
      minX = Math.min(minX, b.pos[v])
      maxX = Math.max(maxX, b.pos[v])
      minZ = Math.min(minZ, b.pos[v + 2])
      maxZ = Math.max(maxZ, b.pos[v + 2])
    }
    if (top && x > minX && x < maxX && z > minZ && z < maxZ) return b.col[q * 3] + b.col[q * 3 + 1] + b.col[q * 3 + 2]
  }
  return -1
}

describe('chunk mesher', () => {
  it('draws only the faces you can see', () => {
    const w = new VoxelWorld(8, 8, 8)
    w.set(2, 2, 2, B.STONE)
    let out = meshChunk(w, 0, 0, 8)
    expect(out.solid.tris).toBe(12) // one cube: 6 faces x 2 triangles
    // A second block touching it hides the two faces between them, and the faces the
    // two share a side on merge into one: still six quads.
    w.set(3, 2, 2, B.STONE)
    out = meshChunk(w, 0, 0, 8)
    expect(out.solid.tris).toBe(12)
  })
  it('merges a flat floor into a few big quads, the texture still tiling per block', () => {
    const w = new VoxelWorld(32, 8, 32)
    for (let x = 4; x < 20; x += 1) for (let z = 4; z < 20; z += 1) w.set(x, 1, z, B.GRASS)
    const out = meshChunk(w, 0, 0, 32)
    // 16 x 16 tops alone would be 512 triangles without merging.
    expect(out.solid.tris).toBeLessThan(80)
    // Somewhere a quad spans more than one block: its uv runs past 1.
    let maxUv = 0
    for (let i = 0; i < out.solid.verts * 2; i += 1) maxUv = Math.max(maxUv, out.solid.uv[i])
    expect(maxUv).toBeGreaterThan(1)
  })
  it('bakes sun shadows: ground next to a tall wall on the sun side is darker', () => {
    const w = new VoxelWorld(32, 16, 32)
    for (let x = 0; x < 32; x += 1) for (let z = 0; z < 32; z += 1) w.set(x, 1, z, B.STONE)
    const bright = brightnessAt(meshChunk(w, 0, 0, 32), 10.5, 2, 10.5)
    // A wall between that spot and the sun (which is up, +x and -z).
    for (let y = 2; y < 12; y += 1) for (let z = 4; z < 14; z += 1) w.set(13, y, z, B.STONE)
    for (let y = 2; y < 12; y += 1) for (let x = 6; x < 16; x += 1) w.set(x, y, 7, B.STONE)
    const dark = brightnessAt(meshChunk(w, 0, 0, 32), 10.5, 2, 10.5)
    expect(dark).toBeLessThan(bright)
  })
  it('puts see-through blocks in the cutout mesh', () => {
    const w = new VoxelWorld(8, 8, 8)
    w.set(1, 1, 1, B.GLASS)
    w.set(4, 1, 4, B.FLOWER_RED)
    const out = meshChunk(w, 0, 0, 8)
    expect(out.solid.tris).toBe(0)
    expect(out.cutout.tris).toBeGreaterThan(0)
  })
  it('only meshes its own chunk', () => {
    const w = new VoxelWorld(64, 8, 8)
    w.set(40, 1, 1, B.STONE)
    expect(meshChunk(w, 0, 0, 32).solid.tris).toBe(0)
    expect(meshChunk(w, 32, 0, 32).solid.tris).toBe(12)
  })
})
