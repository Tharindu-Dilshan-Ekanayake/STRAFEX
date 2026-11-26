import { VoxelWorld } from '@shared/voxel'

import { meshChunk } from './mesher'

/**
 * Builds terrain meshes off the main thread. Keeps its own copy of the world, kept in
 * step by the edits the main thread forwards (messages arrive in order, so a mesh
 * request always sees every edit sent before it).
 *
 * in:  { world: { version, sx, sy, sz, sealed, data } }  a whole new world
 *      { edits: [x, y, z, id, ...] }                  block changes
 *      { mesh: { version, key, cx, cz, size, seq } }  build one chunk
 * out: { key, version, seq, solid, cutout }           geometry, typed arrays transferred
 */

let world = null
let version = -1

/** The used part of a scratch buffer, as fresh arrays that can be handed over. */
function pack(buf) {
  return {
    verts: buf.verts,
    tris: buf.tris,
    pos: buf.pos.slice(0, buf.verts * 3),
    uv: buf.uv.slice(0, buf.verts * 2),
    tile: buf.tile.slice(0, buf.verts * 3),
    col: buf.col.slice(0, buf.verts * 3),
    idx: buf.idx.slice(0, buf.tris * 3),
  }
}

self.onmessage = (e) => {
  const msg = e.data
  if (msg.world) {
    const w = msg.world
    world = new VoxelWorld(w.sx, w.sy, w.sz, w.data)
    world.sealed = Boolean(w.sealed)
    world.seaLevel = Number.isFinite(w.seaLevel) ? w.seaLevel : -1
    version = w.version
    return
  }
  if (msg.edits) {
    if (!world) return
    const list = msg.edits
    for (let i = 0; i + 3 < list.length; i += 4) world.set(list[i], list[i + 1], list[i + 2], list[i + 3])
    return
  }
  if (msg.mesh) {
    const m = msg.mesh
    if (!world || m.version !== version) return
    const out = meshChunk(world, m.cx * m.size, m.cz * m.size, m.size)
    const solid = pack(out.solid)
    const cutout = pack(out.cutout)
    self.postMessage({ key: m.key, version: m.version, seq: m.seq, solid, cutout }, [
      solid.pos.buffer,
      solid.uv.buffer,
      solid.tile.buffer,
      solid.col.buffer,
      solid.idx.buffer,
      cutout.pos.buffer,
      cutout.uv.buffer,
      cutout.tile.buffer,
      cutout.col.buffer,
      cutout.idx.buffer,
    ])
  }
}
