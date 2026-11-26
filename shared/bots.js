import { BOT_LEVELS, HOTBAR, ITEMS, MELEE_KINDS, OFFHAND, PROJECTILES } from './balance.js'
import { stepBody } from './physics.js'
import { isSolidBlock, raycastVoxels } from './voxel.js'

/**
 * Bots: duel opponents when nobody else is queued, and Spirelands regulars. They play by
 * the same rules as people - the same physics, reach, hotbar, cooldowns and armour,
 * through the same host functions - only their "input" comes from here: close in,
 * strafe, time hits around the no-damage window, w-tap, jump for crits, raise a shield,
 * break shields with an axe, launch with a gust charge and smash with the mace, lunge
 * with the spear, shoot from range, eat and throw potions when hurt.
 *
 * Tuned to be beatable: slower to react, they miss sometimes, and hit a little softer
 * (host.melee).
 */

/** The direction you face for a yaw (matches the client camera). */
export const forwardOf = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
export const yawToward = (dx, dz) => Math.atan2(-dx, -dz)

export function createBrain(random, level = 'normal') {
  const lv = BOT_LEVELS[level] || BOT_LEVELS.normal
  return {
    random,
    reaction: lv.reaction,
    skill: lv.skill[0] + random() * (lv.skill[1] - lv.skill[0]),
    target: 0,
    thinkAt: 0,
    strafe: random() < 0.5 ? 1 : -1,
    strafeAt: 0,
    stuckSince: 0,
    lastX: 0,
    lastZ: 0,
    wander: null,
    shootAt: 0,
    eatUntil: 0,
    eatSlot: -1,
    backUntil: 0,
    blockUntil: 0,
    blockReadyAt: 0,
    comboUntil: 0,
    gustAt: 0,
    nextSwingAt: 0,
    potsAt: 0,
  }
}

/** A hotbar slot whose item passes `test` (bots don't rummage in the bag), or -1. */
const findSlot = (ent, test) => ent.inv.findIndex((s, i) => i < HOTBAR && s && test(ITEMS[s.id], s))

function select(ent, slot) {
  if (slot >= 0 && ent.sel !== slot) {
    ent.sel = slot
    ent.dirty = true
  }
}

/** The weapon slot to hit with now. */
function weaponFor(ent, target, falling) {
  const has = (kind) => findSlot(ent, (item) => item.kind === kind)
  if (target?.blocking && has('axe') >= 0) return has('axe')
  if (falling && has('mace') >= 0) return has('mace')
  for (const kind of ['sword', 'axe', 'spear', 'mace']) {
    const s = has(kind)
    if (s >= 0) return s
  }
  return -1
}

/** Who to fight: the other duellist, or in Spirelands the nearest (sticking with the last). */
function pickTarget(host, arena, ent, brain) {
  let best = null
  let bestD = Infinity
  for (const e of host.ents.values()) {
    if (e === ent || e.arena !== arena.key || e.zone !== 'match' || !e.alive) continue
    const d = Math.hypot(e.x - ent.x, e.z - ent.z) - (e.eid === brain.target ? 6 : 0)
    if (arena.kind === 'ffa' && d > 34) continue
    if (d < bestD) {
      best = e
      bestD = d
    }
  }
  return best
}

/** Runs one bot for `dt` seconds: decide, then move and act like a player would. */
export function thinkBot(host, arena, ent, dt, now) {
  const w = arena.world
  const b = ent.body
  const brain = ent.brain
  const input = { moveX: 0, moveZ: 0, jump: false, sprint: false, sneak: false, guard: true, autoJump: true }
  let face = null

  if (now >= brain.thinkAt) {
    brain.thinkAt = now + 220 + brain.random() * 160
    const t = pickTarget(host, arena, ent, brain)
    brain.target = t ? t.eid : 0
    if (!t && (!brain.wander || brain.random() < 0.15)) {
      const a = brain.random() * Math.PI * 2
      const c = arena.center
      const towardMiddle = arena.kind === 'ffa' && Math.hypot(b.x - c.x, b.z - c.z) > 40
      brain.wander = towardMiddle ? { x: c.x, z: c.z } : { x: b.x + Math.cos(a) * 8, z: b.z + Math.sin(a) * 8 }
    }
  }
  const target = host.ents.get(brain.target)
  const fighting = target && target.alive && target.arena === arena.key && target.zone === 'match'
  const hurt = ent.hp + ent.absorb < ent.maxHp * 0.45

  // Eating takes time: stand back and finish the apple.
  if (brain.eatUntil) {
    if (now >= brain.eatUntil) {
      if (ent.inv[brain.eatSlot]) host.useItem(ent, brain.eatSlot, [0, 0, 0])
      brain.eatUntil = 0
    } else if (fighting) {
      const dx = b.x - target.x
      const dz = b.z - target.z
      const len = Math.hypot(dx, dz) || 1
      input.moveX = dx / len
      input.moveZ = dz / len
      face = { dx: -dx, dz: -dz }
    }
  } else if (hurt && !(ent.effects.regen > now)) {
    const splash = findSlot(ent, (item) => item.kind === 'splash')
    const food = findSlot(ent, (item) => item.kind === 'food')
    if (splash >= 0 && now > brain.potsAt) {
      select(ent, splash)
      host.useItem(ent, splash, [0, -1, 0])
      brain.potsAt = now + 900
    } else if (food >= 0 && now > brain.potsAt) {
      select(ent, food)
      brain.eatSlot = food
      brain.eatUntil = now + 1100
      brain.potsAt = now + 3500
    }
  }
  // Buffs at the start of a fight.
  if (fighting && !brain.eatUntil) {
    const pot = findSlot(ent, (item) => item.kind === 'potion' && item.effect && !(ent.effects[item.effect] > now))
    if (pot >= 0 && Math.hypot(target.x - b.x, target.z - b.z) < 14 && now > brain.potsAt) {
      select(ent, pot)
      host.useItem(ent, pot, [0, 0, 0])
      brain.potsAt = now + 800
    }
  }

  if (fighting && !brain.eatUntil) {
    const dx = target.x - b.x
    const dz = target.z - b.z
    const d = Math.hypot(dx, dz)
    face = { dx, dz }
    const len = d || 1
    const falling = !b.onGround && b.vy < -0.5
    const eye = host.eye(ent)
    const clear = () => !raycastVoxels(w, eye.x, eye.y, eye.z, target.x - eye.x, target.y + 1.2 - eye.y, target.z - eye.z, Math.hypot(target.x - eye.x, target.y + 1.2 - eye.y, target.z - eye.z), isSolidBlock)

    // Shield up for a moment when they're about to swing (and lower it to hit back).
    const shield = ent.inv[OFFHAND]?.id === 'shield' ? OFFHAND : findSlot(ent, (item) => item.kind === 'shield')
    if (shield >= 0 && d < 3.4 && now > brain.blockReadyAt && now > ent.shieldOffUntil && brain.random() < brain.skill * 0.08) {
      brain.blockUntil = now + 300 + brain.random() * 400
      brain.blockReadyAt = now + 1800 + brain.random() * 1500
    }
    const blocking = now < brain.blockUntil && now > ent.shieldOffUntil
    host.setBlocking(ent, blocking)

    const bow = findSlot(ent, (item) => item.kind === 'bow')
    const spear = findSlot(ent, (item) => item.kind === 'spear')
    const gust = findSlot(ent, (item) => item.kind === 'throw' && item.proj === 'gust')
    const mace = findSlot(ent, (item) => item.kind === 'mace')

    if (bow >= 0 && d > 9 && d < 30 && now > brain.shootAt && clear()) {
      // From range: arrows, leading the target a little.
      select(ent, bow)
      const time = d / PROJECTILES.arrow.speed
      const err = (1 - brain.skill) * 0.12
      const ty = target.y + 1.1 - eye.y + 0.5 * PROJECTILES.arrow.gravity * time * time
      host.useItem(ent, bow, [dx / len + (brain.random() - 0.5) * err, ty / len, dz / len + (brain.random() - 0.5) * err], 1)
      brain.shootAt = now + 1200 + brain.random() * 900
      moveToward(input, dx, dz, len, 0.6)
    } else if (spear >= 0 && d > 3.6 && d < 7.5 && now - ent.lungeAt > ITEMS.spear.lungeCd && brain.random() < 0.5) {
      select(ent, spear)
      host.useItem(ent, spear, [dx / len, 0, dz / len])
    } else if (gust >= 0 && mace >= 0 && brain.skill > 0.55 && b.onGround && d < 3.4 && now > brain.gustAt) {
      // Gust at your feet, up you go - and down comes the mace.
      select(ent, gust)
      host.useItem(ent, gust, [0, -1, 0])
      brain.gustAt = now + 4500 + brain.random() * 3000
      brain.comboUntil = now + 2600
    } else {
      if (now < brain.backUntil) {
        // W-tap: a step back after a hit, so the next one lands with full knockback.
        input.moveX = -dx / len * 0.6
        input.moveZ = -dz / len * 0.6
      } else if (d > 2.5 || now < brain.comboUntil) {
        moveToward(input, dx, dz, len, 1)
        input.sprint = d > 3.2
      } else {
        if (now > brain.strafeAt) {
          brain.strafe = brain.random() < 0.5 ? 1 : -1
          brain.strafeAt = now + 500 + brain.random() * 900
        }
        input.moveX = (-dz / len) * brain.strafe * 0.75 + (dx / len) * 0.2
        input.moveZ = (dx / len) * brain.strafe * 0.75 + (dz / len) * 0.2
        input.sprint = true
        // Better bots jump in for crits.
        if (b.onGround && brain.skill > 0.7 && brain.random() < 0.05) input.jump = true
        else if (brain.random() < 0.02) input.jump = true
      }
      const reach = Math.hypot(target.x - b.x, target.y - b.y, target.z - b.z)
      const weapon = weaponFor(ent, target, falling)
      if (!blocking) select(ent, weapon)
      const item = ITEMS[ent.inv[ent.sel]?.id] || ITEMS.fist
      const cd = MELEE_KINDS.has(item.kind) ? item.cd : 250
      if (!blocking && reach < (item.reach || 3) && now >= brain.nextSwingAt && now - ent.lastAttackAt > cd) {
        // Swing timing: around the target's no-damage window, slower for weaker bots.
        brain.nextSwingAt = now + (Math.max(cd, 380) + (1 - brain.skill) * 350 + brain.random() * 160) * brain.reaction
        if (brain.random() < brain.skill + 0.15) {
          host.melee(arena, ent, target)
          if (brain.random() < 0.3 + brain.skill * 0.3) brain.backUntil = now + 140 + brain.random() * 120
        } else {
          ent.lastAttackAt = now
          host.toArena(arena, 'swing', { eid: ent.eid })
        }
      }
    }
  } else if (!fighting) {
    host.setBlocking(ent, false)
    if (brain.wander) {
      const dx = brain.wander.x - b.x
      const dz = brain.wander.z - b.z
      const d = Math.hypot(dx, dz)
      if (d > 0.8) {
        moveToward(input, dx, dz, d, 0.8)
        face = { dx, dz }
      }
    }
  }
  if (ent.blocking) input.sprint = false
  // In the water: swim up and head back for land.
  if (b.inWater) {
    input.jump = true
    input.guard = false
    if (!fighting) {
      const c = arena.center
      const dx = c.x - b.x
      const dz = c.z - b.z
      moveToward(input, dx, dz, Math.hypot(dx, dz), 1)
      face = { dx, dz }
    }
  }

  // Stuck against something: hop, then try somewhere else.
  const moved = Math.hypot(b.x - brain.lastX, b.z - brain.lastZ)
  brain.lastX = b.x
  brain.lastZ = b.z
  if ((input.moveX || input.moveZ) && moved < 0.01 * dt * 60) {
    if (!brain.stuckSince) brain.stuckSince = now
    if (now - brain.stuckSince > 600) input.jump = true
    if (now - brain.stuckSince > 2400) {
      brain.stuckSince = 0
      brain.wander = { x: b.x + (brain.random() - 0.5) * 10, z: b.z + (brain.random() - 0.5) * 10 }
      brain.target = 0
      brain.thinkAt = now + 1200
    }
  } else brain.stuckSince = 0

  const fx = ent.effects
  stepBody(w, b, input, dt, (fx.speed > now ? 1.3 : 1) * (ent.blocking ? 0.45 : 1), fx.jump > now ? 1.3 : 1)
  host.trackFall(ent, arena, !b.onGround, b.y, now)
  if (!ent.alive) return
  ent.falling = b.vy < -0.5
  ent.x = b.x
  ent.y = b.y
  ent.z = b.z
  if (face && (face.dx || face.dz)) ent.yaw = yawToward(face.dx, face.dz)
  ent.pitch = target && fighting ? Math.max(-0.6, Math.min(0.6, Math.atan2(target.y - b.y, Math.hypot(target.x - b.x, target.z - b.z) || 1))) : 0
  ent.anim = !b.onGround ? 4 : input.moveX || input.moveZ ? (input.sprint ? 2 : 1) : 0
}

function moveToward(input, dx, dz, len, k) {
  input.moveX = (dx / (len || 1)) * k
  input.moveZ = (dz / (len || 1)) * k
}
