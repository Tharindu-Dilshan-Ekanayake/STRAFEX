import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Sphere, Vector3 } from 'three'

import { getQuality } from '../../store/quality'
import { getAtlas } from '../art/atlas'
import { SIZE, T } from '../art/atlasLayout'
import { day } from '../dayNight'
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

/**
 * Shared by both terrain materials: the time (wind and water), how hard the wind blows
 * (0 on LOW: nothing sways), and how strong the colour grade is.
 */
const terrainUniforms = {
  uTime: { value: 0 },
  uSway: { value: 0 },
  uGrade: { value: 1 },
  // Day and night: the sky light's brightness and tint, and how dark it is (the light
  // of torches, campfires and lanterns is baked into the mesh; it shows in the dark).
  uDay: { value: 1 },
  uTint: { value: new Color(1, 1, 1) },
  uNight: { value: 0 },
}

/**
 * The terrain shader, on top of three's unlit material:
 * - the texture tiles once per block across merged quads (`tile` = the tile's corner in
 *   the atlas, `uv` = position across the quad in blocks; `fract` wraps it)
 * - leaves and plants sway in the wind, plants from their roots; water flows
 * - a light colour grade: a touch more saturation and contrast, before the fog
 */
function terrainShader(shader) {
  Object.assign(shader.uniforms, terrainUniforms)
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec3 tile;
uniform float uTime;
uniform float uSway;
varying vec2 vTileBase;
varying vec2 vLocal;
varying float vBlock;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vTileBase = tile.xy;
vLocal = uv;
// tile.z = motion (0-3) + 4 x block light (0-15).
float motion = mod(tile.z, 4.0);
vBlock = floor(tile.z / 4.0 + 0.01) / 15.0;
if (motion > 0.5 && motion < 2.5 && uSway > 0.0) {
  // Each point sways by where it is, so neighbouring leaves move together (no gaps).
  float ph = position.x * 0.71 + position.z * 0.93 + position.y * 0.37;
  float amp = motion > 1.5 ? 0.09 * uv.y : 0.035;
  transformed.x += sin(uTime * 1.7 + ph) * amp * uSway;
  transformed.z += cos(uTime * 1.3 + ph * 1.3) * amp * 0.8 * uSway;
}
if (motion > 2.5) vLocal += vec2(uTime * 0.08, uTime * 0.05);`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uGrade;
uniform float uDay;
uniform vec3 uTint;
uniform float uNight;
varying vec2 vTileBase;
varying vec2 vLocal;
varying float vBlock;`,
    )
    .replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
  // The mip level from the unwrapped position (fract's jumps would fool the GPU into
  // blurring the seams), at most level 2 (cut-outs 1: leaves keep their shape).
  vec2 texel = vLocal * ${(TILE_UV * ATLAS_PX).toFixed(3)};
  vec2 ddx = dFdx(texel);
  vec2 ddy = dFdy(texel);
  float lod = 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)));
  #ifdef USE_ALPHATEST
    lod = clamp(lod, 0.0, 1.0);
  #else
    lod = clamp(lod, 0.0, 2.0);
  #endif
  vec4 sampledDiffuseColor = textureLod(map, vTileBase + fract(vLocal) * ${TILE_UV.toFixed(6)}, lod);
  diffuseColor *= sampledDiffuseColor;
#endif`,
    )
    .replace(
      '#include <tonemapping_fragment>',
      `{
  vec3 c = gl_FragColor.rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 graded = clamp((mix(vec3(l), c, 1.06) - 0.5) * 1.07 + 0.5, 0.0, 1.0);
  gl_FragColor.rgb = mix(c, graded, uGrade);
  // Time of day: the sky's light (dimmer and bluer at night), plus the warm light of
  // torches, campfires and lanterns (baked into the mesh) once it's dark.
  vec3 lit = uTint * uDay + vec3(1.0, 0.76, 0.48) * (vBlock * vBlock * 1.3) * uNight;
  gl_FragColor.rgb *= min(lit, vec3(1.2));
}
#include <tonemapping_fragment>`,
    )
}

const solidMaterial = new MeshBasicMaterial({ vertexColors: true })
const cutoutMaterial = new MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5, side: DoubleSide })
solidMaterial.onBeforeCompile = terrainShader
cutoutMaterial.onBeforeCompile = terrainShader
let materialsReady = false
function materials() {
  if (!materialsReady) {
    const atlas = getAtlas()
    solidMaterial.map = atlas
    cutoutMaterial.map = atlas
    materialsReady = true
  }
}

/** One block's tile, as a fraction of the atlas, and the atlas's size in pixels. */
const TILE_UV = T / SIZE
const ATLAS_PX = SIZE

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
  mesh.userData.has = buf.verts > 0
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
    geo.setAttribute('tile', new BufferAttribute(new Float32Array(cap * 3), 3))
    geo.setAttribute('color', new BufferAttribute(new Uint8Array(cap * 3), 3, true))
    geo.setIndex(new BufferAttribute(new Uint32Array(icap), 1))
    mesh.userData.capacity = cap
    mesh.userData.icap = icap
  }
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const tile = geo.attributes.tile
  const col = geo.attributes.color
  pos.array.set(buf.pos.subarray(0, buf.verts * 3))
  uv.array.set(buf.uv.subarray(0, buf.verts * 2))
  tile.array.set(buf.tile.subarray(0, buf.verts * 3))
  col.array.set(buf.col.subarray(0, buf.verts * 3))
  geo.index.array.set(buf.idx.subarray(0, buf.tris * 3))
  for (const attr of [pos, uv, tile, col, geo.index]) {
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, attr === geo.index ? buf.tris * 3 : attr === uv ? buf.verts * 2 : buf.verts * 3)
    attr.needsUpdate = true
  }
  geo.setDrawRange(0, buf.tris * 3)
  mesh.visible = !mesh.userData.far
}

/**
 * Chunks wholly past the preset's view distance (they'd be lost in the fog anyway) are
 * not drawn at all: on LOW that keeps the big world's far side off the GPU.
 */
function cullFar(chunks) {
  const b = runtime.cameraPos
  const far = getQuality().viewDistance
  for (const c of chunks.values()) {
    const dx = Math.max(0, Math.abs(b.x - (c.cx * CHUNK + CHUNK / 2)) - CHUNK / 2)
    const dz = Math.max(0, Math.abs(b.z - (c.cz * CHUNK + CHUNK / 2)) - CHUNK / 2)
    const isFar = Math.hypot(dx, dz) > far
    c.solid.userData.far = isFar
    c.solid.visible = Boolean(c.solid.userData.has) && !isFar
    c.cutout.userData.far = isFar
    c.cutout.visible = Boolean(c.cutout.userData.has) && !isFar
  }
}

function build(world, chunk) {
  meshChunk(world, chunk.cx * CHUNK, chunk.cz * CHUNK, CHUNK)
  upload(chunk.solid, out.solid)
  upload(chunk.cutout, out.cutout)
}

/** The time of day, for the terrain shader. */
function dayUniforms() {
  const u = terrainUniforms
  u.uDay.value = day.light
  u.uTint.value.copy(day.tint)
  u.uNight.value = day.night
}

/** Most chunk requests in flight at once (edits jump the queue). */
const MAX_IN_FLIGHT = 6
/**
 * A busy chunk (players building, water flowing, fire) is re-meshed at most this often,
 * and at most this many finished meshes go to the GPU a frame: with a full server at work
 * no single frame does all the uploading (a hitch).
 */
const REMESH_GAP_MS = 100
const UPLOADS_PER_FRAME = 3

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
        // Uploaded a few a frame (see UPLOADS_PER_FRAME); a newer mesh replaces a waiting one.
        ready.set(m.key, m)
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
        worker.postMessage({ world: { version, sx: world.sx, sy: world.sy, sz: world.sz, sealed: world.sealed, seaLevel: world.seaLevel, data } }, [data.buffer])
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

    /** Finished meshes waiting for the GPU, by chunk. */
    const ready = new Map()
    const request = (chunk, key) => {
      chunk.seq = ++seq
      chunk.reqAt = performance.now()
      inFlight += 1
      worker.postMessage({ mesh: { version, key, cx: chunk.cx, cz: chunk.cz, size: CHUNK, seq: chunk.seq } })
    }

    let raf = 0
    let frame = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const world = worldState.world
      if (!world) return
      frame += 1
      if (frame % 15 === 0) cullFar(chunks)
      if (frame % 6 === 0) dayUniforms()
      // Wind and water: the clock, and the preset's wind (none on LOW).
      const q = getQuality()
      terrainUniforms.uTime.value = (performance.now() / 1000) % 1000
      terrainUniforms.uSway.value = q.foliageSway ? 1 : 0
      terrainUniforms.uGrade.value = q.colorGrade
      if (worker) {
        // Edits first, so the meshes asked for next see them.
        if (worldState.pendingEdits.length) {
          worker.postMessage({ edits: worldState.pendingEdits.slice() })
          worldState.pendingEdits.length = 0
        }
        // Finished meshes to the GPU, a few a frame.
        let uploads = 0
        for (const [key, m] of ready) {
          if (uploads >= UPLOADS_PER_FRAME) break
          ready.delete(key)
          const chunk = chunks.get(key)
          // A newer request for this chunk is on its way: this one is already stale.
          if (!chunk || chunk.seq !== m.seq) continue
          upload(chunk.solid, m.solid)
          upload(chunk.cutout, m.cutout)
          uploads += 1
        }
        // Changed chunks: re-meshed at once, unless they were a moment ago (then shortly).
        const nowMs = performance.now()
        for (const key of worldState.dirty) {
          const chunk = chunks.get(key)
          if (!chunk) {
            worldState.dirty.delete(key)
            continue
          }
          if (nowMs - (chunk.reqAt || 0) < REMESH_GAP_MS) continue
          worldState.dirty.delete(key)
          request(chunk, key)
        }
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
