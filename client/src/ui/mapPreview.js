import { ARENA_SIZE, generateArena } from '@shared/maps'
import { B, BLOCKS } from '@shared/voxel'

import { tileColor } from '../game/art/atlas'

/**
 * A duel map's picture for the vote: the arena itself, built from a fixed seed and drawn
 * from above (each column's top block, shaded by height). Made once per map, on first
 * use - no image files to download.
 */

const cache = new Map()

export function mapPreview(mapId) {
  if (cache.has(mapId)) return cache.get(mapId)
  const { world } = generateArena(mapId, 7)
  const S = 4
  const canvas = document.createElement('canvas')
  canvas.width = ARENA_SIZE.x * S
  canvas.height = ARENA_SIZE.z * S
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1b1430'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let x = 0; x < world.sx; x += 1) {
    for (let z = 0; z < world.sz; z += 1) {
      let y = world.sy - 1
      while (y > 0 && world.get(x, y, z) === B.AIR) y -= 1
      const id = world.get(x, y, z)
      if (id === B.AIR) continue
      const def = BLOCKS[id]
      const [r, g, b] = tileColor(def.tex[0] || def.tex[1])
      // Higher is lighter: walls and seats read as walls.
      const k = 0.62 + Math.min(1, Math.max(0, (y - 6) / 18)) * 0.6
      ctx.fillStyle = `rgb(${Math.round(Math.min(1, r * k) * 255)},${Math.round(Math.min(1, g * k) * 255)},${Math.round(Math.min(1, b * k) * 255)})`
      ctx.fillRect(x * S, z * S, S, S)
    }
  }
  const url = canvas.toDataURL()
  cache.set(mapId, url)
  return url
}
