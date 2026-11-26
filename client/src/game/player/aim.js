import { ITEMS, MELEE_REACH, OFFHAND, REACH } from '@shared/balance'
import { ARENA_BUILD_HEIGHT, ARENA_FLOOR } from '@shared/maps'
import { cellOverlapsBody, PLAYER } from '@shared/physics'
import { B, BLOCKS, isWater, raycastVoxels, rayBox } from '@shared/voxel'

import { runtime } from '../runtime'
import { worldState } from '../world'

/** What the crosshair is on, and where a held block would go (the ghost box), bridging included. */

/** The id of what you're holding ('fist' for an empty hand). */
export function heldId() {
  const slot = runtime.me.inv?.[runtime.me.sel]
  return slot ? slot.id : 'fist'
}

/** What's in your left hand ('fist' for nothing). */
export function offId() {
  const slot = runtime.me.inv?.[OFFHAND]
  return slot ? slot.id : 'fist'
}

/** Things right click does something with. */
const USABLE = new Set(['block', 'crystal', 'food', 'potion', 'throw', 'splash', 'bow', 'spear', 'bucket'])

/**
 * What right click uses, like the classic games: the right hand if it holds something
 * usable, else the left hand's item. `{ id, hand: 'main' | 'off' }`.
 */
export function rightClickTarget() {
  const main = heldId()
  if (USABLE.has(ITEMS[main]?.kind)) return { id: main, hand: 'main' }
  const off = offId()
  if (USABLE.has(ITEMS[off]?.kind) && ITEMS[off].kind !== 'bow' && ITEMS[off].kind !== 'spear') return { id: off, hand: 'off' }
  return { id: main, hand: 'main' }
}

export function aim(world, ex, ey, ez, dx, dy, dz, target) {
  const hit = raycastVoxels(world, ex, ey, ez, dx, dy, dz, REACH, (id) => id !== B.AIR)
  let best = hit ? hit.dist : Infinity
  if (hit) {
    target.kind = 'block'
    target.x = hit.x
    target.y = hit.y
    target.z = hit.z
    target.nx = hit.nx
    target.ny = hit.ny
    target.nz = hit.nz
    target.id = hit.id
    target.dist = hit.dist
  }
  const reach = (ITEMS[heldId()]?.reach || MELEE_REACH) + 0.2
  for (const r of runtime.remotes.values()) {
    const t = rayBox(ex, ey, ez, dx, dy, dz, r.x - 0.35, r.y, r.z - 0.35, r.x + 0.35, r.y + PLAYER.height, r.z + 0.35)
    if (t >= 0 && t <= reach && t < best) {
      best = t
      target.kind = 'ent'
      target.eid = r.eid
      target.dist = t
    }
  }
}

/** Can a block go in cell (x, y, z) right now (free, touching a block, not in anyone)? */
function placeable(world, b, x, y, z) {
  if (!world.inBounds(x, y, z) || y < 1 || y >= world.sy - 1) return false
  if (worldState.arena === 'duel' && y > ARENA_FLOOR + ARENA_BUILD_HEIGHT) return false
  const here = world.get(x, y, z)
  if (here !== B.AIR && BLOCKS[here].render !== 'cross' && !isWater(here)) return false
  const touching =
    world.isSolid(x + 1, y, z) || world.isSolid(x - 1, y, z) || world.isSolid(x, y + 1, z) || world.isSolid(x, y - 1, z) || world.isSolid(x, y, z + 1) || world.isSolid(x, y, z - 1)
  if (!touching) return false
  if (cellOverlapsBody(x, y, z, b.x, b.y, b.z, PLAYER.halfW - 0.02, PLAYER.height - 0.02)) return false
  for (const r of runtime.remotes.values()) if (cellOverlapsBody(x, y, z, r.x, r.y, r.z, 0.28, 1.75)) return false
  return true
}

/**
 * Where a block would go if you placed one now (`runtime.place`, also drawn as the
 * white preview box): against the face you're aiming at, as usual - or, when you aim
 * past an edge at nothing (over the void), the free cell in the row under your feet
 * that is closest to where you're looking. That second rule is what makes bridging
 * easy: look ahead and down past the edge, click, walk on, click.
 */
export function findPlacement(world, b, eyeY, dx, dy, dz) {
  const pl = runtime.place
  pl.ok = false
  const kind = ITEMS[rightClickTarget().id]?.kind
  if (kind === 'crystal') {
    // A blast crystal sits on top of obsidian or corestone, nowhere else.
    const t = runtime.target
    if (t.kind !== 'block' || t.ny !== 1 || (t.id !== B.OBSIDIAN && t.id !== B.CORESTONE)) return
    if (!placeable(world, b, t.x, t.y + 1, t.z)) return
    pl.x = t.x
    pl.y = t.y + 1
    pl.z = t.z
    pl.ok = true
    return
  }
  if (kind === 'bucket') {
    // Water pours against the face you aim at - into the cell you stand in, too.
    if (!ITEMS[rightClickTarget().id].fill) return
    const t = runtime.target
    if (t.kind !== 'block') return
    // Aimed at flames (or a plant): the water goes right there - and puts them out.
    const into = BLOCKS[t.id]?.render === 'cross'
    const x = into ? t.x : t.x + t.nx
    const y = into ? t.y : t.y + t.ny
    const z = into ? t.z : t.z + t.nz
    const here = world.get(x, y, z)
    if (here !== B.AIR && BLOCKS[here]?.render !== 'cross') return
    pl.x = x
    pl.y = y
    pl.z = z
    pl.ok = true
    return
  }
  if (kind !== 'block') return
  const t = runtime.target
  const fy = Math.floor(b.y - 0.01) - 1
  if (t.kind === 'ent') return
  if (t.kind === 'block') {
    const x = t.x + t.nx
    const y = t.y + t.ny
    const z = t.z + t.nz
    const ok = placeable(world, b, x, y, z)
    // Aiming at a wall or a block above the floor: the face rule, as always.
    if (t.ny !== 1 || t.y > fy) {
      if (ok) {
        pl.x = x
        pl.y = y
        pl.z = z
        pl.ok = true
      }
      return
    }
    // Aiming down at the floor near an edge: extending the bridge beats stacking a
    // block on the floor in front of you - but stack if there's no edge to extend.
    bridgeRow(world, b, eyeY, dx, dy, dz, fy)
    if (!pl.ok && ok) {
      pl.x = x
      pl.y = y
      pl.z = z
      pl.ok = true
    }
    return
  }
  bridgeRow(world, b, eyeY, dx, dy, dz, fy)
}

/** The free, buildable cell in the row under your feet closest to your aim (see above). */
function bridgeRow(world, b, eyeY, dx, dy, dz, fy) {
  const pl = runtime.place
  const bx = Math.floor(b.x)
  const bz = Math.floor(b.z)
  let best = 0.82
  for (let ox = -3; ox <= 3; ox += 1) {
    for (let oz = -3; oz <= 3; oz += 1) {
      for (const y of [fy, fy + 1]) {
        const x = bx + ox
        const z = bz + oz
        const cx = x + 0.5 - b.x
        const cy = y + 0.5 - eyeY
        const cz = z + 0.5 - b.z
        const d = Math.hypot(cx, cy, cz)
        if (d > REACH + 0.5 || d < 0.01) continue
        const cos = (cx * dx + cy * dy + cz * dz) / d
        // The raised row only counts when it's what you're looking straight at.
        if (cos <= best || (y > fy && cos < 0.95)) continue
        if (!placeable(world, b, x, y, z)) continue
        best = cos
        pl.x = x
        pl.y = y
        pl.z = z
        pl.ok = true
      }
    }
  }
}

/** The water cell you're looking at within reach (for an empty bucket), or null. */
export function findWater(world, b, dx, dy, dz) {
  // Only still water fills a bucket (flowing water runs through it, as in Minecraft).
  const hit = raycastVoxels(world, b.x, b.y + PLAYER.eye, b.z, dx, dy, dz, REACH, (id) => isWater(id) || BLOCKS[id]?.solid)
  return hit && world.get(hit.x, hit.y, hit.z) === B.WATER ? hit : null
}
