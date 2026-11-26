import { ATTACK_COOLDOWN_MS, BOT_LEVELS, breakSeconds, ITEMS, PROJECTILES } from './balance.js'
import { CENTER } from './maps.js'
import { stepBody } from './physics.js'
import { BLOCKS, isLucky, raycastVoxels, isSolidBlock } from './voxel.js'

/**
 * Bots that fill empty islands. They play by the same rules as people - the same
 * physics, reach, hotbar and cooldowns, through the same host functions - only their
 * "input" comes from here: open your lucky blocks, bridge to the middle, fight whoever
 * comes close, drink what you find, pillar up when the lava gets near.
 *
 * They are tuned to be beatable: slower to react, they miss sometimes, and hit a
 * little softer (host.melee).
 */

/** The direction you face for a yaw (matches the client camera). */
export const forwardOf = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
export const yawToward = (dx, dz) => Math.atan2(-dx, -dz)

export function createBrain(random, level = 'normal') {
  const lv = BOT_LEVELS[level] || BOT_LEVELS.normal
  return {
    random,
    /** Slower or quicker to swing, by difficulty. */
    reaction: lv.reaction,
    goal: 'loot',
    target: null,
    thinkAt: 0,
    digUntil: 0,
    digKey: null,
    placeAt: 0,
    swingAt: 0,
    strafe: random() < 0.5 ? 1 : -1,
    strafeAt: 0,
    skill: lv.skill[0] + random() * (lv.skill[1] - lv.skill[0]),
    stuckSince: 0,
    lastX: 0,
    lastZ: 0,
    wander: null,
    pillarY: null,
    shootAt: 0,
    // Personality: how far they'll go for a fight, and how soon they run when hurt.
    aggression: 1 + random() * 0.5,
    caution: random(),
    retreatUntil: 0,
    retreatReadyAt: 0,
    backUntil: 0,
  }
}

const findSlot = (ent, test) => ent.inv.findIndex((s) => s && test(ITEMS[s.id], s))
const blockCount = (ent) => ent.inv.reduce((n, s) => n + (s && ITEMS[s.id].kind === 'block' ? s.n : 0), 0)

function bestWeaponSlot(ent) {
  let best = -1
  let dmg = 0
  ent.inv.forEach((s, i) => {
    const item = s && ITEMS[s.id]
    if (item && (item.kind === 'sword' || item.kind === 'tool') && item.dmg > dmg) {
      best = i
      dmg = item.dmg
    }
  })
  return best
}

/** Is there ground to walk on all the way from (x, z) to (tx, tz) at about height y? */
function walkable(world, x, y, z, tx, tz) {
  const d = Math.hypot(tx - x, tz - z)
  const steps = Math.ceil(d / 0.7)
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const cx = Math.floor(x + (tx - x) * t)
    const cz = Math.floor(z + (tz - z) * t)
    let ground = false
    for (let gy = Math.floor(y) + 1; gy >= Math.floor(y) - 3; gy -= 1) {
      if (world.isSolid(cx, gy, cz)) {
        ground = true
        break
      }
    }
    if (!ground) return false
  }
  return true
}

/**
 * Cells to bridge into, best first: beside a solid block we stand on, one step along
 * the main axis of our heading, then along the other axis.
 */
function bridgeCells(world, b, fy, mx, mz) {
  const out = []
  const sx = Math.sign(mx) || 1
  const sz = Math.sign(mz) || 1
  const unders = []
  for (const ox of [-0.29, 0.29]) {
    for (const oz of [-0.29, 0.29]) {
      const ux = Math.floor(b.x + ox)
      const uz = Math.floor(b.z + oz)
      if (world.isSolid(ux, fy, uz) && !unders.some(([x, z]) => x === ux && z === uz)) unders.push([ux, uz])
    }
  }
  const xFirst = Math.abs(mx) >= Math.abs(mz)
  for (const [ux, uz] of unders) {
    const a = [ux + sx, uz]
    const c = [ux, uz + sz]
    out.push(...(xFirst ? [a, c] : [c, a]))
  }
  return out
}

/** How many cells along the way from (x, z) to (tx, tz) have no floor (blocks needed). */
function gapCells(world, x, y, z, tx, tz) {
  const d = Math.hypot(tx - x, tz - z)
  const steps = Math.ceil(d)
  const fy = Math.floor(y + 0.01) - 1
  let gaps = 0
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const cx = Math.floor(x + (tx - x) * t)
    const cz = Math.floor(z + (tz - z) * t)
    if (!world.isSolid(cx, fy, cz) && !world.isSolid(cx, fy + 1, cz) && !world.isSolid(cx, fy - 1, cz)) gaps += 1
  }
  return gaps
}

/** A ground block near us that gives a block item when broken, not the one we stand on. */
function mineTarget(world, b) {
  const fy = Math.floor(b.y + 0.01) - 1
  let best = null
  let bestD = Infinity
  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dz = -3; dz <= 3; dz += 1) {
      const x = Math.floor(b.x) + dx
      const z = Math.floor(b.z) + dz
      for (const y of [fy + 1, fy]) {
        const id = world.get(x, y, z)
        const def = BLOCKS[id]
        if (!def?.drop || !Number.isFinite(def.hard) || def.hard > 1) continue
        const d = Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z)
        if (y === fy && d < 1.6) continue
        // Keep a floor around: only dig ground with ground beneath it.
        if (y === fy && !world.isSolid(x, y - 1, z)) continue
        if (d < bestD) {
          best = { x, y, z }
          bestD = d
        }
      }
    }
  }
  return best
}

function decide(host, ent, now) {
  const m = host.match
  const brain = ent.brain
  const w = m.world
  const b = ent.body

  // Use what's useful right away: potions, hearts; heal when hurt.
  for (let i = 0; i < ent.inv.length; i += 1) {
    const s = ent.inv[i]
    const item = s && ITEMS[s.id]
    if (!item) continue
    if ((item.kind === 'potion' && item.effect) || item.kind === 'heart') {
      host.useItem(ent, i, [0, 0, 0])
      return
    }
    if ((item.kind === 'food' || item.heal) && ent.hp < ent.maxHp * 0.5) {
      host.useItem(ent, i, [0, 0, 0])
      return
    }
  }

  const blocks = blockCount(ent)
  // Lava coming: build up.
  if (b.y < m.lavaY + 2.5 && blocks > 0) {
    brain.goal = 'pillar'
    return
  }
  // Still running away: keep running.
  if (brain.goal === 'retreat' && now < brain.retreatUntil && host.ents.get(brain.target)?.alive) return

  // Someone close: fight (or shoot) them.
  let enemy = null
  let enemyDist = Infinity
  for (const e of host.ents.values()) {
    if (e === ent || e.zone !== 'match' || !e.alive || e.team === ent.team) continue
    const d = Math.hypot(e.x - b.x, e.z - b.z)
    if (d < enemyDist && Math.abs(e.y - b.y) < 6) {
      enemy = e
      enemyDist = d
    }
  }
  // Badly hurt, losing, with them right there: back off for a moment.
  if (enemy && enemyDist < 5 && brain.caution > 0.45 && now > brain.retreatReadyAt && ent.hp <= ent.maxHp * 0.25 && ent.hp < enemy.hp) {
    brain.goal = 'retreat'
    brain.target = enemy.eid
    brain.retreatUntil = now + 1000 + brain.random() * 1000
    brain.retreatReadyAt = now + 9000
    return
  }
  // Of those we can walk to within fighting range, go for the weak (and stay on the
  // one we're already fighting).
  let foe = null
  let foeScore = Infinity
  const range = 11 * brain.aggression
  for (const e of host.ents.values()) {
    if (e === ent || e.zone !== 'match' || !e.alive || e.team === ent.team) continue
    const d = Math.hypot(e.x - b.x, e.z - b.z)
    if (d >= range || Math.abs(e.y - b.y) >= 2.5) continue
    const score = d + (e.hp / (e.maxHp || 20)) * 3 - (e.eid === brain.target ? 2 : 0)
    if (score < foeScore && walkable(w, b.x, b.y, b.z, e.x, e.z)) {
      foe = e
      foeScore = score
    }
  }
  const bowSlot = findSlot(ent, (item) => item.kind === 'bow')
  if (foe) {
    brain.goal = 'fight'
    brain.target = foe.eid
    return
  }
  // No sniping in the first seconds: give new players time to open their blocks.
  const settled = now - m.fightStart > 25_000
  if (enemy && settled && bowSlot >= 0 && enemyDist < 20 && now > brain.shootAt) {
    const e = host.eye(ent)
    const tx = enemy.x - e.x
    const ty = enemy.y + 1.2 - e.y
    const tz = enemy.z - e.z
    const hit = raycastVoxels(w, e.x, e.y, e.z, tx, ty, tz, Math.hypot(tx, ty, tz), isSolidBlock)
    if (!hit) {
      brain.goal = 'shoot'
      brain.target = enemy.eid
      return
    }
  }

  // A lucky block we can walk to.
  let best = null
  let bestD = Infinity
  for (const l of m.lucky) {
    if (!isLucky(w.get(l.x, l.y, l.z))) continue
    const d = Math.hypot(l.x + 0.5 - b.x, l.z + 0.5 - b.z)
    if (d < bestD && Math.abs(l.y - b.y) < 2.5 && d < 40 && walkable(w, b.x, b.y, b.z, l.x + 0.5, l.z + 0.5)) {
      best = l
      bestD = d
    }
  }
  if (best) {
    brain.goal = 'loot'
    brain.target = best
    return
  }

  // Head for the middle, or for whoever is left - with enough blocks to get there.
  const onMiddle = Math.hypot(b.x - CENTER.x, b.z - CENTER.z) < 10
  const dest = !onMiddle ? { x: CENTER.x + 0.5, z: CENTER.z + 0.5 } : enemy ? { x: enemy.x, z: enemy.z } : null
  if (dest) {
    const need = gapCells(w, b.x, b.y, b.z, dest.x, dest.z)
    if (need === 0 && enemy && onMiddle) {
      brain.goal = 'fight'
      brain.target = enemy.eid
      return
    }
    if (blocks >= need + 2 || (brain.goal === 'bridge' && blocks > 0)) {
      brain.goal = 'bridge'
      brain.target = dest
      return
    }
  }
  // Not enough blocks: dig some out of the ground around us.
  const mine = mineTarget(w, b)
  if (mine) {
    brain.goal = 'mine'
    brain.target = mine
    return
  }
  if (enemy && walkable(w, b.x, b.y, b.z, enemy.x, enemy.z)) {
    brain.goal = 'fight'
    brain.target = enemy.eid
    return
  }
  brain.goal = 'wander'
  if (!brain.wander || brain.random() < 0.2) {
    const a = brain.random() * Math.PI * 2
    brain.wander = { x: b.x + Math.cos(a) * 3, z: b.z + Math.sin(a) * 3 }
  }
}

/** Runs one bot for `dt` seconds: decide, then move and act like a player would. */
export function thinkBot(host, ent, dt, now) {
  const m = host.match
  const w = m.world
  const b = ent.body
  const brain = ent.brain
  if (now >= brain.thinkAt) {
    brain.thinkAt = now + 260 + brain.random() * 200
    decide(host, ent, now)
  }

  const input = { moveX: 0, moveZ: 0, jump: false, sprint: false, sneak: false, guard: false, autoJump: true }
  let face = null
  const moveTo = (tx, tz, stop = 0.4) => {
    const dx = tx - b.x
    const dz = tz - b.z
    const d = Math.hypot(dx, dz)
    face = { dx, dz }
    if (d <= stop) return d
    input.moveX = dx / d
    input.moveZ = dz / d
    return d
  }

  switch (brain.goal) {
    case 'fight': {
      const t = host.ents.get(brain.target)
      if (!t || !t.alive || t.zone !== 'match') {
        brain.thinkAt = 0
        break
      }
      const d = Math.hypot(t.x - b.x, t.z - b.z)
      const weapon = bestWeaponSlot(ent)
      if (weapon >= 0 && ent.sel !== weapon) {
        ent.sel = weapon
        ent.dirty = true
      }
      if (now < brain.backUntil) {
        // Hit and step back (better bots): out of their reach while our swing recharges.
        face = { dx: t.x - b.x, dz: t.z - b.z }
        const len = d || 1
        input.moveX = -face.dx / len
        input.moveZ = -face.dz / len
        input.guard = true
      } else if (d > 2.3) {
        moveTo(t.x, t.z, 2.2)
        input.sprint = d > 4
      } else {
        // Circle them, but never strafe off an edge.
        input.guard = true
        face = { dx: t.x - b.x, dz: t.z - b.z }
        if (now > brain.strafeAt) {
          brain.strafe = brain.random() < 0.5 ? 1 : -1
          brain.strafeAt = now + 600 + brain.random() * 900
        }
        const len = d || 1
        input.moveX = (-face.dz / len) * brain.strafe * 0.7
        input.moveZ = (face.dx / len) * brain.strafe * 0.7
        if (brain.random() < 0.04) input.jump = true
      }
      const reach = Math.hypot(t.x - b.x, t.y - b.y, t.z - b.z)
      const wait = (ATTACK_COOLDOWN_MS + (1 - brain.skill) * 500 + brain.random() * 250) * brain.reaction
      if (reach < 3.1 && now - ent.lastAttackAt > wait) {
        if (brain.random() < brain.skill + 0.1) {
          host.melee(ent, t)
          if (brain.skill > 0.75 && brain.random() < 0.35) brain.backUntil = now + 200
        } else {
          ent.lastAttackAt = now
          host.toZone('match', 'swing', { eid: ent.eid })
        }
      }
      break
    }
    case 'retreat': {
      const t = host.ents.get(brain.target)
      if (!t || !t.alive || now >= brain.retreatUntil) {
        brain.thinkAt = 0
        break
      }
      const dx = b.x - t.x
      const dz = b.z - t.z
      const len = Math.hypot(dx, dz) || 1
      moveTo(b.x + (dx / len) * 4, b.z + (dz / len) * 4, 0.2)
      input.sprint = true
      input.guard = true
      // Cornered (nowhere to run): turn and fight.
      if (Math.hypot(b.x - brain.lastX, b.z - brain.lastZ) < 0.005 && len < 2.5) {
        brain.goal = 'fight'
        brain.thinkAt = now + 800
      }
      break
    }
    case 'shoot': {
      const t = host.ents.get(brain.target)
      const slot = findSlot(ent, (item) => item.kind === 'bow')
      if (!t || !t.alive || slot < 0) {
        brain.thinkAt = 0
        break
      }
      face = { dx: t.x - b.x, dz: t.z - b.z }
      if (now > brain.shootAt) {
        ent.sel = slot
        ent.dirty = true
        const e = host.eye(ent)
        const dx = t.x - e.x
        const dz = t.z - e.z
        const dist = Math.hypot(dx, dz)
        const time = dist / PROJECTILES.arrow.speed
        const err = (1 - brain.skill) * 0.12
        const dy = t.y + 1.1 - e.y + 0.5 * PROJECTILES.arrow.gravity * time * time
        host.useItem(ent, slot, [dx / dist + (brain.random() - 0.5) * err, dy / dist, dz / dist + (brain.random() - 0.5) * err], 1)
        brain.shootAt = now + 1300 + brain.random() * 900
        brain.thinkAt = now + 300
      }
      break
    }
    case 'mine':
    case 'loot': {
      const l = brain.target
      const id = l ? w.get(l.x, l.y, l.z) : 0
      if (!l || (brain.goal === 'loot' ? !isLucky(id) : !BLOCKS[id]?.drop)) {
        brain.thinkAt = 0
        brain.digUntil = 0
        break
      }
      const d = moveTo(l.x + 0.5, l.z + 0.5, brain.goal === 'mine' ? 2.2 : 1.5)
      if (d <= (brain.goal === 'mine' ? 3 : 1.6)) {
        const key = `${l.x},${l.y},${l.z}`
        if (brain.digKey !== key) {
          brain.digKey = key
          host.toWatchers(ent, 'act', { eid: ent.eid, kind: 'dig', x: l.x, y: l.y, z: l.z })
          brain.digUntil = now + breakSeconds(BLOCKS[w.get(l.x, l.y, l.z)].hard, 'fist') * 1000 * (1.2 + brain.random() * 0.5)
        }
        if (now > brain.swingAt) {
          brain.swingAt = now + 260
          host.toZone('match', 'swing', { eid: ent.eid })
        }
        if (now >= brain.digUntil) {
          brain.digKey = null
          host.breakBlock(ent, l.x, l.y, l.z)
          brain.thinkAt = now + 200
        }
      }
      break
    }
    case 'bridge': {
      const t = brain.target
      if (!t) {
        brain.thinkAt = 0
        break
      }
      moveTo(t.x, t.z, 1)
      break
    }
    case 'pillar': {
      const slot = findSlot(ent, (item) => item.kind === 'block')
      if (slot < 0) {
        brain.thinkAt = 0
        break
      }
      ent.sel = slot
      if (b.onGround) {
        brain.pillarY = Math.floor(b.y)
        input.jump = true
      } else if (brain.pillarY !== null && b.y >= brain.pillarY + 1.02 && now > brain.placeAt) {
        const bx = Math.floor(b.x)
        const bz = Math.floor(b.z)
        if (host.canPlaceAt(bx, brain.pillarY, bz) && host.placeBlock(ent, bx, brain.pillarY, bz)) brain.placeAt = now + 150
      }
      if (b.y > m.lavaY + 5) brain.thinkAt = 0
      break
    }
    default:
      if (brain.wander) moveTo(brain.wander.x, brain.wander.z, 0.6)
  }

  // Edge safety: never walk off into the lava - unless bridging, which builds the floor first.
  if (input.moveX || input.moveZ) {
    const ax = b.x + input.moveX * 0.6
    const az = b.z + input.moveZ * 0.6
    const fy = Math.floor(b.y + 0.01) - 1
    const ground = w.isSolid(ax, fy, az) || w.isSolid(ax, fy - 1, az) || w.isSolid(ax, fy + 1, az)
    if (!ground && b.onGround) {
      const slot = findSlot(ent, (item) => item.kind === 'block')
      if ((brain.goal === 'bridge' || brain.goal === 'fight') && slot >= 0) {
        input.sneak = true
        input.sprint = false
        if (now > brain.placeAt) {
          ent.sel = slot
          // Build onto the side of the block we stand on, along the way we're heading
          // (a diagonal cell would touch nothing and couldn't be placed).
          for (const [cx, cz] of bridgeCells(w, b, fy, input.moveX, input.moveZ)) {
            if (host.canPlaceAt(cx, fy, cz) && host.placeBlock(ent, cx, fy, cz)) break
          }
          brain.placeAt = now + 170 + brain.random() * 120
        }
      } else {
        input.moveX = 0
        input.moveZ = 0
        brain.thinkAt = Math.min(brain.thinkAt, now + 100)
      }
    }
  }

  // Stuck against something: hop, then pick something else to do.
  const moved = Math.hypot(b.x - brain.lastX, b.z - brain.lastZ)
  brain.lastX = b.x
  brain.lastZ = b.z
  if ((input.moveX || input.moveZ) && moved < 0.01 * dt * 60) {
    if (!brain.stuckSince) brain.stuckSince = now
    // Hop over whatever's in the way - but never hop at an edge.
    if (now - brain.stuckSince > 700 && !input.sneak) input.jump = true
    if (now - brain.stuckSince > 2500) {
      brain.stuckSince = 0
      brain.goal = 'wander'
      brain.wander = { x: b.x + (brain.random() - 0.5) * 6, z: b.z + (brain.random() - 0.5) * 6 }
      brain.thinkAt = now + 1500
    }
  } else {
    brain.stuckSince = 0
  }

  const fx = ent.effects
  stepBody(w, b, input, dt, fx.speed > now ? 1.35 : 1, fx.jump > now ? 1.3 : 1)
  ent.x = b.x
  ent.y = b.y
  ent.z = b.z
  if (face && (face.dx || face.dz)) ent.yaw = yawToward(face.dx, face.dz)
  ent.pitch = 0
  ent.anim = !b.onGround ? 4 : input.sneak ? 3 : input.moveX || input.moveZ ? (input.sprint ? 2 : 1) : 0
}
