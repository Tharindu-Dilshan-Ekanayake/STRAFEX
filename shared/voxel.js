/**
 * The voxel world shared by the server (authority, bots) and the client (rendering,
 * movement): block types, the grid, and a voxel raycast.
 *
 * Coordinates are whole blocks; block (x, y, z) fills [x, x+1) x [y, y+1) x [z, z+1).
 * Anything outside the grid is air: falling off the islands drops you into the lava.
 */

/** Block ids. Stored one byte per cell. */
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  PLANKS: 4,
  LOG: 5,
  LEAVES: 6,
  SAND: 7,
  SANDSTONE: 8,
  SNOW_GRASS: 9,
  ICE: 10,
  SNOW: 11,
  WOOL_WHITE: 12,
  WOOL_RED: 13,
  WOOL_BLUE: 14,
  CANDY_PINK: 15,
  CANDY_STRIPE: 16,
  BRICK: 17,
  GLASS: 18,
  LUCKY: 19,
  LUCKY_RARE: 20,
  CAGE: 21,
  GOLD: 22,
  DARKSTONE: 23,
  TNT: 24,
  LAMP: 25,
  CACTUS: 26,
  STONE_BRICKS: 27,
  PATH: 28,
  FLOWER_RED: 29,
  FLOWER_YELLOW: 30,
  TALL_GRASS: 31,
  FROSTING: 32,
  ORE: 33,
  WOOL_YELLOW: 34,
  WATER: 35,
  QUARTZ: 36,
  OBSIDIAN: 37,
  CRYSTAL: 38,
  CORESTONE: 39,
  CLAY_ORANGE: 40,
  CLAY_RED: 41,
  MOSSY_BRICKS: 42,
  SLATE: 43,
  JUMP_PAD: 44,
  AZURE: 45,
  FINISH: 46,
  HAY: 47,
  MUSHROOM: 48,
  LANTERN: 49,
}

/**
 * Per-block rules. `tex` is [top, side, bottom] tile names (the client paints them),
 * `hard` the seconds to break by hand (Infinity = unbreakable), `drop` the item a
 * broken block gives (null = nothing). `render`: 'solid' | 'cutout' (leaves, glass:
 * see-through pixels, still a full block) | 'cross' (flowers: two crossed quads, no
 * collision).
 */
const def = (name, tex, hard, drop, extra = {}) => ({
  name,
  tex: Array.isArray(tex) ? tex : [tex, tex, tex],
  hard,
  drop,
  solid: true,
  render: 'solid',
  ...extra,
})

export const BLOCKS = []
BLOCKS[B.AIR] = { name: 'Air', tex: [null, null, null], hard: 0, drop: null, solid: false, render: 'none' }
BLOCKS[B.GRASS] = def('Grass', ['grass_top', 'grass_side', 'dirt'], 0.55, 'dirt')
BLOCKS[B.DIRT] = def('Dirt', 'dirt', 0.5, 'dirt')
BLOCKS[B.STONE] = def('Stone', 'stone', 1.4, 'stone_bricks')
BLOCKS[B.PLANKS] = def('Planks', 'planks', 0.75, 'planks')
BLOCKS[B.LOG] = def('Log', ['log_top', 'log_side', 'log_top'], 0.9, 'planks')
BLOCKS[B.LEAVES] = def('Leaves', 'leaves', 0.2, null, { render: 'cutout' })
BLOCKS[B.SAND] = def('Sand', 'sand', 0.5, 'sandstone')
BLOCKS[B.SANDSTONE] = def('Sandstone', ['sandstone_top', 'sandstone', 'sandstone_top'], 0.9, 'sandstone')
BLOCKS[B.SNOW_GRASS] = def('Snowy Grass', ['snow', 'snow_side', 'dirt'], 0.55, 'snow')
BLOCKS[B.ICE] = def('Ice', 'ice', 0.45, null)
BLOCKS[B.SNOW] = def('Snow', 'snow', 0.4, 'snow')
BLOCKS[B.WOOL_WHITE] = def('White Wool', 'wool_white', 0.45, 'wool')
BLOCKS[B.WOOL_RED] = def('Red Wool', 'wool_red', 0.45, 'wool')
BLOCKS[B.WOOL_BLUE] = def('Blue Wool', 'wool_blue', 0.45, 'wool')
BLOCKS[B.WOOL_YELLOW] = def('Yellow Wool', 'wool_yellow', 0.45, 'wool')
BLOCKS[B.CANDY_PINK] = def('Candy', 'candy_pink', 0.5, 'candy')
BLOCKS[B.CANDY_STRIPE] = def('Candy Cane', 'candy_stripe', 0.6, 'candy')
BLOCKS[B.FROSTING] = def('Frosting', ['frosting_top', 'frosting_side', 'candy_pink'], 0.5, 'candy')
BLOCKS[B.BRICK] = def('Bricks', 'brick', 1.4, 'stone_bricks')
BLOCKS[B.GLASS] = def('Glass', 'glass', 0.3, null, { render: 'cutout' })
BLOCKS[B.LUCKY] = def('Lucky Block', 'lucky', 0.9, null, { lucky: 1 })
BLOCKS[B.LUCKY_RARE] = def('Mega Lucky Block', 'lucky_rare', 1.1, null, { lucky: 2 })
BLOCKS[B.CAGE] = def('Cage', 'cage', Infinity, null, { render: 'cutout' })
BLOCKS[B.GOLD] = def('Gold Block', 'gold', 2, null)
BLOCKS[B.DARKSTONE] = def('Darkstone', 'darkstone', 0.9, 'stone_bricks')
BLOCKS[B.TNT] = def('TNT', ['tnt_top', 'tnt_side', 'tnt_top'], 0.1, null)
BLOCKS[B.LAMP] = def('Lamp', 'lamp', 0.5, null, { glow: true })
BLOCKS[B.CACTUS] = def('Cactus', ['cactus_top', 'cactus_side', 'cactus_top'], 0.4, null)
BLOCKS[B.STONE_BRICKS] = def('Stone Bricks', 'stone_bricks', 1.2, 'stone_bricks')
BLOCKS[B.PATH] = def('Path', ['path_top', 'dirt', 'dirt'], 0.5, 'dirt')
BLOCKS[B.FLOWER_RED] = def('Poppy', 'flower_red', 0, null, { solid: false, render: 'cross' })
BLOCKS[B.FLOWER_YELLOW] = def('Dandelion', 'flower_yellow', 0, null, { solid: false, render: 'cross' })
BLOCKS[B.TALL_GRASS] = def('Tall Grass', 'tall_grass', 0, null, { solid: false, render: 'cross' })
BLOCKS[B.ORE] = def('Gem Ore', 'ore', 1.6, 'stone_bricks')
BLOCKS[B.WATER] = def('Water', 'water', Infinity, null, { solid: false })
BLOCKS[B.QUARTZ] = def('Quartz', ['quartz_top', 'quartz', 'quartz_top'], 0.9, 'stone_bricks')
/** Blast-proof: crystals sit on it, explosions leave it standing. */
BLOCKS[B.OBSIDIAN] = def('Obsidian', 'obsidian', 5, 'obsidian')
/** A blast crystal: breaks at a touch and explodes (host.js). */
BLOCKS[B.CRYSTAL] = def('Blast Crystal', 'crystal', 0, null, { render: 'cutout', glow: true, crystal: true })
/** Arena floors and world bottoms: nothing breaks it. */
BLOCKS[B.CORESTONE] = def('Corestone', 'corestone', Infinity, null)
BLOCKS[B.CLAY_ORANGE] = def('Orange Clay', 'clay_orange', 1, 'sandstone')
BLOCKS[B.CLAY_RED] = def('Red Clay', 'clay_red', 1, 'sandstone')
BLOCKS[B.MOSSY_BRICKS] = def('Mossy Bricks', 'mossy_bricks', 1.2, 'stone_bricks')
BLOCKS[B.SLATE] = def('Slate', 'slate', 1.5, 'stone_bricks')
/** Step on it and you're thrown high into the air (physics.js). */
BLOCKS[B.JUMP_PAD] = def('Jump Pad', ['pad_top', 'pad_side', 'pad_side'], Infinity, null, { pad: true })
/** Polished blue stone for statues and trim. */
BLOCKS[B.AZURE] = def('Azure Block', 'azure', 1.5, 'stone_bricks')
/** The parkour's finish line. */
BLOCKS[B.FINISH] = def('Finish Plate', ['finish_top', 'gold', 'gold'], Infinity, null, { glow: true })
BLOCKS[B.HAY] = def('Hay Bale', ['hay_top', 'hay_side', 'hay_top'], 0.5, 'planks')
/** A giant mushroom's cap: red with white spots. */
BLOCKS[B.MUSHROOM] = def('Mushroom Cap', 'mushroom', 0.4, null)
BLOCKS[B.LANTERN] = def('Lantern', ['lantern_top', 'lantern', 'lantern_top'], 0.4, null, { glow: true })

export const isSolidBlock = (id) => Boolean(BLOCKS[id]?.solid)
export const isLucky = (id) => Boolean(BLOCKS[id]?.lucky)
export const isCrystal = (id) => Boolean(BLOCKS[id]?.crystal)

/** A box of blocks, `sx` x `sy` x `sz`, one byte each; y is the slowest axis. */
export class VoxelWorld {
  constructor(sx, sy, sz, data = null) {
    this.sx = sx
    this.sy = sy
    this.sz = sz
    this.data = data || new Uint8Array(sx * sy * sz)
    /**
     * A world that fills its box (Spirelands): nothing ever sees past its bottom or its
     * outer sides, so the mesher draws no faces there. Physics is unaffected.
     */
    this.sealed = false
    /**
     * A world with an open sea: the water's surface at this height is drawn as one plane
     * to the horizon (Environment.jsx), not block by block. -1: none.
     */
    this.seaLevel = -1
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz
  }

  index(x, y, z) {
    return x + z * this.sx + y * this.sx * this.sz
  }

  get(x, y, z) {
    x = Math.floor(x)
    y = Math.floor(y)
    z = Math.floor(z)
    if (!this.inBounds(x, y, z)) return B.AIR
    return this.data[x + z * this.sx + y * this.sx * this.sz]
  }

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false
    this.data[x + z * this.sx + y * this.sx * this.sz] = id
    return true
  }

  isSolid(x, y, z) {
    if (this.sealed && (x < 0 || z < 0 || x >= this.sx || z >= this.sz)) return true
    return isSolidBlock(this.get(x, y, z))
  }

  /** Highest solid block in column (x, z) at or below `fromY`, or -1. */
  surface(x, z, fromY = this.sy - 1) {
    for (let y = Math.min(fromY, this.sy - 1); y >= 0; y -= 1) if (this.isSolid(x, y, z)) return y
    return -1
  }

  clone() {
    const w = new VoxelWorld(this.sx, this.sy, this.sz, this.data.slice())
    w.sealed = this.sealed
    w.seaLevel = this.seaLevel
    return w
  }
}

/**
 * Steps a ray through the grid (Amanatides & Woo) and returns the first block `test`
 * accepts (default: anything that isn't air), within `maxDist`:
 * `{ x, y, z, id, nx, ny, nz, dist }` (n = the face it entered through), or null.
 * `dir` need not be normalised.
 */
export function raycastVoxels(world, ox, oy, oz, dx, dy, dz, maxDist, test = (id) => id !== B.AIR) {
  const len = Math.hypot(dx, dy, dz) || 1
  dx /= len
  dy /= len
  dz /= len
  let x = Math.floor(ox)
  let y = Math.floor(oy)
  let z = Math.floor(oz)
  const stepX = dx > 0 ? 1 : -1
  const stepY = dy > 0 ? 1 : -1
  const stepZ = dz > 0 ? 1 : -1
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity
  let nx = 0
  let ny = 0
  let nz = 0
  let t = 0
  while (t <= maxDist) {
    const id = world.get(x, y, z)
    if (test(id)) return { x, y, z, id, nx, ny, nz, dist: t }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX
      t = tMaxX
      tMaxX += tDeltaX
      nx = -stepX
      ny = 0
      nz = 0
    } else if (tMaxY < tMaxZ) {
      y += stepY
      t = tMaxY
      tMaxY += tDeltaY
      nx = 0
      ny = -stepY
      nz = 0
    } else {
      z += stepZ
      t = tMaxZ
      tMaxZ += tDeltaZ
      nx = 0
      ny = 0
      nz = -stepZ
    }
  }
  return null
}

/**
 * Distance along a ray to an axis-aligned box, or -1 if it misses (slab method).
 * Used for hitting players.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity
  let tmax = Infinity
  const axes = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ]
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1
      continue
    }
    let t1 = (lo - o) / d
    let t2 = (hi - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return -1
  }
  if (tmax < 0) return -1
  return Math.max(0, tmin)
}

/** Packs a block position into one integer key (worlds are under 1024 on each side). */
export const blockKey = (x, y, z) => (x & 1023) | ((y & 1023) << 10) | ((z & 1023) << 20)
export const unpackKey = (k) => [k & 1023, (k >> 10) & 1023, (k >> 20) & 1023]
