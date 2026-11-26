import { describe, expect, it } from 'vitest'

import { B, VoxelWorld } from '@shared/voxel'

import { meshChunk } from '../src/game/voxel/mesher'

describe('chunk mesher', () => {
  it('draws only the faces you can see', () => {
    const w = new VoxelWorld(8, 8, 8)
    w.set(2, 2, 2, B.STONE)
    let out = meshChunk(w, 0, 0, 8)
    expect(out.solid.tris).toBe(12) // one cube: 6 faces x 2 triangles
    // A second block touching it hides the two faces between them.
    w.set(3, 2, 2, B.STONE)
    out = meshChunk(w, 0, 0, 8)
    expect(out.solid.tris).toBe(20)
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
