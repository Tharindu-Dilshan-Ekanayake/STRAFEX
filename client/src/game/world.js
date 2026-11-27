import { DUEL_MAPS, generateArena, generateLobby, generateSpirelands } from '@shared/maps'
import { B, BLOCKS, blockKey, unpackKey } from '@shared/voxel'

/**
 * The world you're standing in, as this client knows it: the static lobby, a duel arena
 * or Spirelands (rebuilt from map + seed, then the host's edits on top).
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
  /** In a match: 'duel' | 'ffa'. */
  arena: null,
  world: null,
  /** The map id ('lobby', a duel map, 'spirelands') and its generator output. */
  map: 'lobby',
  gen: null,
  /**
   * Blocks players placed in this world (keys): in a duel only these can be broken,
   * the arena itself can't.
   */
  placed: new Set(),
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
  worldState.arena = null
  worldState.world = l.world
  worldState.map = 'lobby'
  worldState.gen = null
  worldState.placed.clear()
  worldState.dirty.clear()
  worldState.pendingEdits.length = 0
  worldState.version += 1
  changed()
}

/** A duel arena or Spirelands: `edits` are the host's changes so far, `[key, id, key, id, ...]`. */
export function enterMatch({ kind, map, seed, edits = [] }) {
  const gen = kind === 'ffa' ? generateSpirelands(seed) : generateArena(map, seed)
  worldState.placed.clear()
  for (let i = 0; i + 1 < edits.length; i += 2) {
    const [x, y, z] = unpackKey(edits[i])
    gen.world.set(x, y, z, edits[i + 1])
    if (edits[i + 1] !== B.AIR) worldState.placed.add(edits[i])
  }
  worldState.kind = 'match'
  worldState.arena = kind === 'ffa' ? 'ffa' : 'duel'
  worldState.world = gen.world
  worldState.map = kind === 'ffa' ? 'spirelands' : DUEL_MAPS[map] ? map : 'meadow'
  worldState.gen = gen
  worldState.dirty.clear()
  worldState.pendingEdits.length = 0
  worldState.version += 1
  changed()
}

/** Can this client break the block at (x, y, z)? Duel arenas only give back what players built. */
export function canBreak(x, y, z) {
  if (worldState.arena === 'ffa') return true
  return worldState.placed.has(blockKey(x, y, z))
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
  const before = w.get(x, y, z)
  w.set(x, y, z, id)
  if (id === B.AIR) worldState.placed.delete(blockKey(x, y, z))
  else worldState.placed.add(blockKey(x, y, z))
  worldState.pendingEdits.push(x, y, z, id)
  markDirty(x, z)
  // A light placed or taken away: its light reaches into the chunks round it too.
  const reach = BLOCKS[id]?.light || BLOCKS[before]?.light || 0
  if (reach) for (const [dx, dz] of [[-reach, -reach], [reach, -reach], [-reach, reach], [reach, reach]]) markDirty(Math.max(0, x + dx), Math.max(0, z + dz))
  return true
}

/** Host edits `[x, y, z, id, ...]` (only for a match world). */
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
