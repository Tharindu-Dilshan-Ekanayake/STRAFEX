import { generateLobby, generateMatch, MAPS } from '@shared/maps'
import { B, BLOCKS, unpackKey } from '@shared/voxel'

/**
 * The world you're standing in, as this client knows it: the static lobby or the
 * current round's islands (rebuilt from map + seed, then the host's edits on top).
 * The terrain renderer watches `version` (a whole new world) and `dirty` (chunks to
 * re-mesh after an edit).
 */

export const CHUNK = 32

let lobby = null
/** The lobby's layout (spawn, case stations, board): built once, on first use. */
export function lobbyLayout() {
  if (!lobby) lobby = generateLobby()
  return lobby
}

export const worldState = {
  /** 'lobby' | 'match' */
  kind: 'lobby',
  world: null,
  /** The round's map id and generator output (spawns, lucky positions). */
  map: 'meadow',
  gen: null,
  /** Bumped when `world` is replaced. */
  version: 0,
  /** Chunk keys ('cx,cz') that need re-meshing. */
  dirty: new Set(),
  /** Block changes since the mesh worker last heard, `[x, y, z, id, ...]` (Terrain.jsx sends them). */
  pendingEdits: [],
}

const worldListeners = new Set()
/** Calls `fn()` whenever the world is replaced (a new round, back to the lobby). */
export function onWorldChange(fn) {
  worldListeners.add(fn)
  return () => worldListeners.delete(fn)
}
const changed = () => {
  for (const fn of worldListeners) fn()
}

export function enterLobby() {
  const l = lobbyLayout()
  worldState.kind = 'lobby'
  worldState.world = l.world
  worldState.map = 'lobby'
  worldState.gen = null
  worldState.dirty.clear()
  worldState.pendingEdits.length = 0
  worldState.version += 1
  changed()
}

/** A new round's world: `edits` are the host's changes so far, `[key, id, key, id, ...]`. */
export function enterMatch({ map, seed, mode, edits = [] }) {
  const gen = generateMatch(map, seed, mode)
  for (let i = 0; i + 1 < edits.length; i += 2) {
    const [x, y, z] = unpackKey(edits[i])
    gen.world.set(x, y, z, edits[i + 1])
  }
  worldState.kind = 'match'
  worldState.world = gen.world
  worldState.map = MAPS[map] ? map : 'meadow'
  worldState.gen = gen
  worldState.dirty.clear()
  worldState.pendingEdits.length = 0
  worldState.version += 1
  changed()
}

function markDirty(x, z) {
  const cx = Math.floor(x / CHUNK)
  const cz = Math.floor(z / CHUNK)
  worldState.dirty.add(`${cx},${cz}`)
  // Faces (and corner shading) on the neighbouring chunk change too.
  const lx = x - cx * CHUNK
  const lz = z - cz * CHUNK
  if (lx === 0) worldState.dirty.add(`${cx - 1},${cz}`)
  if (lx === CHUNK - 1) worldState.dirty.add(`${cx + 1},${cz}`)
  if (lz === 0) worldState.dirty.add(`${cx},${cz - 1}`)
  if (lz === CHUNK - 1) worldState.dirty.add(`${cx},${cz + 1}`)
}

/** Sets one block (an edit from the host, or our own guess) and marks it for re-meshing. */
export function setBlock(x, y, z, id) {
  const w = worldState.world
  if (!w || !w.inBounds(x, y, z) || w.get(x, y, z) === id) return false
  w.set(x, y, z, id)
  worldState.pendingEdits.push(x, y, z, id)
  markDirty(x, z)
  return true
}

/** Host edits `[x, y, z, id, ...]` (only for the round's world). */
export function applyEdits(list) {
  if (worldState.kind !== 'match') return []
  const changed = []
  for (let i = 0; i + 3 < list.length; i += 4) {
    const x = list[i]
    const y = list[i + 1]
    const z = list[i + 2]
    const id = list[i + 3]
    const before = worldState.world.get(x, y, z)
    if (setBlock(x, y, z, id)) changed.push({ x, y, z, id, before })
  }
  return changed
}

export const blockAt = (x, y, z) => worldState.world?.get(x, y, z) ?? B.AIR
export const blockDef = (id) => BLOCKS[id] || BLOCKS[B.AIR]
