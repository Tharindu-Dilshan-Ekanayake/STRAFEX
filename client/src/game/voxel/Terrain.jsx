import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Sphere, Vector3 } from 'three'

import { getAtlas } from '../art/atlas'
import { runtime } from '../runtime'
import { CHUNK, onWorldChange, worldState } from '../world'
import { meshChunk, out } from './mesher'

/**
 * The voxel terrain: one mesh per 32x32 column of the world (plus one for see-through
 * blocks where there are any) - 9 to 32 draw calls for a whole round's map. Chunks are
 * built a few per frame, nearest first, and re-meshed when a block in them changes.
 *
 * The meshing itself runs in a Web Worker (meshWorker.js), which keeps its own copy of
 * the world in step with the edits sent to it; this thread only uploads the finished
 * arrays to the GPU. Everything here runs from its own animation-frame loop and a
 * world-change subscription, not from useFrame.
 */

const solidMaterial = new MeshBasicMaterial({ vertexColors: true })
const cutoutMaterial = new MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5, side: DoubleSide })
let materialsReady = false
function materials() {
  if (!materialsReady) {
    const atlas = getAtlas()
    solidMaterial.map = atlas
    cutoutMaterial.map = atlas
    materialsReady = true
  }
}

/** A chunk mesh with room to grow: attributes are reused while the data fits. */
function makeChunkMesh(material, cx, cz, sy) {
  const geometry = new BufferGeometry()
  const mesh = new Mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  mesh.userData.capacity = 0
  mesh.userData.icap = 0
  geometry.boundingSphere = new Sphere(new Vector3(cx * CHUNK + CHUNK / 2, sy / 2, cz * CHUNK + CHUNK / 2), Math.hypot(CHUNK / 2, sy / 2, CHUNK / 2))
  return mesh
}

function upload(mesh, buf) {
  const geo = mesh.geometry
  if (buf.verts === 0) {
    mesh.visible = false
    return
  }
  if (buf.verts > mesh.userData.capacity || buf.tris * 3 > mesh.userData.icap) {
    // Grow with headroom so the next few edits fit without reallocating.
    const cap = Math.ceil(buf.verts * 1.3) + 64
    const icap = Math.ceil(buf.tris * 3 * 1.3) + 96
    geo.setAttribute('position', new BufferAttribute(new Float32Array(cap * 3), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(cap * 2), 2))
    geo.setAttribute('color', new BufferAttribute(new Uint8Array(cap * 3), 3, true))
    geo.setIndex(new BufferAttribute(new Uint32Array(icap), 1))
    mesh.userData.capacity = cap
    mesh.userData.icap = icap
  }
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const col = geo.attributes.color
  pos.array.set(buf.pos.subarray(0, buf.verts * 3))
  uv.array.set(buf.uv.subarray(0, buf.verts * 2))
  col.array.set(buf.col.subarray(0, buf.verts * 3))
  geo.index.array.set(buf.idx.subarray(0, buf.tris * 3))
  for (const attr of [pos, uv, col, geo.index]) {
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, attr === geo.index ? buf.tris * 3 : attr === uv ? buf.verts * 2 : buf.verts * 3)
    attr.needsUpdate = true
  }
  geo.setDrawRange(0, buf.tris * 3)
  mesh.visible = true
}

function build(world, chunk) {
  meshChunk(world, chunk.cx * CHUNK, chunk.cz * CHUNK, CHUNK)
  upload(chunk.solid, out.solid)
  upload(chunk.cutout, out.cutout)
}

/** Most chunk requests in flight at once (edits jump the queue). */
const MAX_IN_FLIGHT = 6

export default function Terrain() {
  const group = useMemo(() => new Group(), [])

  useEffect(() => {
    materials()
    const chunks = new Map()
    let queue = []
    let version = -1
    let seq = 0
    let inFlight = 0

    // Meshing runs in a worker when it can; in this thread otherwise.
    let worker = null
    try {
      worker = new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        const m = e.data
        inFlight = Math.max(0, inFlight - 1)
        if (m.version !== version) return
        const chunk = chunks.get(m.key)
        // A newer request for this chunk is on its way: this one is already stale.
        if (!chunk || chunk.seq !== m.seq) return
        upload(chunk.solid, m.solid)
        upload(chunk.cutout, m.cutout)
      }
      worker.onerror = (err) => {
        console.warn('[terrain] mesh worker failed, meshing in this thread', err)
        worker?.terminate()
        worker = null
        inFlight = 0
        queue = [...chunks.keys()]
      }
    } catch (err) {
      console.warn('[terrain] no mesh worker, meshing in this thread', err)
      worker = null
    }

    const dispose = () => {
      for (const c of chunks.values()) {
        group.remove(c.solid, c.cutout)
        c.solid.geometry.dispose()
        c.cutout.geometry.dispose()
      }
      chunks.clear()
    }

    // A new world: drop the old chunks, queue every chunk of the new one, nearest first.
    const rebuild = () => {
      dispose()
      const world = worldState.world
      if (!world) return
      version = worldState.version
      if (worker) {
        const data = world.data.slice()
        worker.postMessage({ world: { version, sx: world.sx, sy: world.sy, sz: world.sz, data } }, [data.buffer])
      }
      const nx = Math.ceil(world.sx / CHUNK)
      const nz = Math.ceil(world.sz / CHUNK)
      const b = runtime.player.body
      const list = []
      for (let cx = 0; cx < nx; cx += 1) {
        for (let cz = 0; cz < nz; cz += 1) {
          const key = `${cx},${cz}`
          const chunk = { cx, cz, seq: 0, solid: makeChunkMesh(solidMaterial, cx, cz, world.sy), cutout: makeChunkMesh(cutoutMaterial, cx, cz, world.sy) }
          chunks.set(key, chunk)
          group.add(chunk.solid, chunk.cutout)
          list.push({ key, d: Math.hypot(cx * CHUNK + CHUNK / 2 - b.x, cz * CHUNK + CHUNK / 2 - b.z) })
        }
      }
      list.sort((a, c) => a.d - c.d)
      queue = list.map((e) => e.key)
      worldState.dirty.clear()
    }

    const request = (chunk, key) => {
      chunk.seq = ++seq
      inFlight += 1
      worker.postMessage({ mesh: { version, key, cx: chunk.cx, cz: chunk.cz, size: CHUNK, seq: chunk.seq } })
    }

    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const world = worldState.world
      if (!world) return
      if (worker) {
        // Edits first, so the meshes asked for next see them.
        if (worldState.pendingEdits.length) {
          worker.postMessage({ edits: worldState.pendingEdits.slice() })
          worldState.pendingEdits.length = 0
        }
        for (const key of worldState.dirty) {
          const chunk = chunks.get(key)
          if (chunk) request(chunk, key)
        }
        worldState.dirty.clear()
        while (queue.length && inFlight < MAX_IN_FLIGHT) {
          const key = queue.shift()
          const chunk = chunks.get(key)
          if (chunk) request(chunk, key)
        }
        return
      }
      // No worker: a few chunks a frame, edits first.
      worldState.pendingEdits.length = 0
      let budget = 0
      for (const key of worldState.dirty) {
        if (budget >= 3) break
        worldState.dirty.delete(key)
        const chunk = chunks.get(key)
        if (!chunk) continue
        build(world, chunk)
        budget += 1
      }
      const start = performance.now()
      while (queue.length && (budget === 0 || performance.now() - start < 6)) {
        const chunk = chunks.get(queue.shift())
        if (chunk) build(world, chunk)
        budget += 1
      }
    }

    rebuild()
    const off = onWorldChange(rebuild)
    raf = requestAnimationFrame(step)
    return () => {
      off()
      cancelAnimationFrame(raf)
      worker?.terminate()
      dispose()
    }
  }, [group])

  return <primitive object={group} />
}
