import { MODES } from './balance.js'
import { mulberry32 } from './rng.js'
import { B, VoxelWorld } from './voxel.js'

/**
 * The worlds, built from a seed so the server and every client build the very same
 * blocks: only the map id and seed (plus later edits) ever cross the network.
 *
 * A round's world: eight spawn islands in a ring, four little islets and a big middle
 * island with a landmark and the Mega Lucky Blocks, all floating over a lava sea.
 */

export const MATCH_SIZE = { x: 112, y: 64, z: 112 }
export const CENTER = { x: 56, z: 56 }
/** Top surface of the spawn islands. */
export const ISLAND_TOP = 30
export const SPAWN_RING = 34
export const ISLET_RING = 20

export const MAPS = {
  meadow: {
    name: 'Sunny Meadow',
    top: B.GRASS,
    fill: B.DIRT,
    deep: B.STONE,
    speck: B.ORE,
    trunk: B.LOG,
    crown: B.LEAVES,
    deco: [B.FLOWER_RED, B.FLOWER_YELLOW, B.TALL_GRASS, B.TALL_GRASS],
    sky: ['#64c8ff', '#c9f0ff'],
  },
  frost: {
    name: 'Frosty Peaks',
    top: B.SNOW_GRASS,
    fill: B.SNOW,
    deep: B.STONE,
    speck: B.ICE,
    trunk: B.LOG,
    crown: B.SNOW,
    deco: [B.TALL_GRASS],
    sky: ['#8fb8e8', '#eaf4ff'],
  },
  candy: {
    name: 'Candy Clouds',
    top: B.FROSTING,
    fill: B.CANDY_PINK,
    deep: B.BRICK,
    speck: B.CANDY_STRIPE,
    trunk: B.CANDY_STRIPE,
    crown: B.WOOL_RED,
    deco: [B.FLOWER_YELLOW, B.FLOWER_RED],
    sky: ['#ff9fd8', '#ffe3f4'],
  },
  desert: {
    name: 'Dune Isles',
    top: B.SAND,
    fill: B.SAND,
    deep: B.SANDSTONE,
    speck: B.GOLD,
    trunk: B.CACTUS,
    crown: null,
    deco: [B.TALL_GRASS],
    sky: ['#ffbf73', '#fff1d6'],
  },
  castle: {
    name: 'Sky Castle',
    top: B.GRASS,
    fill: B.DIRT,
    deep: B.STONE_BRICKS,
    speck: B.DARKSTONE,
    trunk: B.LOG,
    crown: B.LEAVES,
    deco: [B.FLOWER_YELLOW, B.TALL_GRASS, B.TALL_GRASS],
    sky: ['#7a6bd8', '#ffc9a8'],
  },
  ember: {
    name: 'Ember Isles',
    top: B.DARKSTONE,
    fill: B.STONE,
    deep: B.STONE,
    speck: B.GOLD,
    trunk: B.LOG,
    crown: null,
    deco: [B.LAMP],
    sky: ['#5a1c2e', '#ff8a4a'],
    /** Ember's dead trees: bare trunks; its "flowers" are glowing lamps, rarely. */
    decoChance: 0.03,
  },
  autumn: {
    name: 'Autumn Woods',
    top: B.GRASS,
    fill: B.DIRT,
    deep: B.STONE,
    speck: B.ORE,
    trunk: B.LOG,
    crown: B.WOOL_YELLOW,
    /** Each tree turns its own colour. */
    crowns: [B.WOOL_RED, B.WOOL_YELLOW, B.WOOL_YELLOW, B.LEAVES],
    deco: [B.FLOWER_RED, B.FLOWER_YELLOW, B.TALL_GRASS],
    sky: ['#e08a3c', '#ffe2b8'],
  },
  marble: {
    name: 'Marble Temple',
    top: B.QUARTZ,
    fill: B.QUARTZ,
    deep: B.STONE_BRICKS,
    speck: B.GOLD,
    /** No trees: marble columns with gold caps. */
    trunk: B.QUARTZ,
    crown: null,
    pillars: true,
    deco: [B.LAMP],
    decoChance: 0.02,
    sky: ['#9fb6ff', '#f3eaff'],
  },
  jungle: {
    name: 'Jungle Ruins',
    top: B.GRASS,
    fill: B.DIRT,
    deep: B.STONE_BRICKS,
    speck: B.DARKSTONE,
    trunk: B.LOG,
    crown: B.LEAVES,
    deco: [B.TALL_GRASS, B.TALL_GRASS, B.FLOWER_RED],
    decoChance: 0.28,
    sky: ['#3fae8a', '#d8ffe9'],
  },
  mushroom: {
    name: 'Mushroom Grove',
    top: B.GRASS,
    fill: B.DIRT,
    deep: B.STONE,
    speck: B.ORE,
    trunk: B.QUARTZ,
    crown: B.WOOL_RED,
    /** Its trees are giant mushrooms: a pale stem under a spotted red cap. */
    mushrooms: true,
    deco: [B.FLOWER_RED, B.TALL_GRASS],
    sky: ['#8a5cc7', '#ffd1ee'],
  },
  tropical: {
    name: 'Tropical Bay',
    top: B.SAND,
    fill: B.SAND,
    deep: B.SANDSTONE,
    speck: B.GOLD,
    trunk: B.LOG,
    crown: B.LEAVES,
    /** Palm trees: a tall trunk with fronds spread flat. */
    palms: true,
    deco: [B.TALL_GRASS],
    decoChance: 0.06,
    sky: ['#2ab3e8', '#d9f7ff'],
  },
  bricktown: {
    name: 'Brick Town',
    top: B.PATH,
    fill: B.DIRT,
    deep: B.BRICK,
    speck: B.STONE_BRICKS,
    trunk: B.LOG,
    crown: B.LEAVES,
    deco: [B.LAMP, B.FLOWER_YELLOW],
    decoChance: 0.05,
    sky: ['#5f9ad8', '#f0e6d8'],
  },
}
export const MAP_IDS = Object.keys(MAPS)

/** Smooth closed noise around a circle: radius wobble for an island's outline. */
function ringNoise(rng) {
  const parts = [1, 2, 3, 5].map((f) => ({ f, phase: rng() * Math.PI * 2, amp: rng() * (1 / f) }))
  const norm = parts.reduce((s, p) => s + p.amp, 0) || 1
  return (angle) => parts.reduce((s, p) => s + Math.sin(angle * p.f + p.phase) * p.amp, 0) / norm
}

/**
 * Carves one floating island: an outline of radius ~`radius` around (cx, cz), its top
 * at `top`, tapering down like an upside-down hill. Returns the top cells it made.
 */
function island(world, rng, map, cx, cz, radius, top, depth = 9) {
  const wobble = ringNoise(rng)
  const cells = []
  const R = Math.ceil(radius * 1.35)
  for (let x = cx - R; x <= cx + R; x += 1) {
    for (let z = cz - R; z <= cz + R; z += 1) {
      const dx = x + 0.5 - cx - 0.5
      const dz = z + 0.5 - cz - 0.5
      const d = Math.hypot(dx, dz)
      const r = radius * (0.88 + 0.22 * wobble(Math.atan2(dz, dx)))
      if (d > r) continue
      const t = 1 - (d / r) ** 2
      const down = Math.round(2 + t * depth + rng() * 1.6)
      for (let y = top; y > top - down; y -= 1) {
        const fromTop = top - y
        let id = map.deep
        if (fromTop === 0) id = map.top
        else if (fromTop < 3) id = map.fill
        else if (rng() < 0.07) id = map.speck
        world.set(x, y, z, id)
      }
      cells.push({ x, z, edge: d > r - 1.5 })
    }
  }
  return cells
}

function tree(world, map, x, y, z, rng) {
  if (map.mushrooms) {
    const h = 3 + Math.floor(rng() * 2)
    for (let i = 0; i < h; i += 1) world.set(x, y + i, z, B.QUARTZ)
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue
        const spot = (dx + dz * 3 + h) % 4 === 0
        if (world.get(x + dx, y + h, z + dz) === B.AIR) world.set(x + dx, y + h, z + dz, spot ? B.WOOL_WHITE : B.WOOL_RED)
      }
    }
    world.set(x, y + h + 1, z, B.WOOL_RED)
    return
  }
  if (map.palms) {
    const h = 5 + Math.floor(rng() * 2)
    for (let i = 0; i < h; i += 1) world.set(x, y + i, z, B.LOG)
    const top = y + h
    world.set(x, top, z, B.LEAVES)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= 2; r += 1) if (world.get(x + dx * r, top, z + dz * r) === B.AIR) world.set(x + dx * r, top, z + dz * r, B.LEAVES)
      if (world.get(x + dx * 3, top - 1, z + dz * 3) === B.AIR) world.set(x + dx * 3, top - 1, z + dz * 3, B.LEAVES)
    }
    return
  }
  if (map.pillars) {
    // A marble column with a gold cap.
    const h = 3 + Math.floor(rng() * 2)
    for (let i = 0; i < h; i += 1) world.set(x, y + i, z, B.QUARTZ)
    world.set(x, y + h, z, B.GOLD)
    return
  }
  if (!map.crown && map.trunk === B.LOG) {
    // A dead tree: a crooked trunk with a stub of a branch.
    const h = 3 + Math.floor(rng() * 2)
    for (let i = 0; i < h; i += 1) world.set(x, y + i, z, B.LOG)
    const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)]
    world.set(x + dx, y + h - 1, z + dz, B.LOG)
    return
  }
  if (map.trunk === B.CACTUS) {
    const h = 2 + Math.floor(rng() * 2)
    for (let i = 0; i < h; i += 1) world.set(x, y + i, z, B.CACTUS)
    return
  }
  const h = 4 + Math.floor(rng() * 2)
  for (let i = 0; i < h; i += 1) world.set(x, y + i, z, map.trunk)
  if (!map.crown) return
  const crown = map.crowns ? map.crowns[Math.floor(rng() * map.crowns.length)] : map.crown
  const cy = y + h - 1
  for (let dy = -1; dy <= 2; dy += 1) {
    const r = dy >= 1 ? 1 : 2
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 2 || rng() < 0.5)) continue
        if (dx === 0 && dz === 0 && dy < 1) continue
        if (world.get(x + dx, cy + dy, z + dz) === B.AIR) world.set(x + dx, cy + dy, z + dz, crown)
      }
    }
  }
}

/** The middle island's landmark, per map. Returns a spot on top for a Mega block. */
function landmark(world, mapId, cx, top, cz) {
  const y0 = top + 1
  const fill = (x0, y0_, z0, x1, y1, z1, id) => {
    for (let y = y0_; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) world.set(x, y, z, id)
  }
  if (mapId === 'desert' || mapId === 'candy') {
    // A stepped pyramid.
    const main = mapId === 'desert' ? B.SANDSTONE : B.CANDY_PINK
    const trim = mapId === 'desert' ? B.GOLD : B.FROSTING
    let r = 4
    let y = y0
    while (r >= 1) {
      fill(cx - r, y, cz - r, cx + r, y, cz + r, r % 2 === 0 ? trim : main)
      r -= 1
      y += 1
    }
    if (mapId === 'candy') {
      for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) fill(cx + dx, y0, cz + dz, cx + dx, y0 + 5, cz + dz, B.CANDY_STRIPE)
    }
    return { x: cx, y, z: cz }
  }
  if (mapId === 'castle') {
    // A keep with four corner towers, battlements, and a gate on each side.
    const wall = (x, y, z) => world.set(x, y, z, (x + y + z) % 5 === 0 ? B.DARKSTONE : B.STONE_BRICKS)
    for (let y = y0; y < y0 + 5; y += 1) {
      for (let x = cx - 4; x <= cx + 4; x += 1) {
        for (let z = cz - 4; z <= cz + 4; z += 1) {
          const edge = Math.abs(x - cx) === 4 || Math.abs(z - cz) === 4
          const gate = (x === cx || z === cz) && y < y0 + 2
          if (edge && !gate) wall(x, y, z)
        }
      }
    }
    fill(cx - 4, y0 + 5, cz - 4, cx + 4, y0 + 5, cz + 4, B.PLANKS)
    for (let x = cx - 4; x <= cx + 4; x += 1) {
      for (let z = cz - 4; z <= cz + 4; z += 1) {
        if ((Math.abs(x - cx) === 4 || Math.abs(z - cz) === 4) && (x + z) % 2 === 0) wall(x, y0 + 6, z)
      }
    }
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      fill(cx + dx - 1, y0, cz + dz - 1, cx + dx + 1, y0 + 7, cz + dz + 1, B.STONE_BRICKS)
      world.set(cx + dx, y0 + 8, cz + dz, B.WOOL_BLUE)
      world.set(cx + dx, y0 + 9, cz + dz, B.WOOL_BLUE)
      world.set(cx + dx, y0 + 7, cz + dz, B.LAMP)
    }
    // Stairs up to the roof inside.
    for (let i = 0; i < 5; i += 1) world.set(cx - 3 + i, y0 + i, cz + 3, B.PLANKS)
    world.set(cx, y0, cz, B.LAMP)
    return { x: cx, y: y0 + 6, z: cz }
  }
  if (mapId === 'ember') {
    // A small volcano: a stepped dark cone with glowing gold seams and a lit crater.
    let y = y0
    for (let r = 6; r >= 2; r -= 1) {
      for (let layer = 0; layer < 2; layer += 1) {
        for (let x = cx - r; x <= cx + r; x += 1) {
          for (let z = cz - r; z <= cz + r; z += 1) {
            const d = Math.hypot(x - cx, z - cz)
            if (d > r + 0.4) continue
            // Glowing seams run down the outside; the crater at the top is hollow and lit.
            const seam = d > r - 0.8 && ((Math.round(Math.atan2(z - cz, x - cx) * 3) + 12) % 4 === 0)
            const crater = r === 2 && d < 1.5
            world.set(x, y, z, crater ? (layer === 0 ? B.LAMP : B.AIR) : seam ? B.GOLD : r % 2 ? B.DARKSTONE : B.STONE)
          }
        }
        y += 1
      }
    }
    for (const [dx, dz] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) world.set(cx + dx, y0, cz + dz, B.LAMP)
    // The Mega block sits on the crater's rim.
    return { x: cx + 2, y, z: cz }
  }
  if (mapId === 'autumn') {
    // One giant autumn tree: a 2x2 trunk, a wide crown in red and gold, a ring of
    // fallen leaves around it.
    for (let y = y0; y < y0 + 8; y += 1) fill(cx, y, cz, cx + 1, y, cz + 1, B.LOG)
    const top = y0 + 8
    for (let dy = -2; dy <= 2; dy += 1) {
      const r = dy === 2 ? 2 : dy === -2 ? 3 : 4
      for (let x = cx - r; x <= cx + 1 + r; x += 1) {
        for (let z = cz - r; z <= cz + 1 + r; z += 1) {
          const ex = Math.max(cx - x, x - cx - 1, 0)
          const ez = Math.max(cz - z, z - cz - 1, 0)
          if (ex * ex + ez * ez > r * r + 1) continue
          if (world.get(x, top + dy, z) === B.AIR) world.set(x, top + dy, z, (x + z + dy) % 3 === 0 ? B.WOOL_RED : B.WOOL_YELLOW)
        }
      }
    }
    for (let a = 0; a < 16; a += 1) {
      const x = Math.round(cx + 0.5 + Math.cos(a / 2.55) * 5)
      const z = Math.round(cz + 0.5 + Math.sin(a / 2.55) * 5)
      if (world.get(x, y0, z) === B.AIR && world.isSolid(x, y0 - 1, z)) world.set(x, y0 - 1, z, a % 2 ? B.WOOL_RED : B.WOOL_YELLOW)
    }
    return { x: cx, y: top + 3, z: cz }
  }
  if (mapId === 'marble') {
    // A temple: a stepped platform, a ring of columns, a gold roof.
    fill(cx - 5, y0, cz - 5, cx + 5, y0, cz + 5, B.QUARTZ)
    fill(cx - 4, y0 + 1, cz - 4, cx + 4, y0 + 1, cz + 4, B.QUARTZ)
    for (const [dx, dz] of [[-4, -4], [-4, 0], [-4, 4], [0, -4], [0, 4], [4, -4], [4, 0], [4, 4]]) {
      fill(cx + dx, y0 + 2, cz + dz, cx + dx, y0 + 5, cz + dz, B.QUARTZ)
    }
    fill(cx - 5, y0 + 6, cz - 5, cx + 5, y0 + 6, cz + 5, B.QUARTZ)
    fill(cx - 3, y0 + 7, cz - 3, cx + 3, y0 + 7, cz + 3, B.GOLD)
    fill(cx - 1, y0 + 8, cz - 1, cx + 1, y0 + 8, cz + 1, B.GOLD)
    world.set(cx, y0 + 2, cz, B.LAMP)
    return { x: cx, y: y0 + 9, z: cz }
  }
  if (mapId === 'jungle') {
    // An overgrown stepped temple with lamps at the corners and a shrine on top.
    let r = 5
    let y = y0
    while (r >= 2) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        for (let z = cz - r; z <= cz + r; z += 1) {
          const edge = Math.abs(x - cx) === r || Math.abs(z - cz) === r
          world.set(x, y, z, edge && (x * 5 + z * 3 + y) % 4 === 0 ? B.LEAVES : edge && (x + z) % 5 === 0 ? B.DARKSTONE : B.STONE_BRICKS)
        }
      }
      for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) world.set(cx + dx, y + 1, cz + dz, B.LAMP)
      r -= 1
      y += 1
    }
    fill(cx - 1, y, cz - 1, cx + 1, y + 1, cz + 1, B.STONE_BRICKS)
    // The Mega block sits in the shrine, open to the sky.
    return { x: cx, y: y + 1, z: cz }
  }
  if (mapId === 'mushroom') {
    // One giant mushroom: a 2x2 pale stem, a wide domed red cap with white spots.
    for (let y = y0; y < y0 + 7; y += 1) fill(cx, y, cz, cx + 1, y, cz + 1, B.QUARTZ)
    const capY = y0 + 7
    for (let dy = 0; dy <= 2; dy += 1) {
      const r = 5 - dy * 2
      for (let x = cx - r; x <= cx + 1 + r; x += 1) {
        for (let z = cz - r; z <= cz + 1 + r; z += 1) {
          const ex = Math.max(cx - x, x - cx - 1, 0)
          const ez = Math.max(cz - z, z - cz - 1, 0)
          if (ex * ex + ez * ez > r * r + 1) continue
          world.set(x, capY + dy, z, (x * 3 + z * 5 + dy) % 7 === 0 ? B.WOOL_WHITE : B.WOOL_RED)
        }
      }
    }
    for (const [dx, dz] of [[-5, 0], [6, 1], [0, -5], [1, 6]]) world.set(cx + dx, y0, cz + dz, B.LAMP)
    return { x: cx, y: capY + 3, z: cz }
  }
  if (mapId === 'tropical') {
    // A lighthouse: a striped round tower with a glass lantern room and a lamp.
    for (let y = y0; y < y0 + 10; y += 1) {
      const stripe = Math.floor((y - y0) / 2) % 2 ? B.WOOL_WHITE : B.WOOL_RED
      for (let x = cx - 2; x <= cx + 2; x += 1) {
        for (let z = cz - 2; z <= cz + 2; z += 1) {
          if (Math.abs(x - cx) === 2 && Math.abs(z - cz) === 2) continue
          world.set(x, y, z, stripe)
        }
      }
    }
    fill(cx - 2, y0 + 10, cz - 2, cx + 2, y0 + 10, cz + 2, B.PLANKS)
    for (let x = cx - 1; x <= cx + 1; x += 1) for (let z = cz - 1; z <= cz + 1; z += 1) world.set(x, y0 + 11, z, x === cx && z === cz ? B.LAMP : B.GLASS)
    fill(cx - 1, y0 + 12, cz - 1, cx + 1, y0 + 12, cz + 1, B.WOOL_RED)
    // A little pool by the tower.
    fill(cx + 4, y0 - 1, cz - 1, cx + 6, y0 - 1, cz + 1, B.WATER)
    return { x: cx, y: y0 + 13, z: cz }
  }
  if (mapId === 'bricktown') {
    // A brick clock tower on a stone square, lamps at the corners.
    fill(cx - 5, y0 - 1, cz - 5, cx + 5, y0 - 1, cz + 5, B.STONE_BRICKS)
    for (let y = y0; y < y0 + 9; y += 1) {
      for (let x = cx - 2; x <= cx + 2; x += 1) {
        for (let z = cz - 2; z <= cz + 2; z += 1) {
          const edge = Math.abs(x - cx) === 2 || Math.abs(z - cz) === 2
          const door = y < y0 + 2 && x === cx && Math.abs(z - cz) === 2
          if (edge && !door) world.set(x, y, z, (y - y0) % 4 === 3 ? B.STONE_BRICKS : B.BRICK)
        }
      }
    }
    // Clock faces: a lamp in the middle of each side, high up.
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) world.set(cx + dx, y0 + 6, cz + dz, B.LAMP)
    fill(cx - 2, y0 + 9, cz - 2, cx + 2, y0 + 9, cz + 2, B.STONE_BRICKS)
    fill(cx - 1, y0 + 10, cz - 1, cx + 1, y0 + 10, cz + 1, B.BRICK)
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) world.set(cx + dx, y0, cz + dz, B.LAMP)
    // Stairs inside up to the roof.
    for (let i = 0; i < 9; i += 1) world.set(cx - 1 + (i % 3), y0 + i, cz - 1 + Math.floor(i / 3) % 3, B.PLANKS)
    return { x: cx, y: y0 + 11, z: cz }
  }
  if (mapId === 'frost') {
    // An ice tower with a lookout on top.
    for (let y = y0; y < y0 + 7; y += 1) {
      for (let x = cx - 3; x <= cx + 3; x += 1) {
        for (let z = cz - 3; z <= cz + 3; z += 1) {
          const d = Math.max(Math.abs(x - cx), Math.abs(z - cz))
          if (d === 3 && !(Math.abs(x - cx) === 3 && Math.abs(z - cz) === 3)) {
            const door = (z === cz && x === cx + 3 && y < y0 + 2) || (x === cx && z === cz - 3 && y < y0 + 2)
            if (!door) world.set(x, y, z, y % 3 === 0 ? B.SNOW : B.ICE)
          }
        }
      }
    }
    fill(cx - 3, y0 + 7, cz - 3, cx + 3, y0 + 7, cz + 3, B.STONE_BRICKS)
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -3], [0, 3], [-3, 0], [3, 0]]) world.set(cx + dx, y0 + 8, cz + dz, B.SNOW)
    world.set(cx, y0, cz, B.LAMP)
    // Stairs up the inside.
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2
      world.set(cx + Math.round(Math.cos(a) * 2), y0 + i, cz + Math.round(Math.sin(a) * 2), B.STONE_BRICKS)
    }
    return { x: cx, y: y0 + 8, z: cz }
  }
  // Meadow: a little temple with a gold roof and lamps.
  fill(cx - 4, y0, cz - 4, cx + 4, y0, cz + 4, B.STONE_BRICKS)
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    fill(cx + dx, y0 + 1, cz + dz, cx + dx, y0 + 4, cz + dz, B.STONE_BRICKS)
    world.set(cx + dx, y0 + 5, cz + dz, B.LAMP)
  }
  fill(cx - 4, y0 + 5, cz - 4, cx + 4, y0 + 5, cz + 4, B.PLANKS)
  fill(cx - 2, y0 + 6, cz - 2, cx + 2, y0 + 6, cz + 2, B.GOLD)
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) world.set(cx + dx, y0 + 5, cz + dz, B.LAMP)
  return { x: cx, y: y0 + 7, z: cz }
}

/** Free top cells of an island for decorations, away from `avoid` columns. */
function freeTops(world, cells, avoid, top) {
  return cells.filter((c) => !c.edge && world.get(c.x, top + 1, c.z) === B.AIR && !avoid.some((a) => Math.abs(a.x - c.x) <= 1 && Math.abs(a.z - c.z) <= 1))
}

/**
 * Builds a round's world.
 * @returns {{ world: VoxelWorld, spawns: {x,y,z}[], lucky: {x,y,z,rare}[], middle: {x,y,z} }}
 *   spawns are cage floors' standing spots (feet), one per island, in ring order.
 */
export function generateMatch(mapId, seed, modeId = 'classic') {
  const map = MAPS[mapId] || MAPS.meadow
  const mode = MODES[modeId] || MODES.classic
  const rng = mulberry32(seed)
  const world = new VoxelWorld(MATCH_SIZE.x, MATCH_SIZE.y, MATCH_SIZE.z)
  const spawns = []
  const lucky = []
  const luckyId = (rare) => (rare ? B.LUCKY_RARE : B.LUCKY)

  // Spawn islands.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2
    const cx = Math.round(CENTER.x + Math.cos(a) * SPAWN_RING)
    const cz = Math.round(CENTER.z + Math.sin(a) * SPAWN_RING)
    const cells = island(world, rng, map, cx, cz, 5.6, ISLAND_TOP, 9)
    // Cage above the middle of the island.
    const floorY = ISLAND_TOP + 5
    world.set(cx, floorY, cz, B.CAGE)
    for (let y = floorY + 1; y <= floorY + 3; y += 1) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.set(cx + dx, y, cz + dz, B.CAGE)
    }
    world.set(cx, floorY + 4, cz, B.CAGE)
    spawns.push({ x: cx + 0.5, y: floorY + 1, z: cz + 0.5 })

    // Lucky blocks in a loose triangle around the middle, never under the cage.
    const avoid = [{ x: cx, z: cz }]
    const count = mode.luckyPerIsland
    for (let k = 0; k < count; k += 1) {
      const la = a + Math.PI + ((k - (count - 1) / 2) * 1.5) + (rng() - 0.5) * 0.3
      const lx = Math.round(cx + Math.cos(la) * 2.6)
      const lz = Math.round(cz + Math.sin(la) * 2.6)
      if (world.get(lx, ISLAND_TOP, lz) === B.AIR) continue
      const rare = rng() < mode.rareChance
      world.set(lx, ISLAND_TOP + 1, lz, luckyId(rare))
      lucky.push({ x: lx, y: ISLAND_TOP + 1, z: lz, rare })
      avoid.push({ x: lx, z: lz })
    }
    // A tree at the back, and a few flowers.
    const free = freeTops(world, cells, avoid, ISLAND_TOP)
    const back = free
      .map((c) => ({ c, d: Math.hypot(c.x - (cx + Math.cos(a) * 3), c.z - (cz + Math.sin(a) * 3)) }))
      .sort((p, q) => p.d - q.d)[0]
    if (back) {
      tree(world, map, back.c.x, ISLAND_TOP + 1, back.c.z, rng)
      avoid.push(back.c)
    }
    for (const c of freeTops(world, cells, avoid, ISLAND_TOP)) {
      if (rng() < (map.decoChance ?? 0.12)) world.set(c.x, ISLAND_TOP + 1, c.z, map.deco[Math.floor(rng() * map.deco.length)])
    }
  }

  // Islets between the spawn islands, one lucky block each.
  for (let i = 0; i < 4; i += 1) {
    const a = ((i + 0.5) / 4) * Math.PI * 2 + Math.PI / 8
    const cx = Math.round(CENTER.x + Math.cos(a) * ISLET_RING)
    const cz = Math.round(CENTER.z + Math.sin(a) * ISLET_RING)
    const top = ISLAND_TOP - 1
    island(world, rng, map, cx, cz, 2.6, top, 4)
    const rare = rng() < Math.max(0.3, mode.rareChance)
    world.set(cx, top + 1, cz, luckyId(rare))
    lucky.push({ x: cx, y: top + 1, z: cz, rare })
  }

  // The middle island.
  const midTop = ISLAND_TOP + 1
  const midCells = island(world, rng, map, CENTER.x, CENTER.z, 11, midTop, 13)
  const peak = landmark(world, mapId, CENTER.x, midTop, CENTER.z)
  world.set(peak.x, peak.y, peak.z, B.LUCKY_RARE)
  lucky.push({ x: peak.x, y: peak.y, z: peak.z, rare: true })
  for (let k = 0; k < 4; k += 1) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    const lx = Math.round(CENTER.x + Math.cos(a) * 7)
    const lz = Math.round(CENTER.z + Math.sin(a) * 7)
    if (world.get(lx, midTop, lz) === B.AIR || world.get(lx, midTop + 1, lz) !== B.AIR) continue
    world.set(lx, midTop + 1, lz, B.LUCKY_RARE)
    lucky.push({ x: lx, y: midTop + 1, z: lz, rare: true })
  }
  const midFree = freeTops(world, midCells, lucky, midTop).filter((c) => Math.hypot(c.x - CENTER.x, c.z - CENTER.z) > 6)
  for (const c of midFree) {
    if (rng() < 0.03) tree(world, map, c.x, midTop + 1, c.z, rng)
    else if (rng() < (map.decoChance ?? 0.1)) world.set(c.x, midTop + 1, c.z, map.deco[Math.floor(rng() * map.deco.length)])
  }

  return { world, spawns, lucky, middle: { x: CENTER.x + 0.5, y: midTop + 1, z: CENTER.z + 0.5 } }
}

// --- The lobby ----------------------------------------------------------------------------

export const LOBBY_SIZE = { x: 72, y: 40, z: 72 }
export const LOBBY_TOP = 20

/**
 * The lobby: a meadow island with a stone plaza round a giant lucky block monument,
 * paths lit by lamp posts, two fountains, market-stall case stations, hedges, flower
 * beds, banners and the leaderboard wall. Static: nobody can break or place blocks here.
 */
export function generateLobby() {
  const map = MAPS.meadow
  const rng = mulberry32(1337)
  const world = new VoxelWorld(LOBBY_SIZE.x, LOBBY_SIZE.y, LOBBY_SIZE.z)
  const cx = 36
  const cz = 36
  const top = LOBBY_TOP
  const cells = island(world, rng, map, cx, cz, 25, top, 14)
  const set = (x, y, z, id) => world.set(x, y, z, id)
  const fill = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) set(x, y, z, id)
  }
  const onIsland = (x, z) => world.isSolid(x, top, z)
  const lamp = (x, z, h = 2) => {
    if (!onIsland(x, z)) return
    for (let y = 1; y <= h; y += 1) set(x, top + y, z, B.LOG)
    set(x, top + h + 1, z, B.LAMP)
  }

  // Plaza: stone bricks with a quartz rim, round the middle.
  for (const c of cells) {
    const d = Math.hypot(c.x - cx, c.z - cz)
    if (d <= 9.4) set(c.x, top, c.z, B.STONE_BRICKS)
    else if (d <= 10.5) set(c.x, top, c.z, B.QUARTZ)
  }
  // Paths out to the four edges, three wide.
  for (const c of cells) {
    const d = Math.hypot(c.x - cx, c.z - cz)
    if (d > 10.5 && d < 23 && (Math.abs(c.x - cx) <= 1 || Math.abs(c.z - cz) <= 1)) set(c.x, top, c.z, B.PATH)
  }

  // The monument: quartz and gold steps, the giant lucky block, lamps at the corners.
  fill(cx - 3, top + 1, cz - 3, cx + 3, top + 1, cz + 3, B.QUARTZ)
  fill(cx - 2, top + 2, cz - 2, cx + 2, top + 2, cz + 2, B.GOLD)
  fill(cx - 1, top + 3, cz - 1, cx + 1, top + 5, cz + 1, B.LUCKY)
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    fill(cx + dx, top + 2, cz + dz, cx + dx, top + 3, cz + dz, B.QUARTZ)
    set(cx + dx, top + 4, cz + dz, B.LAMP)
  }

  // Banners round the plaza.
  const bannerColors = [B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW, B.WOOL_WHITE]
  for (let i = 0; i < 8; i += 1) {
    const a = ((i + 0.5) / 8) * Math.PI * 2
    const x = Math.round(cx + Math.cos(a) * 9.6)
    const z = Math.round(cz + Math.sin(a) * 9.6)
    fill(x, top + 1, z, x, top + 4, z, B.LOG)
    set(x, top + 5, z, B.LAMP)
    const col = bannerColors[i % bannerColors.length]
    const ox = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? 0 : Math.sign(Math.cos(a)) || 1
    const oz = ox === 0 ? Math.sign(Math.sin(a)) || 1 : 0
    set(x + ox, top + 4, z + oz, col)
    set(x + ox, top + 3, z + oz, col)
  }

  // Lamp posts along the paths, both sides.
  for (const r of [14, 19]) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const px = cx + dx * r
      const pz = cz + dz * r
      lamp(px + dz * 3, pz + dx * 3)
      lamp(px - dz * 3, pz - dx * 3)
    }
  }

  // Fountains in the two back quadrants: a stone rim, water, a quartz spout.
  const fountain = (fx, fz) => {
    fill(fx - 3, top, fz - 3, fx + 3, top, fz + 3, B.STONE_BRICKS)
    for (let x = fx - 3; x <= fx + 3; x += 1) {
      for (let z = fz - 3; z <= fz + 3; z += 1) {
        const rim = Math.abs(x - fx) === 3 || Math.abs(z - fz) === 3
        set(x, top + 1, z, rim ? B.STONE_BRICKS : B.WATER)
      }
    }
    fill(fx, top + 1, fz, fx, top + 3, fz, B.QUARTZ)
    set(fx, top + 4, fz, B.WATER)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) set(fx + dx, top + 3, fz + dz, B.WATER)
    // Benches facing it.
    for (const [bx, bz] of [[fx - 5, fz], [fx + 5, fz]]) if (onIsland(bx, bz)) fill(bx, top + 1, bz - 1, bx, top + 1, bz + 1, B.PLANKS)
  }
  fountain(cx - 13, cz - 9)
  fountain(cx + 13, cz - 9)

  // Case stations: market stalls with striped roofs, the case floating inside.
  const stations = []
  const stall = (x, z, id, block, stripe) => {
    fill(x - 3, top, z - 3, x + 3, top, z + 3, B.STONE_BRICKS)
    fill(x - 1, top + 1, z - 1, x + 1, top + 1, z + 1, block)
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) fill(x + dx, top + 1, z + dz, x + dx, top + 4, z + dz, B.LOG)
    for (let dx = -3; dx <= 3; dx += 1) for (let dz = -3; dz <= 3; dz += 1) set(x + dx, top + 5, z + dz, (dx + 3) % 2 ? B.WOOL_WHITE : stripe)
    for (let dx = -2; dx <= 2; dx += 1) set(x + dx, top + 6, z, (dx + 2) % 2 ? B.WOOL_WHITE : stripe)
    set(x - 3, top + 1, z - 4, B.LAMP)
    set(x + 3, top + 1, z - 4, B.LAMP)
    stations.push({ id, x: x + 0.5, y: top + 2, z: z + 0.5, r: 4 })
  }
  stall(cx - 12, cz + 9, 'case:cape', B.GOLD, B.WOOL_YELLOW)
  stall(cx + 12, cz + 9, 'case:sword', B.WOOL_BLUE, B.WOOL_BLUE)

  // Leaderboard wall at the back, framed in quartz with lamps.
  const boardZ = cz - 17
  for (let x = cx - 7; x <= cx + 7; x += 1) {
    for (let y = top + 1; y <= top + 8; y += 1) {
      const frame = x === cx - 7 || x === cx + 7 || y === top + 1 || y === top + 8
      set(x, y, boardZ, frame ? B.QUARTZ : B.DARKSTONE)
    }
  }
  set(cx - 7, top + 9, boardZ, B.LAMP)
  set(cx + 7, top + 9, boardZ, B.LAMP)

  // A hedge ring with gaps for the paths and the stations, flower beds inside it.
  const avoid = [...stations, { x: cx - 13, z: cz - 9 }, { x: cx + 13, z: cz - 9 }]
  const nearSomething = (x, z, r) => avoid.some((a) => Math.hypot(a.x - x, a.z - z) < r)
  for (const c of cells) {
    const d = Math.hypot(c.x - cx, c.z - cz)
    const onPath = Math.abs(c.x - cx) <= 2 || Math.abs(c.z - cz) <= 2
    if (world.get(c.x, top, c.z) !== map.top || c.edge || onPath || nearSomething(c.x, c.z, 5.5)) continue
    if (world.get(c.x, top + 1, c.z) !== B.AIR) continue
    if (d > 20.5 && d < 21.5) set(c.x, top + 1, c.z, B.LEAVES)
    else if (d > 11.5 && d < 13 && rng() < 0.55) set(c.x, top + 1, c.z, rng() < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW)
    else if (d > 15 && d < 20 && rng() < 0.03) tree(world, map, c.x, top + 1, c.z, rng)
    else if (rng() < 0.1) set(c.x, top + 1, c.z, map.deco[Math.floor(rng() * map.deco.length)])
  }

  return {
    world,
    spawn: { x: cx + 0.5, y: top + 1, z: cz + 11.5 },
    stations,
    board: { x: cx + 0.5, y: top + 4.5, z: boardZ + 1.02, w: 13, h: 6 },
    center: { x: cx, z: cz },
  }
}
