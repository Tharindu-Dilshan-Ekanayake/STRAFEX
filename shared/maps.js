import { mulberry32 } from './rng.js'
import { B, VoxelWorld } from './voxel.js'

/**
 * The worlds, built from a seed so the server and every client build the very same
 * blocks: only the map id and seed (plus later edits) ever cross the network.
 *
 * - the lobby: the STRAFEX hub, where you queue for duels or head to Spirelands
 * - duel arenas: small walled 1v1 arenas over the void, one per theme
 * - Spirelands: the free-for-all world of hills, ruins and tall slate spires
 */

// --- Duel arenas ------------------------------------------------------------------------

export const ARENA_SIZE = { x: 48, y: 40, z: 48 }
export const ARENA_CENTER = { x: 24, z: 24 }
/** Top of an arena's floor (you stand at FLOOR + 1). */
export const ARENA_FLOOR = 10
/** How far out the fighting floor goes (the walls start past it). */
export const ARENA_RADIUS = 17
/** Nobody builds higher than this above the floor in a duel. */
export const ARENA_BUILD_HEIGHT = 16

export const DUEL_MAPS = {
  suncourt: { name: 'Suncourt', blurb: 'Sandstone colosseum, tiered seats', sky: ['#3b8cf0', '#9fd2ff', '#fff1d6'] },
  meadow: { name: 'Meadow', blurb: 'Open grass, hedges and hay bales', sky: ['#3b8cf0', '#86ccff', '#cbe9ff'] },
  mirage: { name: 'Mirage', blurb: 'Oasis ruins, pillars for cover', sky: ['#4f9be8', '#ffd9a8', '#fff3de'] },
  bastion: { name: 'Bastion', blurb: 'Castle courtyard, corner towers', sky: ['#4b3fae', '#a98be0', '#ffcfa6'] },
  glade: { name: 'Glade', blurb: 'Forest clearing under the canopy', sky: ['#2f8f73', '#86d6b0', '#e2fff0'] },
  dunes: { name: 'Dunes', blurb: 'Red mesa terraces and cactus', sky: ['#d9733a', '#f2b072', '#ffe6c4'] },
}
export const DUEL_MAP_IDS = Object.keys(DUEL_MAPS)

const fillBox = (world, x0, y0, z0, x1, y1, z1, id) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) world.set(x, y, z, id)
}

/** Ring distance used for arena shapes: a rounded square (feels like a circle, builds neatly). */
const ringDist = (dx, dz) => Math.max(Math.abs(dx), Math.abs(dz)) * 0.55 + Math.hypot(dx, dz) * 0.45

/**
 * Builds a duel arena. Returns `{ world, spawns: [a, b], center }`: two spawn spots
 * (feet) facing each other across the middle.
 */
export function generateArena(mapId, seed) {
  const id = DUEL_MAPS[mapId] ? mapId : 'meadow'
  const rng = mulberry32(seed)
  const world = new VoxelWorld(ARENA_SIZE.x, ARENA_SIZE.y, ARENA_SIZE.z)
  const { x: cx, z: cz } = ARENA_CENTER
  const F = ARENA_FLOOR
  const R = ARENA_RADIUS
  const set = (x, y, z, b) => world.set(x, y, z, b)
  const theme = ARENA_THEMES[id]

  // The floor: a corestone slab with the theme's ground on top, out past the walls.
  for (let x = 0; x < ARENA_SIZE.x; x += 1) {
    for (let z = 0; z < ARENA_SIZE.z; z += 1) {
      const d = ringDist(x - cx, z - cz)
      if (d > R + 5.5) continue
      set(x, F - 4, z, B.CORESTONE)
      for (let y = F - 3; y < F; y += 1) set(x, y, z, theme.fill)
      set(x, F, z, theme.floor(x, z, d, rng))
    }
  }
  theme.build(world, { cx, cz, F, R, rng, set, d: (x, z) => ringDist(x - cx, z - cz) })

  // The spawn spots stay clear.
  const spawns = [
    { x: cx + 0.5, y: F + 1, z: cz + 13.5 },
    { x: cx + 0.5, y: F + 1, z: cz - 12.5 },
  ]
  for (const s of spawns) fillBox(world, Math.floor(s.x) - 1, F + 1, Math.floor(s.z) - 1, Math.floor(s.x) + 1, F + 3, Math.floor(s.z) + 1, B.AIR)
  return { world, spawns, center: { x: cx + 0.5, y: F + 1, z: cz + 0.5 } }
}

/** A wall ring from radius `r0` to `r1`, `h` blocks tall, block from `pick(x, y, z)`. */
function wallRing(world, cx, cz, F, r0, r1, h, pick) {
  for (let x = 0; x < ARENA_SIZE.x; x += 1) {
    for (let z = 0; z < ARENA_SIZE.z; z += 1) {
      const d = ringDist(x - cx, z - cz)
      if (d < r0 || d > r1) continue
      const top = typeof h === 'function' ? h(d, x, z) : h
      for (let y = F + 1; y <= F + top; y += 1) world.set(x, y, z, pick(x, y, z, d))
    }
  }
}

function arenaTree(world, x, y, z, rng, crown = B.LEAVES, h = 4) {
  const height = h + Math.floor(rng() * 2)
  for (let i = 0; i < height; i += 1) world.set(x, y + i, z, B.LOG)
  const top = y + height - 1
  for (let dy = -1; dy <= 2; dy += 1) {
    const r = dy >= 1 ? 1 : 2
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 2 || rng() < 0.5)) continue
        if (dx === 0 && dz === 0 && dy < 1) continue
        if (world.get(x + dx, top + dy, z + dz) === B.AIR) world.set(x + dx, top + dy, z + dz, crown)
      }
    }
  }
}

const ARENA_THEMES = {
  suncourt: {
    fill: B.SANDSTONE,
    floor: (x, z, d) => {
      const ring = Math.floor(d)
      if (ring === 6 || ring === 12) return B.CLAY_RED
      if (ring === 7 || ring === 13) return B.CLAY_ORANGE
      return (x + z) % 7 === 0 ? B.SAND : B.SANDSTONE
    },
    build(world, { cx, cz, F, R, set }) {
      // Tiered seats rising outward, striped like the floor, a parapet on top.
      wallRing(world, cx, cz, F, R + 0.5, R + 6, (d) => Math.min(12, 1 + Math.floor((d - R - 0.5) * 2)), (x, y) => (y % 3 === 0 ? B.CLAY_ORANGE : y % 3 === 1 ? B.SANDSTONE : B.QUARTZ))
      // Banners and lamps round the rim.
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2
        const x = Math.round(cx + Math.cos(a) * (R + 1.6))
        const z = Math.round(cz + Math.sin(a) * (R + 1.6))
        if (i % 2) {
          for (let y = F + 5; y <= F + 7; y += 1) set(x, y, z, B.CLAY_RED)
        } else set(x, F + 4, z, B.LAMP)
      }
      // Four quartz columns for cover.
      for (const [dx, dz] of [[-7, -2], [7, -2], [-7, 3], [7, 3]]) fillBox(world, cx + dx, F + 1, cz + dz, cx + dx, F + 4, cz + dz, B.QUARTZ)
    },
  },
  meadow: {
    fill: B.DIRT,
    floor: (x, z, d) => (d > 15.5 ? B.PATH : B.GRASS),
    build(world, { cx, cz, F, R, rng, set }) {
      wallRing(world, cx, cz, F, R + 0.5, R + 2, 4, () => B.LEAVES)
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2 + 0.3
        arenaTree(world, Math.round(cx + Math.cos(a) * (R + 4)), F + 1, Math.round(cz + Math.sin(a) * (R + 4)), rng, B.LEAVES, 5)
      }
      // Hay bales (planks) in little stacks, flowers and grass.
      for (const [dx, dz] of [[-6, 0], [6, 0], [-3, -6], [3, 7]]) {
        fillBox(world, cx + dx, F + 1, cz + dz, cx + dx + 1, F + 1, cz + dz, B.PLANKS)
        set(cx + dx, F + 2, cz + dz, B.PLANKS)
      }
      for (let x = cx - R; x <= cx + R; x += 1) {
        for (let z = cz - R; z <= cz + R; z += 1) {
          if (world.get(x, F, z) === B.GRASS && world.get(x, F + 1, z) === B.AIR && rng() < 0.08) set(x, F + 1, z, [B.FLOWER_RED, B.FLOWER_YELLOW, B.TALL_GRASS, B.TALL_GRASS][Math.floor(rng() * 4)])
        }
      }
    },
  },
  mirage: {
    fill: B.SAND,
    floor: (x, z, d) => (d < 2.6 ? B.WATER : d < 3.6 ? B.SANDSTONE : B.SAND),
    build(world, { cx, cz, F, R, rng, set }) {
      // A pool in the middle (shallow: corestone a block down).
      for (let x = cx - 3; x <= cx + 3; x += 1) for (let z = cz - 3; z <= cz + 3; z += 1) if (world.get(x, F, z) === B.WATER) set(x, F - 1, z, B.SANDSTONE)
      wallRing(world, cx, cz, F, R + 0.5, R + 3, (d, x, z) => 5 + ((x * 3 + z * 7) % 4), (x, y) => (y % 4 === 0 ? B.QUARTZ : B.SANDSTONE))
      // Broken pillars of different heights.
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + 0.4
        const x = Math.round(cx + Math.cos(a) * 9)
        const z = Math.round(cz + Math.sin(a) * 9)
        const h = 2 + Math.floor(rng() * 4)
        fillBox(world, x, F + 1, z, x, F + h, z, B.QUARTZ)
        if (h > 3) set(x, F + h + 1, z, B.GOLD)
      }
      for (const [dx, dz] of [[-12, -8], [12, 8], [10, -11]]) {
        for (let y = 1; y <= 3; y += 1) set(cx + dx, F + y, cz + dz, B.CACTUS)
      }
    },
  },
  bastion: {
    fill: B.STONE,
    floor: (x, z) => ((Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? B.STONE_BRICKS : B.DARKSTONE),
    build(world, { cx, cz, F, R, set }) {
      wallRing(world, cx, cz, F, R + 0.5, R + 2.5, 9, (x, y, z) => ((x + y + z) % 6 === 0 ? B.DARKSTONE : B.STONE_BRICKS))
      // Battlements.
      for (let x = 0; x < ARENA_SIZE.x; x += 1) {
        for (let z = 0; z < ARENA_SIZE.z; z += 1) {
          const d = ringDist(x - cx, z - cz)
          if (d > R + 1.8 && d < R + 2.6 && (x + z) % 2 === 0) set(x, F + 10, z, B.STONE_BRICKS)
        }
      }
      // Corner towers with blue caps, lamps along the wall.
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = cx + dx * 14
        const tz = cz + dz * 14
        fillBox(world, tx - 1, F + 1, tz - 1, tx + 1, F + 12, tz + 1, B.STONE_BRICKS)
        fillBox(world, tx - 1, F + 13, tz - 1, tx + 1, F + 13, tz + 1, B.WOOL_BLUE)
        set(tx, F + 14, tz, B.WOOL_BLUE)
      }
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2
        set(Math.round(cx + Math.cos(a) * (R + 0.4)), F + 4, Math.round(cz + Math.sin(a) * (R + 0.4)), B.LAMP)
      }
      // A low wall across the middle with gaps.
      for (let x = cx - 8; x <= cx + 8; x += 1) if (Math.abs(x - cx) > 2 && Math.abs(x - cx) !== 6) fillBox(world, x, F + 1, cz, x, F + 2, cz, B.STONE_BRICKS)
    },
  },
  glade: {
    fill: B.DIRT,
    floor: (x, z, d, rng) => (rng() < 0.12 ? B.MOSSY_BRICKS : d > 14 ? B.PATH : B.GRASS),
    build(world, { cx, cz, F, R, rng, set }) {
      wallRing(world, cx, cz, F, R + 0.5, R + 2, 5, (x, y) => (y > F + 3 ? B.LEAVES : B.MOSSY_BRICKS))
      // Tall trees round the edge, their crowns reaching in over the floor.
      for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * Math.PI * 2
        arenaTree(world, Math.round(cx + Math.cos(a) * (R - 0.5)), F + 1, Math.round(cz + Math.sin(a) * (R - 0.5)), rng, B.LEAVES, 6)
      }
      // Ruined arches of mossy bricks.
      for (const [dx, dz, along] of [[-7, -4, 'x'], [6, 5, 'z']]) {
        for (let k = 0; k < 4; k += 1) {
          const x = cx + dx + (along === 'x' ? k : 0)
          const z = cz + dz + (along === 'z' ? k : 0)
          if (k === 0 || k === 3) fillBox(world, x, F + 1, z, x, F + 3, z, B.MOSSY_BRICKS)
          set(x, F + 4, z, B.MOSSY_BRICKS)
        }
      }
      for (let x = cx - R; x <= cx + R; x += 1) {
        for (let z = cz - R; z <= cz + R; z += 1) {
          if (world.get(x, F, z) === B.GRASS && world.get(x, F + 1, z) === B.AIR && rng() < 0.12) set(x, F + 1, z, rng() < 0.7 ? B.TALL_GRASS : B.FLOWER_RED)
        }
      }
    },
  },
  dunes: {
    fill: B.CLAY_ORANGE,
    floor: (x, z, d) => ((Math.floor(d) % 5 === 0 ? B.CLAY_RED : (x * 7 + z * 3) % 11 === 0 ? B.SAND : B.CLAY_ORANGE)),
    build(world, { cx, cz, F, R, rng, set }) {
      // Mesa walls in bands of red and orange.
      wallRing(world, cx, cz, F, R + 0.5, R + 4, (d, x, z) => 6 + Math.floor(Math.abs(Math.sin(x * 0.4) + Math.cos(z * 0.3)) * 3), (x, y) => (y % 3 === 0 ? B.CLAY_RED : y % 3 === 1 ? B.CLAY_ORANGE : B.SANDSTONE))
      // Two low terraces to fight over.
      fillBox(world, cx - 9, F + 1, cz - 3, cx - 5, F + 1, cz + 3, B.CLAY_RED)
      fillBox(world, cx + 5, F + 1, cz - 3, cx + 9, F + 1, cz + 3, B.CLAY_RED)
      fillBox(world, cx - 8, F + 2, cz - 1, cx - 6, F + 2, cz + 1, B.CLAY_ORANGE)
      fillBox(world, cx + 6, F + 2, cz - 1, cx + 8, F + 2, cz + 1, B.CLAY_ORANGE)
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + 0.5
        const x = Math.round(cx + Math.cos(a) * 13)
        const z = Math.round(cz + Math.sin(a) * 13)
        const h = 2 + Math.floor(rng() * 2)
        for (let y = 1; y <= h; y += 1) set(x, F + y, z, B.CACTUS)
      }
    },
  },
}

// --- Spirelands (free for all) ------------------------------------------------------------

export const FFA_SIZE = { x: 256, y: 64, z: 256 }
/** Spirelands' sea level: the water's top is one above. */
export const FFA_SEA = 11
/** About how far the island reaches from the middle before the sea. */
const ISLAND_R = 96
/** Decoration counts were set for an island of radius 70: scaled to its area (or coast). */
const AREA = (ISLAND_R / 70) ** 2
const COAST = ISLAND_R / 70
export const FFA_SEED = 20261126
/** Spirelands' sky. */
export const FFA_SKY = ['#3d8ff0', '#8fd0ff', '#d8f0ff']

/** Smooth value noise in [0, 1] from a seed. */
function valueNoise(seed, scale) {
  const hash = (x, z) => {
    let h = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
  }
  const smooth = (t) => t * t * (3 - 2 * t)
  return (x, z) => {
    const fx = x / scale
    const fz = z / scale
    const x0 = Math.floor(fx)
    const z0 = Math.floor(fz)
    const tx = smooth(fx - x0)
    const tz = smooth(fz - z0)
    const a = hash(x0, z0) + (hash(x0 + 1, z0) - hash(x0, z0)) * tx
    const b = hash(x0, z0 + 1) + (hash(x0 + 1, z0 + 1) - hash(x0, z0 + 1)) * tx
    return a + (b - a) * tz
  }
}

/**
 * Builds Spirelands: an island in the open sea. Sandy beaches with palms, a pier, a
 * shipwreck, a lighthouse and little islets round the coast; inland, rolling grass hills
 * with the ruined Spire Keep on its plateau in the middle (jump pads up its towers), a
 * river winding out to the sea, slate spires with balconies and plank bridges between
 * them, a village, ruins, ponds, trees, giant mushrooms, boulders, flowers and jump
 * pads. The world's sides are walls nobody can pass (VoxelWorld.sealed); the sea goes on
 * past them as a plane to the horizon (Environment.jsx).
 * @returns {{ world: VoxelWorld, spawns: {x,y,z}[], center: {x,y,z} }}
 */
export function generateSpirelands(seed = FFA_SEED) {
  const rng = mulberry32(seed)
  const { x: SX, y: SY, z: SZ } = FFA_SIZE
  const world = new VoxelWorld(SX, SY, SZ)
  world.sealed = true
  world.seaLevel = FFA_SEA
  const n1 = valueNoise(seed, 26)
  const n2 = valueNoise(seed + 7, 9)
  const coastNoise = ringNoise(mulberry32(seed + 3))
  const heights = new Int16Array(SX * SZ)
  const SEA = FFA_SEA
  const CX = SX / 2
  const CZ = SZ / 2
  const KEEP_R = 13
  // The river: from the hills west of the Keep, winding out to the west coast.
  const riverAt = (x) => CZ + 18 + Math.sin(x * 0.11) * 7 + Math.sin(x * 0.05 + 1) * 4
  const RIVER_FROM = CX - 22
  /** How far inland (x, z) is: negative out at sea, 0 on the coastline. */
  const inland = (x, z) => {
    const d = Math.hypot(x - CX, z - CZ)
    return ISLAND_R * (0.88 + 0.2 * coastNoise(Math.atan2(z - CZ, x - CX))) - d
  }
  for (let x = 0; x < SX; x += 1) {
    for (let z = 0; z < SZ; z += 1) {
      const land = inland(x, z)
      let h
      if (land < 0) {
        // The sea floor shelves away from the shore in a few smooth steps (flat floors
        // merge into big quads; every step is a ring of faces).
        h = SEA - 1 - Math.min(4, Math.floor(-land / 3))
      } else if (land < 7) {
        // Beach: a block or two of sand above the water.
        h = SEA + 1 + (land > 4 ? 1 : 0)
      } else {
        const hills = 17 + Math.round((n1(x, z) - 0.5) * 12 + (n2(x, z) - 0.5) * 1.2)
        const t = Math.min(1, (land - 7) / 14)
        h = Math.round(SEA + 2 + (hills - SEA - 2) * t)
      }
      // The Keep's hill is flattened into a plateau.
      const dk = Math.hypot(x - CX, z - CZ)
      if (dk < KEEP_R + 6) h = Math.round(h + (20 - h) * Math.min(1, (KEEP_R + 6 - dk) / 6))
      // The river valley: water at sea level, banks sloping down to it.
      if (x < RIVER_FROM && land > -2) {
        const off = Math.abs(z - riverAt(x))
        if (off < 8) h = Math.min(h, off < 2 ? SEA - 1 : SEA + Math.round(off - 1.5))
      }
      h = Math.max(3, Math.min(SY - 6, h))
      heights[x + z * SX] = h
      world.set(x, 0, z, B.CORESTONE)
      world.set(x, 1, z, B.CORESTONE)
      const sandy = land < 9 || h <= SEA + 1
      for (let y = 2; y <= h; y += 1) {
        const fromTop = h - y
        let id = B.STONE
        if (sandy) id = fromTop < 3 ? B.SAND : fromTop < 5 ? B.SANDSTONE : B.STONE
        else if (fromTop === 0) id = B.GRASS
        else if (fromTop < 3) id = B.DIRT
        else if (rng() < 0.05) id = B.ORE
        world.set(x, y, z, id)
      }
      for (let y = h + 1; y <= SEA; y += 1) world.set(x, y, z, B.WATER)
    }
  }
  const top = (x, z) => heights[Math.max(0, Math.min(SX - 1, x)) + Math.max(0, Math.min(SZ - 1, z)) * SX]
  const setTop = (x, z, h) => {
    heights[x + z * SX] = h
  }
  /** Solid grass ground, far enough from the shore. */
  const onLand = (x, z, margin = 10) => inland(x, z) > margin && top(x, z) > SEA + 1
  const fill = (x0, y0, z0, x1, y1, z1, id) => fillBox(world, Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), id)
  /** Things built so far: [x, z, radius] (decorations and spawns keep clear). */
  const built = []
  const clear = (x, z, pad = 0) => !built.some(([bx, bz, r]) => Math.hypot(bx - x, bz - z) < r + pad)
  const randomLand = (margin) => {
    for (let k = 0; k < 40; k += 1) {
      const x = 8 + Math.floor(rng() * (SX - 16))
      const z = 8 + Math.floor(rng() * (SZ - 16))
      if (onLand(x, z, margin)) return [x, z]
    }
    return null
  }
  const palm = (x, z) => {
    const g = top(x, z)
    const h = 5 + Math.floor(rng() * 3)
    const lean = rng() < 0.5 ? 1 : -1
    let px = x
    for (let i = 1; i <= h; i += 1) {
      if (i === 4) px += lean
      world.set(px, g + i, z, B.LOG)
    }
    const ty = g + h + 1
    world.set(px, ty, z, B.LEAVES)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const reach = dx && dz ? 2 : 3
      for (let r = 1; r <= reach; r += 1) {
        const y = r === reach ? ty - 1 : ty
        if (world.get(px + dx * r, y, z + dz * r) === B.AIR) world.set(px + dx * r, y, z + dz * r, B.LEAVES)
      }
    }
  }
  built.push([CX, CZ, KEEP_R + 3])

  // --- The coast: palms along the beach, a pier, a shipwreck, a lighthouse, islets -------
  for (let k = 0; k < Math.round(36 * COAST); k += 1) {
    const a = rng() * Math.PI * 2
    for (let r = ISLAND_R * 1.15; r > ISLAND_R * 0.6; r -= 1) {
      const x = Math.round(CX + Math.cos(a) * r)
      const z = Math.round(CZ + Math.sin(a) * r)
      const land = inland(x, z)
      if (land > 1.5 && land < 6 && world.get(x, top(x, z), z) === B.SAND && world.get(x, top(x, z) + 1, z) === B.AIR) {
        palm(x, z)
        built.push([x, z, 2])
        break
      }
    }
  }
  {
    // The pier: south, out over the water on log posts, a lantern at the end.
    let z = CZ
    while (z < SZ - 1 && inland(CX, z) > 2) z += 1
    const y = SEA + 2
    for (let k = -4; k < 16 && z + k < SZ - 2; k += 1) {
      fill(CX - 1, y, z + k, CX + 1, y, z + k, B.PLANKS)
      if (k % 4 === 0 && k > 0) {
        for (const dx of [-2, 2]) for (let yy = top(CX + dx, z + k) + 1; yy <= y; yy += 1) world.set(CX + dx, yy, z + k, B.LOG)
      }
    }
    world.set(CX - 2, y + 1, Math.min(SZ - 3, z + 15), B.LANTERN)
    world.set(CX + 2, y + 1, Math.min(SZ - 3, z + 15), B.LANTERN)
    built.push([CX, z + 4, 4])
  }
  {
    // A shipwreck half sunk off the east coast: a broken hull and a snapped mast.
    const wx = Math.min(SX - 16, Math.round(CX + ISLAND_R * 1.1))
    const wz = CZ - 14
    for (let i = 0; i < 12; i += 1) {
      const w = i < 2 || i > 9 ? 1 : 2
      const y = SEA - 1 + (i > 6 ? 1 : 0)
      for (let dz = -w; dz <= w; dz += 1) {
        world.set(wx + i, y - 1, wz + dz, B.PLANKS)
        if (Math.abs(dz) === w) for (let yy = y; yy <= y + 1 + (i % 3 === 0 ? 1 : 0); yy += 1) world.set(wx + i, yy, wz + dz, B.PLANKS)
      }
    }
    fill(wx + 5, SEA, wz, wx + 5, SEA + 6, wz, B.LOG)
    fill(wx + 5, SEA + 4, wz - 2, wx + 5, SEA + 5, wz + 1, B.WOOL_WHITE)
    world.set(wx + 7, SEA + 1, wz, B.GOLD)
  }
  {
    // A lighthouse on the north-west point.
    const a = Math.PI * 1.25
    let lx = Math.round(CX + Math.cos(a) * ISLAND_R * 0.85)
    let lz = Math.round(CZ + Math.sin(a) * ISLAND_R * 0.85)
    for (let k = 0; k < 20 && inland(lx, lz) < 3; k += 1) {
      lx += Math.sign(CX - lx)
      lz += Math.sign(CZ - lz)
    }
    const g = top(lx, lz)
    fill(lx - 2, g, lz - 2, lx + 2, g, lz + 2, B.STONE_BRICKS)
    for (let y = 1; y <= 14; y += 1) {
      for (let x = lx - 1; x <= lx + 1; x += 1) for (let z = lz - 1; z <= lz + 1; z += 1) world.set(x, g + y, z, Math.floor(y / 2) % 2 ? B.WOOL_WHITE : B.WOOL_RED)
    }
    fill(lx - 2, g + 15, lz - 2, lx + 2, g + 15, lz + 2, B.PLANKS)
    world.set(lx, g + 16, lz, B.LANTERN)
    fill(lx - 1, g + 17, lz - 1, lx + 1, g + 17, lz + 1, B.WOOL_RED)
    // A jump pad at its foot up to the balcony.
    world.set(lx + 3, top(lx + 3, lz), lz, B.JUMP_PAD)
    built.push([lx, lz, 5])
  }
  // Little islets out at sea, each with a palm (swim there, or build a bridge).
  for (const [a, r] of [[0.4, 1.22], [2.3, 1.25], [3.9, 1.2], [5.4, 1.24]]) {
    const ix = Math.round(CX + Math.cos(a) * ISLAND_R * r)
    const iz = Math.round(CZ + Math.sin(a) * ISLAND_R * r)
    if (ix < 10 || iz < 10 || ix > SX - 10 || iz > SZ - 10) continue
    for (let x = ix - 5; x <= ix + 5; x += 1) {
      for (let z = iz - 5; z <= iz + 5; z += 1) {
        const d = Math.hypot(x - ix, z - iz)
        if (d > 4.5) continue
        const h = d < 2.5 ? SEA + 2 : SEA + 1
        for (let y = top(x, z) + 1; y <= h; y += 1) world.set(x, y, z, d < 2.5 && y === h ? B.GRASS : B.SAND)
        setTop(x, z, h)
      }
    }
    palm(ix + 1, iz)
    world.set(ix - 1, top(ix - 1, iz + 1) + 1, iz + 1, B.LANTERN)
  }

  // --- The Spire Keep: a ruined castle on the central plateau ----------------------------
  const ky = 20
  const half = 9
  for (let x = CX - half; x <= CX + half; x += 1) {
    for (let z = CZ - half; z <= CZ + half; z += 1) {
      const edge = Math.abs(x - CX) === half || Math.abs(z - CZ) === half
      world.set(x, ky, z, (x + z) % 4 === 0 ? B.MOSSY_BRICKS : B.STONE_BRICKS)
      if (!edge) continue
      const gate = Math.abs(x - CX) <= 1 || Math.abs(z - CZ) <= 1
      if (gate) continue
      // Ruined: the wall's height wanders, battlements on the tall parts.
      const h = 3 + Math.round(n2(x * 3, z * 3) * 3)
      for (let y = 1; y <= h; y += 1) world.set(x, ky + y, z, rng() < 0.25 ? B.MOSSY_BRICKS : B.STONE_BRICKS)
      if (h >= 5 && (x + z) % 2 === 0) world.set(x, ky + h + 1, z, B.STONE_BRICKS)
    }
  }
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = CX + ox * half
    const tz = CZ + oz * half
    fill(tx - 1, ky + 1, tz - 1, tx + 1, ky + 11, tz + 1, B.STONE_BRICKS)
    fill(tx - 2, ky + 12, tz - 2, tx + 2, ky + 12, tz + 2, B.PLANKS)
    for (const [bx, bz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) set3(world, tx + bx, ky + 13, tz + bz, B.LANTERN)
    // A jump pad at each tower's foot, inside, up onto its top.
    world.set(tx - ox * 3, ky, tz - oz * 3, B.JUMP_PAD)
    fill(tx - ox * 3, ky + 8, tz - oz * 3, tx - ox * 2, ky + 8, tz - oz * 2, B.PLANKS)
  }
  // The courtyard: a well in the middle, banners on the gates.
  fill(CX - 1, ky + 1, CZ - 1, CX + 1, ky + 1, CZ + 1, B.STONE_BRICKS)
  world.set(CX, ky + 1, CZ, B.WATER)
  for (const [bx, bz] of [[-1, -1], [1, 1]]) fill(CX + bx, ky + 2, CZ + bz, CX + bx, ky + 3, CZ + bz, B.LOG)
  fill(CX - 1, ky + 4, CZ - 1, CX + 1, ky + 4, CZ + 1, B.PLANKS)
  for (const [gx, gz, c] of [[0, -half, B.WOOL_RED], [0, half, B.WOOL_BLUE], [-half, 0, B.WOOL_YELLOW], [half, 0, B.WOOL_WHITE]]) {
    world.set(CX + gx + (gz ? -2 : 0), ky + 4, CZ + gz + (gx ? -2 : 0), c)
    world.set(CX + gx + (gz ? 2 : 0), ky + 4, CZ + gz + (gx ? 2 : 0), c)
  }

  // --- Ponds in the inland hollows ------------------------------------------------------------
  for (let k = 0; k < 4; k += 1) {
    const spot = randomLand(20)
    if (!spot) continue
    const [px, pz] = spot
    if (!clear(px, pz, 6)) continue
    const level = top(px, pz)
    for (let x = px - 5; x <= px + 5; x += 1) {
      for (let z = pz - 5; z <= pz + 5; z += 1) {
        if (Math.hypot(x - px, z - pz) > 4.6 - rng() * 0.8) continue
        if (top(x, z) > level + 1) continue
        world.set(x, level, z, B.WATER)
        world.set(x, level - 1, z, B.SAND)
      }
    }
    built.push([px, pz, 6])
  }

  // --- Slate spires: tall tapering columns, a balcony and a jump pad on many --------------
  const spires = []
  for (let k = 0; k < Math.round(18 * AREA); k += 1) {
    const spot = randomLand(16)
    if (!spot) continue
    const [sx, sz] = spot
    if (spires.some((s) => Math.hypot(s.x - sx, s.z - sz) < 15) || !clear(sx, sz, 4)) continue
    const height = 16 + Math.floor(rng() * 20)
    const r0 = 2.2 + rng() * 1.8
    const lean = (rng() - 0.5) * 0.25
    const base = top(sx, sz) - 2
    for (let y = 0; y < height; y += 1) {
      const r = r0 * (1 - (y / height) * 0.75)
      const ox = sx + lean * y
      for (let x = Math.floor(ox - r) - 1; x <= Math.ceil(ox + r) + 1; x += 1) {
        for (let z = Math.floor(sz - r) - 1; z <= Math.ceil(sz + r) + 1; z += 1) {
          if (Math.hypot(x + 0.5 - ox, z + 0.5 - sz) > r + (rng() - 0.5) * 0.6) continue
          world.set(x, base + y, z, (y + x * 2 + z) % 9 === 0 ? B.STONE : y > height - 3 ? B.QUARTZ : B.SLATE)
        }
      }
    }
    const spire = { x: sx, z: sz, r: r0 + 2, base, height }
    // A wooden balcony half-way up, reached from a jump pad at the foot.
    if (height > 20) {
      const by = base + 10
      const bx = Math.round(sx + lean * 10)
      for (let x = bx - Math.ceil(r0) - 2; x <= bx + Math.ceil(r0) + 2; x += 1) {
        for (let z = sz - Math.ceil(r0) - 2; z <= sz + Math.ceil(r0) + 2; z += 1) {
          if (world.get(x, by, z) === B.AIR && Math.hypot(x - bx, z - sz) < r0 + 2.6) world.set(x, by, z, B.PLANKS)
        }
      }
      const padX = bx + Math.ceil(r0) + 3
      const g = top(padX, sz)
      world.set(padX, g, sz, B.JUMP_PAD)
      world.set(padX, by + 1, sz + 2, B.LANTERN)
      spire.balcony = by
    }
    spires.push(spire)
    built.push([sx, sz, spire.r])
  }
  // Rope bridges (planks) between near spires whose balconies line up.
  for (let i = 0; i < spires.length; i += 1) {
    for (let j = i + 1; j < spires.length; j += 1) {
      const a = spires[i]
      const b = spires[j]
      if (!a.balcony || !b.balcony || Math.hypot(a.x - b.x, a.z - b.z) > 28) continue
      const y = Math.max(a.balcony, b.balcony)
      const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z))
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        const x = Math.round(a.x + (b.x - a.x) * t)
        const z = Math.round(a.z + (b.z - a.z) * t)
        // Sags a little in the middle.
        const sag = Math.round(Math.sin(t * Math.PI) * 1.2)
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) if (world.get(x + dx, y - sag, z + dz) === B.AIR) world.set(x + dx, y - sag, z + dz, B.PLANKS)
      }
    }
  }

  // --- A village: little houses, a well, hay and lanterns --------------------------------
  const villageX = Math.round(CX + 30)
  const villageZ = Math.round(CZ - 30)
  const house = (hx, hz, w, d) => {
    const g = top(hx, hz)
    for (let x = hx - 1; x <= hx + w; x += 1) for (let z = hz - 1; z <= hz + d; z += 1) {
      for (let y = top(x, z) + 1; y <= g; y += 1) world.set(x, y, z, B.DIRT)
      world.set(x, g, z, B.PATH)
      for (let y = g + 1; y <= g + 8; y += 1) world.set(x, y, z, B.AIR)
      setTop(x, z, g)
    }
    for (let x = hx; x < hx + w; x += 1) {
      for (let z = hz; z < hz + d; z += 1) {
        const edgeX = x === hx || x === hx + w - 1
        const edgeZ = z === hz || z === hz + d - 1
        world.set(x, g, z, B.PLANKS)
        if (!edgeX && !edgeZ) continue
        for (let y = 1; y <= 3; y += 1) {
          const corner = edgeX && edgeZ
          const door = z === hz && x === hx + Math.floor(w / 2) && y < 3
          const window = !corner && y === 2 && (x + z) % 3 === 0
          if (door) continue
          world.set(x, g + y, z, corner ? B.LOG : window ? B.GLASS : B.PLANKS)
        }
      }
    }
    // A stepped brick roof.
    for (let s = 0; s <= Math.ceil(d / 2); s += 1) {
      for (let x = hx - 1; x <= hx + w; x += 1) {
        world.set(x, g + 4 + s, hz - 1 + s, B.BRICK)
        world.set(x, g + 4 + s, hz + d - s, B.BRICK)
      }
    }
    for (let x = hx; x < hx + w; x += 1) for (let z = hz + 1; z < hz + d - 1; z += 1) if (world.get(x, g + 4, z) === B.AIR) world.set(x, g + 4, z, B.PLANKS)
    world.set(hx - 1, g + 1, hz - 1, B.LANTERN)
    built.push([hx + w / 2, hz + d / 2, Math.max(w, d) / 2 + 2])
  }
  if (clear(villageX, villageZ, 10)) {
    for (const [ox, oz, w, d] of [[-10, -8, 6, 5], [2, -10, 5, 5], [-9, 3, 5, 6], [4, 4, 6, 5], [-2, 12, 5, 4]]) {
      const hx = villageX + ox
      const hz = villageZ + oz
      if (onLand(hx, hz, 8) && onLand(hx + w, hz + d, 8) && clear(hx + w / 2, hz + d / 2, 1)) house(hx, hz, w, d)
    }
    const g = top(villageX, villageZ)
    fill(villageX - 1, g + 1, villageZ - 1, villageX + 1, g + 1, villageZ + 1, B.STONE_BRICKS)
    world.set(villageX, g + 1, villageZ, B.WATER)
    for (let k = 0; k < 5; k += 1) {
      const x = villageX + Math.floor(rng() * 16) - 8
      const z = villageZ + Math.floor(rng() * 16) - 8
      if (world.get(x, top(x, z) + 1, z) === B.AIR) world.set(x, top(x, z) + 1, z, B.HAY)
    }
    built.push([villageX, villageZ, 4])
  }

  // --- Ruins: broken stone-brick walls and arches ------------------------------------------
  for (let k = 0; k < Math.round(11 * AREA); k += 1) {
    const spot = randomLand(14)
    if (!spot) continue
    const [rx, rz] = spot
    if (!clear(rx, rz, 6)) continue
    const along = rng() < 0.5
    const len = 5 + Math.floor(rng() * 6)
    for (let i = 0; i < len; i += 1) {
      const x = rx + (along ? i : 0)
      const z = rz + (along ? 0 : i)
      const h = 1 + Math.floor(rng() * 4)
      const g = top(x, z)
      for (let y = 1; y <= h; y += 1) world.set(x, g + y, z, rng() < 0.35 ? B.MOSSY_BRICKS : B.STONE_BRICKS)
    }
    if (rng() < 0.6) {
      const ax = rx + (along ? 0 : 4)
      const az = rz + (along ? 4 : 0)
      const g = top(ax, az)
      for (let y = 1; y <= 5; y += 1) {
        world.set(ax, g + y, az, B.STONE_BRICKS)
        world.set(ax + (along ? 0 : 4), g + y, az + (along ? 4 : 0), B.STONE_BRICKS)
      }
      for (let i = 0; i <= 4; i += 1) world.set(ax + (along ? 0 : i), g + 6, az + (along ? i : 0), B.MOSSY_BRICKS)
    }
    built.push([rx + (along ? len / 2 : 0), rz + (along ? 0 : len / 2), len / 2 + 1])
  }

  // --- Trees, giant mushrooms, boulders, jump pads, flowers --------------------------------
  let pads = 0
  for (let k = 0; k < Math.round(170 * AREA); k += 1) {
    const x = 12 + Math.floor(rng() * (SX - 24))
    const z = 12 + Math.floor(rng() * (SZ - 24))
    const g = top(x, z)
    if (world.get(x, g, z) !== B.GRASS || world.get(x, g + 1, z) !== B.AIR || !clear(x, z, 2)) continue
    const r = rng()
    if (r < 0.42) arenaTree(world, x, g + 1, z, rng, B.LEAVES, 4)
    else if (r < 0.52) {
      const h = 3 + Math.floor(rng() * 3)
      fill(x, g + 1, z, x, g + h, z, B.QUARTZ)
      fill(x - 1, g + h + 1, z - 1, x + 1, g + h + 1, z + 1, B.MUSHROOM)
      world.set(x, g + h + 2, z, B.MUSHROOM)
    } else if (r < 0.62) {
      fill(x, g + 1, z, x + 1, g + 1, z + 1, B.STONE)
      world.set(x, g + 2, z, B.MOSSY_BRICKS)
    } else if (r < 0.72 && pads < 12) {
      world.set(x, g, z, B.JUMP_PAD)
      pads += 1
    } else continue
    built.push([x, z, 2])
  }
  for (let x = 10; x < SX - 10; x += 1) {
    for (let z = 10; z < SZ - 10; z += 1) {
      const g = top(x, z)
      if (world.get(x, g, z) !== B.GRASS || world.get(x, g + 1, z) !== B.AIR) continue
      // Flowers grow in patches.
      const patch = n2(x * 1.7 + 50, z * 1.7) > 0.72
      const r = rng()
      if (r < 0.0045) world.set(x, g + 1, z, B.BERRY_BUSH)
      else if (r < 0.05) world.set(x, g + 1, z, B.TALL_GRASS)
      else if (patch && r < 0.3) world.set(x, g + 1, z, (x + z) % 2 ? B.FLOWER_RED : B.FLOWER_YELLOW)
      else if (r < 0.058) world.set(x, g + 1, z, rng() < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW)
    }
  }

  // Spawn spots: open grass, away from everything built and each other.
  const spawns = []
  for (let tries = 0; tries < 3000 && spawns.length < 36; tries += 1) {
    const x = 16 + Math.floor(rng() * (SX - 32))
    const z = 16 + Math.floor(rng() * (SZ - 32))
    const g = world.surface(x, z)
    if (g < 0 || world.get(x, g, z) !== B.GRASS || !onLand(x, z, 8)) continue
    if (world.get(x, g + 1, z) !== B.AIR || world.get(x, g + 2, z) !== B.AIR) continue
    if (!clear(x, z, 2) || spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 11)) continue
    spawns.push({ x: x + 0.5, y: g + 1, z: z + 0.5 })
  }
  if (!spawns.length) spawns.push({ x: CX + 0.5, y: 21, z: CZ + 4.5 })

  // Loot chests: on open ground all over the island (and the islets), spaced apart.
  const chests = []
  for (let tries = 0; tries < 4000 && chests.length < Math.round(30 * AREA); tries += 1) {
    const x = 12 + Math.floor(rng() * (SX - 24))
    const z = 12 + Math.floor(rng() * (SZ - 24))
    const g = world.surface(x, z)
    const ground = world.get(x, g, z)
    if (g < 0 || (ground !== B.GRASS && ground !== B.SAND && ground !== B.STONE_BRICKS && ground !== B.MOSSY_BRICKS)) continue
    if (g + 1 <= SEA || world.get(x, g + 1, z) !== B.AIR || world.get(x, g + 2, z) !== B.AIR) continue
    if (chests.some((c) => Math.hypot(c.x - x, c.z - z) < 13) || spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) continue
    world.set(x, g + 1, z, B.LOOT_CHEST)
    chests.push({ x, y: g + 1, z })
  }
  return { world, spawns, chests, center: { x: CX + 0.5, y: 21, z: CZ + 4.5 } }
}

function set3(world, x, y, z, id) {
  if (world.get(x, y, z) === B.AIR) world.set(x, y, z, id)
}

// --- The lobby ----------------------------------------------------------------------------

export const LOBBY_SIZE = { x: 128, y: 64, z: 128 }
export const LOBBY_TOP = 24

/** Smooth closed noise around a circle: radius wobble for an island's outline. */
function ringNoise(rng) {
  const parts = [1, 2, 3, 5].map((f) => ({ f, phase: rng() * Math.PI * 2, amp: rng() * (1 / f) }))
  const norm = parts.reduce((s, p) => s + p.amp, 0) || 1
  return (angle) => parts.reduce((s, p) => s + Math.sin(angle * p.f + p.phase) * p.amp, 0) / norm
}

/** One floating island: an outline of radius ~`radius`, its top at `top`. Returns its top cells. */
function island(world, rng, cx, cz, radius, top, depth = 9) {
  const wobble = ringNoise(rng)
  const cells = []
  const R = Math.ceil(radius * 1.35)
  for (let x = cx - R; x <= cx + R; x += 1) {
    for (let z = cz - R; z <= cz + R; z += 1) {
      const dx = x - cx
      const dz = z - cz
      const d = Math.hypot(dx, dz)
      const r = radius * (0.9 + 0.16 * wobble(Math.atan2(dz, dx)))
      if (d > r) continue
      const t = 1 - (d / r) ** 2
      const down = Math.round(2 + t * depth + rng() * 1.6)
      for (let y = top; y > top - down; y -= 1) {
        const fromTop = top - y
        world.set(x, y, z, fromTop === 0 ? B.GRASS : fromTop < 3 ? B.DIRT : rng() < 0.07 ? B.ORE : B.STONE)
      }
      cells.push({ x, z, edge: d > r - 1.5, d })
    }
  }
  return cells
}

/**
 * The STRAFEX hub, big enough for a full server of 50: a floating island with
 *
 * - the plaza and the giant sword monument in the middle (spawn garden and fountain south)
 * - the Duels colosseum to the north (its arch is the 'duels' station)
 * - the Spirelands portal on a slate hill to the east ('ffa')
 * - the market to the west: the case stalls and the leaderboard wall
 * - training grounds with dummies to hit (north-east), the parkour tower (south-west),
 *   a lake with a dock and a lighthouse (south-east), and jump pads up to a sky island
 *   (north-west)
 *
 * Static: nobody builds here. Returns the world and where everything is (`stations`,
 * `dummies`, `parkour`, `boards`, `signs`).
 */
export function generateLobby() {
  const rng = mulberry32(1337)
  const world = new VoxelWorld(LOBBY_SIZE.x, LOBBY_SIZE.y, LOBBY_SIZE.z)
  const cx = 64
  const cz = 64
  const top = LOBBY_TOP
  const set = (x, y, z, id) => world.set(x, y, z, id)
  const fill = (x0, y0, z0, x1, y1, z1, id) => fillBox(world, Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), id)
  const cells = island(world, rng, cx, cz, 52, top, 18)
  const onIsland = (x, z) => world.get(x, top, z) !== B.AIR
  const stations = []
  const signs = []
  /** Areas the trees and flowers keep out of: [x, z, radius]. */
  const keepOut = []
  const lantern = (x, z, h = 3) => {
    if (!onIsland(x, z)) return
    for (let y = 1; y <= h; y += 1) set(x, top + y, z, B.LOG)
    set(x, top + h + 1, z, B.LANTERN)
  }

  // --- Plaza, rim, and the four avenues -------------------------------------------------
  for (const c of cells) {
    const d = Math.hypot(c.x - cx, c.z - cz)
    if (d <= 12) set(c.x, top, c.z, (Math.floor(d) + Math.floor(Math.atan2(c.z - cz, c.x - cx) * 4)) % 3 === 0 ? B.DARKSTONE : B.STONE_BRICKS)
    else if (d <= 13.5) set(c.x, top, c.z, B.QUARTZ)
  }
  for (const c of cells) {
    const d = Math.hypot(c.x - cx, c.z - cz)
    const ax = Math.abs(c.x - cx)
    const az = Math.abs(c.z - cz)
    if (d > 13.5 && d < 46 && (ax <= 2 || az <= 2)) set(c.x, top, c.z, B.PATH)
    else if (d > 13.5 && d < 46 && (ax === 3 || az === 3)) set(c.x, top, c.z, B.STONE_BRICKS)
  }
  keepOut.push([cx, cz, 15])

  // --- The monument: a giant diamond sword planted in a quartz pedestal ------------------
  fill(cx - 4, top + 1, cz - 4, cx + 4, top + 1, cz + 4, B.QUARTZ)
  fill(cx - 3, top + 2, cz - 3, cx + 3, top + 2, cz + 3, B.QUARTZ)
  fill(cx - 2, top + 3, cz - 2, cx + 2, top + 3, cz + 2, B.GOLD)
  for (let y = top + 4; y <= top + 15; y += 1) {
    const w = y > top + 13 ? 0 : 1
    for (let dx = -w; dx <= w; dx += 1) set(cx + dx, y, cz, dx === 0 ? B.AZURE : B.ICE)
  }
  fill(cx - 4, top + 16, cz, cx + 4, top + 16, cz, B.GOLD)
  set(cx - 4, top + 17, cz, B.GOLD)
  set(cx + 4, top + 17, cz, B.GOLD)
  fill(cx, top + 17, cz, cx, top + 19, cz, B.LOG)
  set(cx, top + 20, cz, B.GOLD)
  set(cx, top + 21, cz, B.CRYSTAL)
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    fill(cx + dx, top + 2, cz + dz, cx + dx, top + 3, cz + dz, B.QUARTZ)
    set(cx + dx, top + 4, cz + dz, B.LANTERN)
  }
  // Banners round the plaza.
  const bannerColors = [B.WOOL_BLUE, B.WOOL_RED, B.WOOL_YELLOW, B.WOOL_WHITE]
  for (let i = 0; i < 12; i += 1) {
    const a = ((i + 0.5) / 12) * Math.PI * 2
    const x = Math.round(cx + Math.cos(a) * 12.8)
    const z = Math.round(cz + Math.sin(a) * 12.8)
    if (Math.abs(x - cx) <= 3 || Math.abs(z - cz) <= 3) continue
    fill(x, top + 1, z, x, top + 5, z, B.LOG)
    set(x, top + 6, z, B.LANTERN)
    set(x, top + 5, z + (z > cz ? 1 : -1), bannerColors[i % 4])
    set(x, top + 4, z + (z > cz ? 1 : -1), bannerColors[i % 4])
  }

  // --- South: the spawn garden and the fountain -----------------------------------------
  const fz = cz + 22
  for (let x = cx - 5; x <= cx + 5; x += 1) {
    for (let z = fz - 5; z <= fz + 5; z += 1) {
      const d = Math.hypot(x - cx, z - fz)
      if (d > 5.2) continue
      set(x, top, z, B.STONE_BRICKS)
      if (d > 4.2) set(x, top + 1, z, B.QUARTZ)
      else if (d > 1.2) set(x, top, z, B.WATER)
    }
  }
  fill(cx, top + 1, fz, cx, top + 4, fz, B.QUARTZ)
  set(cx, top + 5, fz, B.WATER)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) set(cx + dx, top + 4, fz + dz, B.WATER)
  for (const bx of [cx - 8, cx + 8]) fill(bx, top + 1, fz - 2, bx, top + 1, fz + 2, B.PLANKS)
  keepOut.push([cx, fz, 9], [cx, cz + 33, 7])
  signs.push({ text: 'WELCOME TO STRAFEX', sub: 'Duels north · Spirelands east · Parkour south-west', x: cx + 0.5, y: top + 8, z: fz + 0.5, color: '#ffb21a' })

  // --- North: the Duels colosseum ---------------------------------------------------------
  const dz0 = cz - 32
  for (let x = cx - 12; x <= cx + 12; x += 1) {
    for (let z = dz0 - 12; z <= dz0 + 12; z += 1) {
      const d = Math.hypot(x - cx, z - dz0)
      if (d > 12) continue
      if (d < 8) set(x, top, z, Math.floor(d) % 3 === 0 ? B.CLAY_RED : B.SANDSTONE)
      else {
        // Tiered seats, open to the south where the arch is.
        const gate = z > dz0 + 6 && Math.abs(x - cx) <= 2
        const h = gate ? 0 : Math.min(5, Math.floor((d - 7.5) * 1.3))
        set(x, top, z, B.SANDSTONE)
        for (let y = 1; y <= h; y += 1) set(x, top + y, z, y % 2 ? B.CLAY_ORANGE : B.SANDSTONE)
      }
    }
  }
  // The arch at the gate: the Duels station.
  const archZ = dz0 + 11
  fill(cx - 3, top + 1, archZ, cx - 3, top + 7, archZ, B.QUARTZ)
  fill(cx + 3, top + 1, archZ, cx + 3, top + 7, archZ, B.QUARTZ)
  fill(cx - 3, top + 8, archZ, cx + 3, top + 8, archZ, B.QUARTZ)
  fill(cx - 2, top + 9, archZ, cx + 2, top + 9, archZ, B.GOLD)
  set(cx - 3, top + 9, archZ, B.LANTERN)
  set(cx + 3, top + 9, archZ, B.LANTERN)
  // Two fighters in stone, mid-duel.
  for (const [sx, col] of [[-3, B.WOOL_BLUE], [3, B.WOOL_RED]]) {
    fill(cx + sx, top + 1, dz0, cx + sx, top + 2, dz0, B.STONE_BRICKS)
    fill(cx + sx, top + 3, dz0, cx + sx, top + 4, dz0, col)
    set(cx + sx, top + 5, dz0, B.QUARTZ)
    set(cx + sx - Math.sign(sx), top + 4, dz0, B.AZURE)
  }
  stations.push({ id: 'duels', x: cx + 0.5, y: top + 1, z: archZ + 2.5, r: 5 })
  signs.push({ text: 'DUELS', sub: '1v1 · 9 modes · press E', x: cx + 0.5, y: top + 12, z: archZ + 0.5, color: '#ffb21a' })
  keepOut.push([cx, dz0, 15])

  // --- East: the Spirelands portal on a slate hill -----------------------------------------
  const px = cx + 33
  for (let x = px - 9; x <= px + 9; x += 1) {
    for (let z = cz - 9; z <= cz + 9; z += 1) {
      const d = Math.hypot(x - px - 2, z - cz)
      if (d > 9 || !onIsland(x, z)) continue
      const h = Math.max(0, Math.min(3, Math.floor((9 - d) / 2.2)))
      for (let y = 1; y <= h; y += 1) set(x, top + y, z, y === h ? B.GRASS : B.SLATE)
    }
  }
  for (const [ox, oz, h] of [[6, -6, 12], [7, 5, 15], [-1, -8, 9], [0, 8, 10]]) {
    for (let y = 1; y <= h; y += 1) {
      const r = y > h - 3 ? 0 : 1
      fill(px + ox - r, top + y, cz + oz - r, px + ox + r, top + y, cz + oz + r, y % 4 === 0 ? B.STONE : B.SLATE)
    }
  }
  const gx = px - 3
  fill(gx, top + 1, cz - 3, gx, top + 1, cz + 3, B.OBSIDIAN)
  fill(gx, top + 9, cz - 3, gx, top + 9, cz + 3, B.OBSIDIAN)
  fill(gx, top + 1, cz - 3, gx, top + 9, cz - 3, B.OBSIDIAN)
  fill(gx, top + 1, cz + 3, gx, top + 9, cz + 3, B.OBSIDIAN)
  fill(gx, top + 2, cz - 2, gx, top + 8, cz + 2, B.CRYSTAL)
  fill(gx - 1, top, cz - 3, gx - 4, top, cz + 3, B.SLATE)
  stations.push({ id: 'ffa', x: gx - 2.5, y: top + 1, z: cz + 0.5, r: 5 })
  signs.push({ text: 'SPIRELANDS', sub: 'Free for all · press E', x: gx + 0.5, y: top + 12, z: cz + 0.5, color: '#7fb8ff' })
  keepOut.push([px, cz, 12])

  // --- West: the market - case stalls and the leaderboard wall ----------------------------
  const stall = (x, z, id, block, stripe) => {
    fill(x - 3, top, z - 3, x + 3, top, z + 3, B.STONE_BRICKS)
    fill(x - 1, top + 1, z - 1, x + 1, top + 1, z + 1, block)
    for (const [dx, dzz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) fill(x + dx, top + 1, z + dzz, x + dx, top + 4, z + dzz, B.LOG)
    for (let dx = -3; dx <= 3; dx += 1) for (let dzz = -3; dzz <= 3; dzz += 1) set(x + dx, top + 5, z + dzz, (dx + 3) % 2 ? B.WOOL_WHITE : stripe)
    for (let dx = -2; dx <= 2; dx += 1) set(x + dx, top + 6, z, (dx + 2) % 2 ? B.WOOL_WHITE : stripe)
    set(x + 4, top + 1, z - 3, B.LANTERN)
    set(x + 4, top + 1, z + 3, B.LANTERN)
    stations.push({ id, x: x + 0.5, y: top + 2, z: z + 0.5, r: 4 })
    keepOut.push([x, z, 6])
  }
  stall(cx - 24, cz - 8, 'case:sword', B.WOOL_BLUE, B.WOOL_BLUE)
  stall(cx - 24, cz + 8, 'case:cape', B.GOLD, B.WOOL_YELLOW)
  const wallX = cx - 36
  for (let z = cz - 9; z <= cz + 9; z += 1) {
    for (let y = top + 1; y <= top + 10; y += 1) {
      const frame = z === cz - 9 || z === cz + 9 || y === top + 1 || y === top + 10
      set(wallX, y, z, frame ? B.QUARTZ : B.DARKSTONE)
    }
  }
  set(wallX, top + 11, cz - 9, B.LANTERN)
  set(wallX, top + 11, cz + 9, B.LANTERN)
  fill(wallX + 1, top, cz - 9, wallX + 6, top, cz + 9, B.STONE_BRICKS)
  keepOut.push([wallX + 2, cz, 12])
  const boards = [{ x: wallX + 1.02, y: top + 5.5, z: cz + 0.5, w: 17, h: 8, ry: Math.PI / 2 }]

  // --- North-east: training grounds with dummies ----------------------------------------
  const tx = cx + 27
  const tz = cz - 27
  const dummies = []
  for (let x = tx - 8; x <= tx + 8; x += 1) {
    for (let z = tz - 8; z <= tz + 8; z += 1) {
      if (!onIsland(x, z)) continue
      const edge = Math.abs(x - tx) === 8 || Math.abs(z - tz) === 8
      set(x, top, z, edge ? B.STONE_BRICKS : (x + z) % 5 === 0 ? B.PATH : B.SAND)
      const gap = Math.abs(z - tz) <= 1 && x === tx - 8
      if (edge && !gap) set(x, top + 1, z, (x + z) % 4 === 0 ? B.LOG : B.LEAVES)
    }
  }
  for (const [ox, oz] of [[-4, -4], [0, -4], [4, -4], [-4, 1], [0, 1], [4, 1], [-2, 5], [2, 5]]) {
    set(tx + ox, top + 1, tz + oz, B.HAY)
    dummies.push({ x: tx + ox + 0.5, y: top + 2, z: tz + oz + 0.5 })
  }
  signs.push({ text: 'TRAINING', sub: 'Hit the dummies · practise combos', x: tx - 9.5, y: top + 6, z: tz + 0.5, color: '#9fe6ff' })
  keepOut.push([tx, tz, 11])

  // --- South-west: the parkour tower ---------------------------------------------------------
  const kx = cx - 27
  const kz = cz + 27
  fill(kx - 1, top + 1, kz - 1, kx + 1, top + 25, kz + 1, B.STONE_BRICKS)
  for (let y = top + 4; y <= top + 25; y += 6) fill(kx - 1, y, kz - 1, kx + 1, y, kz + 1, B.MOSSY_BRICKS)
  const colours = [B.WOOL_RED, B.CLAY_ORANGE, B.WOOL_YELLOW, B.GRASS, B.AZURE, B.WOOL_BLUE, B.MUSHROOM]
  const startX = kx + 5
  const startZ = kz
  set(startX, top, startZ, B.GOLD)
  let level = 0
  for (let k = 0; k < 26; k += 1) {
    const a = (k + 1) * 0.66
    const r = k % 5 === 4 ? 5.6 : 5
    const x = Math.round(kx + Math.cos(a) * r)
    const z = Math.round(kz + Math.sin(a) * r)
    level = k + 1
    set(x, top + level, z, colours[k % colours.length])
    if (k % 6 === 5) set(x + (Math.cos(a) > 0 ? 1 : -1), top + level, z, colours[k % colours.length])
  }
  // The finish: a platform on top of the tower.
  const finishY = top + 26
  fill(kx - 2, finishY, kz - 2, kx + 2, finishY, kz + 2, B.QUARTZ)
  set(kx, finishY, kz, B.FINISH)
  for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) set(kx + ox, finishY + 1, kz + oz, B.LANTERN)
  fill(kx + 2, finishY + 1, kz, kx + 2, finishY + 4, kz, B.LOG)
  fill(kx + 3, finishY + 3, kz, kx + 4, finishY + 4, kz, B.WOOL_RED)
  signs.push({ text: 'PARKOUR', sub: 'Gold block to start · reach the top!', x: startX + 0.5, y: top + 5, z: startZ + 0.5, color: '#7cff6b' })
  keepOut.push([kx, kz, 9])
  const parkour = { start: { x: startX + 0.5, y: top + 1, z: startZ + 0.5 }, finish: { x: kx + 0.5, y: finishY + 1, z: kz + 0.5 } }

  // --- South-east: the lake, a dock, and the lighthouse -----------------------------------
  const lx = cx + 26
  const lz = cz + 25
  for (let x = lx - 11; x <= lx + 11; x += 1) {
    for (let z = lz - 11; z <= lz + 11; z += 1) {
      const d = Math.hypot(x - lx, (z - lz) * 1.2)
      if (d > 10 || !onIsland(x, z)) continue
      set(x, top, z, d > 9 ? B.SAND : B.WATER)
      set(x, top - 1, z, B.SAND)
      for (let y = 1; y < 4; y += 1) if (world.get(x, top + y, z) !== B.AIR) set(x, top + y, z, B.AIR)
    }
  }
  fill(lx - 10, top + 1, lz, lx - 3, top + 1, lz + 1, B.PLANKS)
  for (const ox of [-9, -6, -3]) set(lx + ox, top, lz + 2, B.LOG)
  // A little boat.
  fill(lx + 1, top + 1, lz - 4, lx + 4, top + 1, lz - 3, B.PLANKS)
  set(lx + 1, top + 2, lz - 4, B.PLANKS)
  set(lx + 4, top + 2, lz - 3, B.PLANKS)
  // A stream from the lake to the edge, and the waterfall off it.
  let sxw = lx + 9
  while (sxw < LOBBY_SIZE.x - 1 && onIsland(sxw, lz)) {
    set(sxw, top, lz, B.WATER)
    set(sxw, top, lz + 1, B.WATER)
    set(sxw, top - 1, lz, B.SAND)
    set(sxw, top - 1, lz + 1, B.SAND)
    sxw += 1
  }
  for (let y = top - 1; y > top - 16; y -= 1) {
    set(sxw, y, lz, B.WATER)
    set(sxw, y, lz + 1, B.WATER)
  }
  const hx = cx + 38
  const hz = cz + 36
  if (onIsland(hx, hz)) {
    for (let y = 1; y <= 12; y += 1) {
      for (let x = hx - 1; x <= hx + 1; x += 1) for (let z = hz - 1; z <= hz + 1; z += 1) set(x, top + y, z, Math.floor(y / 2) % 2 ? B.WOOL_WHITE : B.WOOL_RED)
    }
    fill(hx - 2, top + 13, hz - 2, hx + 2, top + 13, hz + 2, B.PLANKS)
    set(hx, top + 14, hz, B.LANTERN)
    fill(hx - 1, top + 15, hz - 1, hx + 1, top + 15, hz + 1, B.WOOL_RED)
  }
  keepOut.push([lx, lz, 13], [hx, hz, 4])

  // --- North-west: jump pads up to the sky island -----------------------------------------
  const jx = cx - 26
  const jz = cz - 26
  const pads = [[0, 0, 0], [3, 4, 6], [-2, 9, 12]]
  for (const [ox, oz, h] of pads) {
    if (h > 0) fill(jx + ox - 1, top + h, jz + oz - 1, jx + ox + 1, top + h, jz + oz + 1, B.AZURE)
    set(jx + ox, top + h, jz + oz, B.JUMP_PAD)
  }
  // The sky island itself, floating high above.
  const skyY = top + 20
  const sky = island(world, rng, jx + 2, jz + 14, 7, skyY, 5)
  for (const c of sky) if (rng() < 0.12 && !c.edge) set(c.x, skyY + 1, c.z, rng() < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW)
  arenaTree(world, jx + 4, skyY + 1, jz + 12, rng)
  fill(jx, skyY + 1, jz + 16, jx + 1, skyY + 1, jz + 17, B.GOLD)
  set(jx - 3, skyY + 1, jz + 14, B.LANTERN)
  set(jx + 5, skyY + 1, jz + 17, B.LANTERN)
  signs.push({ text: 'SKY ISLAND', sub: 'Bounce up the pads!', x: jx + 0.5, y: top + 5, z: jz + 0.5, color: '#9fe6ff' })
  keepOut.push([jx, jz, 6], [jx + 3, jz + 4, 4], [jx - 2, jz + 9, 4])

  // --- Lamps along the avenues, and nature everywhere else --------------------------------
  for (let r = 17; r < 44; r += 7) {
    for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + ux * r
      const z = cz + uz * r
      lantern(x + uz * 4, z + ux * 4)
      lantern(x - uz * 4, z - ux * 4)
    }
  }
  const blocked = (x, z, pad = 0) => keepOut.some(([kx2, kz2, r]) => Math.hypot(x - kx2, z - kz2) < r + pad)
  for (const c of cells) {
    if (c.edge || world.get(c.x, top, c.z) !== B.GRASS || world.get(c.x, top + 1, c.z) !== B.AIR) continue
    const ax = Math.abs(c.x - cx)
    const az = Math.abs(c.z - cz)
    if (ax <= 4 || az <= 4 || blocked(c.x, c.z)) continue
    const r = rng()
    if (r < 0.022 && !blocked(c.x, c.z, 3)) arenaTree(world, c.x, top + 1, c.z, rng, B.LEAVES, 4)
    else if (r < 0.026 && c.d > 20) {
      // A giant mushroom now and then.
      fill(c.x, top + 1, c.z, c.x, top + 3, c.z, B.QUARTZ)
      fill(c.x - 1, top + 4, c.z - 1, c.x + 1, top + 4, c.z + 1, B.MUSHROOM)
      set(c.x, top + 5, c.z, B.MUSHROOM)
    } else if (r < 0.03) set(c.x, top + 1, c.z, rng() < 0.5 ? B.STONE : B.MOSSY_BRICKS)
    else if (r < 0.1) set(c.x, top + 1, c.z, B.TALL_GRASS)
    else if (r < 0.13) set(c.x, top + 1, c.z, rng() < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW)
  }
  // Two more waterfalls off the island's north-west and south edges.
  for (const [wx, wz] of [[cx - 40, cz - 18], [cx - 10, cz + 46]]) {
    let x = wx
    let z = wz
    const sx = Math.sign(wx - cx)
    const sz = Math.abs(wz - cz) > Math.abs(wx - cx) ? Math.sign(wz - cz) : 0
    if (!onIsland(x, z)) continue
    while (onIsland(x, z)) {
      set(x, top, z, B.WATER)
      set(x, top - 1, z, B.SAND)
      if (sz) z += sz
      else x += sx
    }
    for (let y = top - 1; y > top - 14; y -= 1) set(x, y, z, B.WATER)
  }

  // Spawn: the garden south of the plaza, facing the monument.
  return {
    world,
    spawn: { x: cx + 0.5, y: top + 1, z: cz + 33.5 },
    stations,
    dummies,
    parkour,
    boards,
    signs,
    board: boards[0],
    center: { x: cx, z: cz },
  }
}
