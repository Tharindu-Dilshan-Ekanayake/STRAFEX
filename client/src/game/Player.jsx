import { useEffect } from 'react'

import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { breakSeconds, COMBAT, EFFECTS, ITEMS, MELEE_KINDS, OFFHAND } from '@shared/balance'
import { PLAYER, stepBody } from '@shared/physics'
import { B, BLOCKS, blockKey, isWater, rayBox } from '@shared/voxel'

import { materialOf, sfx } from '../audio/sfx'
import { send } from '../net/actions'
import { showCombo, showHit } from '../ui/juice'
import { interpolateRemotes } from '../net/remotes'
import { getGame } from '../store/game'
import { blockOfItem } from './art/items'
import { installInput, sprintSpent, wantsSprint } from './input'
import { pushFx, recordClick, runtime } from './runtime'
import { canBreak, lobbyLayout, setBlock, worldState } from './world'
import { BOW_FULL_MS, placeCamera } from './player/camera'
import { aim, findPlacement, findWater, heldId, rightClickTarget } from './player/aim'

/**
 * You: movement against the voxel world (the same physics as the bots on the server),
 * what the crosshair is on, and fighting: clicks that hit (CPS counts), sprint hits that
 * spend your sprint (w-tap to get it back), the shield on right click, holding to eat or
 * drink, the spear lunge, throwing, the bow, building and blast crystals.
 *
 * Everything here runs in the frame loop and writes only to `runtime` and the network -
 * never to React state.
 */

const PLACE_REPEAT_MS = 190
const SWING_SEND_MS = 300
const THROW_REPEAT_MS = 300
/** Holding the button: one more swing this often (touch players, and lazy fingers). */
const HOLD_REPEAT_MS = 250
/** Right click held this long eats (food) or drinks (potion). */
const EAT_MS = { food: 1050, potion: 850 }

function effect(name) {
  const left = runtime.me.effects?.[name]
  return left && performance.now() - runtime.me.effectsAt < left
}

/** Can we act right now (in a fight, alive, not between rounds)? */
function canAct() {
  return runtime.zone === 'match' && runtime.me.alive && getGame().phase.phase === 'fight' && worldState.kind === 'match'
}

/** A duel between rounds or counting down: everyone stays on their spawn. */
function heldStill(game) {
  return runtime.zone === 'match' && game.phase.kind === 'duel' && game.phase.phase !== 'fight'
}

/** Opens the loot chest you aim at (the host decides what's inside). */
function openChest(now) {
  const t = runtime.target
  runtime.swingAt = now
  send('loot', { x: t.x, y: t.y, z: t.z })
}

/** A shield in a hand: the left hand, or the slot you hold. */
const hasShield = () => runtime.me.inv?.[OFFHAND]?.id === 'shield' || runtime.me.inv?.[runtime.me.sel]?.id === 'shield'
const shieldDown = () => runtime.me.shieldOff > 0 && performance.now() - runtime.me.shieldOffAt < runtime.me.shieldOff

export default function Player() {
  const camera = useThree((s) => s.camera)

  useEffect(() => installInput(), [])
  useEffect(() => {
    runtime.camera.mode = getGame().settings.camera === 'third' ? 'third' : 'first'
  }, [])
  useEffect(() => {
    camera.rotation.order = 'YXZ'
  }, [camera])

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt)
    const now = performance.now()
    const p = runtime.player
    const input = runtime.input
    const game = getGame()
    const world = worldState.world
    interpolateRemotes(dt)
    if (!world) return

    // Look.
    p.yaw -= input.lookX
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - input.lookY))
    input.lookX = 0
    input.lookY = 0

    const spectating = runtime.zone === 'spec'
    const frozen = Boolean(game.panel) || Boolean(game.caseOpen)
    const still = heldStill(game)
    const b = p.body

    if (!spectating) {
      const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + input.joyY
      const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.joyX
      const fx = -Math.sin(p.yaw)
      const fz = -Math.cos(p.yaw)
      const rx = Math.cos(p.yaw)
      const rz = -Math.sin(p.yaw)
      const stop = frozen || still
      let mx = stop ? 0 : fx * fwd + rx * strafe
      let mz = stop ? 0 : fz * fwd + rz * strafe
      const len = Math.hypot(mx, mz)
      if (len > 1) {
        mx /= len
        mz /= len
      }
      const sneak = !stop && (input.sneak || input.sneakToggle)
      // Holding blocks in a fight: you never walk off an edge by accident (jumping still can).
      const heldKind = ITEMS[heldId()]?.kind
      const guard = runtime.zone === 'match' && (heldKind === 'block' || heldKind === 'crystal') && !input.jump
      const slowed = runtime.blocking || runtime.eatStart > 0
      const sprint = !stop && !sneak && !slowed && fwd > 0.5 && !sprintSpent() && (wantsSprint() || Math.hypot(input.joyX, input.joyY) > 0.95)
      const wasGround = b.onGround
      const wasWet = b.inWater
      const fallSpeed = b.vy
      stepBody(
        world,
        b,
        { moveX: mx, moveZ: mz, jump: !stop && input.jump, sneak, sprint, guard, autoJump: input.touch },
        dt,
        (effect('speed') ? EFFECTS.speed.speedMul : 1) * (slowed ? 0.45 : 1),
        effect('leap') ? EFFECTS.leap.jumpMul : effect('jump') ? EFFECTS.jump.jumpMul : 1,
      )
      if (b.inWater && !wasWet && fallSpeed < -3) {
        sfx.splash(Math.min(1, -fallSpeed / 14))
        pushFx({ type: 'splash', x: b.x, y: b.y + 0.6, z: b.z, color: '#7fc4ff' })
      }
      if (b.bounced) {
        sfx.pad()
        pushFx({ type: 'pad', x: b.x, y: b.y, z: b.z })
        runtime.camera.fovKick = 1.4
      }
      p.sneaking = sneak
      p.sprinting = sprint && len > 0.1
      p.grounded = b.onGround
      const moving = Math.hypot(b.vx, b.vz)
      p.speed = moving
      if (b.onGround && moving > 0.5) {
        const before = p.walkPhase
        p.walkPhase += moving * dt * 2.4
        if (Math.floor(before / Math.PI) !== Math.floor(p.walkPhase / Math.PI)) sfx.step(sneak ? 0.4 : 1, materialOf(world.get(b.x, b.y - 0.1, b.z)))
      }
      if (!wasGround && b.onGround && fallSpeed < -6) {
        runtime.camera.landAt = performance.now()
        runtime.camera.landAmp = Math.min(1, (-fallSpeed - 4) / 18)
        if (fallSpeed < -9) sfx.land()
      }
      // Swimming reads as walking (never a falling crit).
      p.anim = b.inWater ? (moving > 0.5 ? 1 : 0) : !b.onGround ? 4 : sneak ? 3 : moving > 0.5 ? (p.sprinting ? 2 : 1) : 0
      runtime.camera.fovKick += ((p.sprinting ? 1 : 0) - runtime.camera.fovKick) * Math.min(1, dt * 8)

      // Fell off the lobby: back to the spawn.
      if (runtime.zone === 'lobby' && b.y < -10) {
        const s = lobbyLayout().spawn
        b.x = s.x
        b.y = s.y
        b.z = s.z
        b.vx = b.vy = b.vz = 0
      }
    }

    // What the crosshair is on, and acting on it.
    const eyeY = b.y + PLAYER.eye - (p.sneaking ? 0.18 : 0)
    const cp = Math.cos(p.pitch)
    const dx = -Math.sin(p.yaw) * cp
    const dy = Math.sin(p.pitch)
    const dz = -Math.cos(p.yaw) * cp
    const target = runtime.target
    target.kind = null
    if (!spectating && runtime.zone === 'match') {
      aim(world, b.x, eyeY, b.z, dx, dy, dz, target)
      findPlacement(world, b, eyeY, dx, dy, dz)
      if (!frozen) act(stateBag, world, now, dt, b, dx, dy, dz)
      else stopHolding()
    } else {
      runtime.dig.progress = 0
      runtime.place.ok = false
      stopHolding()
      // In the lobby your sword is for show - and for the training dummies.
      if (runtime.zone === 'lobby' && !frozen && input.attack && !stateBag.attackWas && now - runtime.swingAt > 90) {
        runtime.swingAt = now
        recordClick('l')
        sfx.swing()
        send('swing')
        hitDummy(camera, b, now)
      }
      if (runtime.zone === 'lobby') parkour(world, b, now)
      else runtime.parkour.startedAt = 0
      if (input.use && !stateBag.useWas) recordClick('r')
      stateBag.attackWas = input.attack
      stateBag.useWas = input.use
    }

    placeCamera(camera, game, b, eyeY, dt, now)
    // Eyes under water: the blue wash (a DOM class, set only when it changes).
    const under = isWater(world.get(camera.position.x, camera.position.y, camera.position.z))
    if (under !== stateBag.under) {
      stateBag.under = under
      document.getElementById('water-overlay')?.classList.toggle('on', under)
    }
  }, -1)

  return null
}

const camDir = new Vector3()
const dummyState = { lastAt: 0, combo: 0 }

/** A click in the lobby: does it land on a training dummy? Damage numbers and combos. */
function hitDummy(camera, b, now) {
  const dummies = lobbyLayout().dummies
  camera.getWorldDirection(camDir)
  const cp = camera.position
  for (let i = 0; i < dummies.length; i += 1) {
    const d = dummies[i]
    if (Math.hypot(d.x - b.x, d.z - b.z) > 4.2) continue
    const t = rayBox(cp.x, cp.y, cp.z, camDir.x, camDir.y, camDir.z, d.x - 0.45, d.y, d.z - 0.45, d.x + 0.45, d.y + 1.9, d.z + 0.45)
    if (t < 0 || t > 12) continue
    // Like a real hit: falling is a crit, timing keeps the combo going.
    const crit = !b.onGround && b.vy < -0.5
    dummyState.combo = now - dummyState.lastAt < 1300 ? dummyState.combo + 1 : 1
    dummyState.lastAt = now
    runtime.dummyHits[i] = now
    showHit(crit ? 10.5 : 7)
    showCombo(dummyState.combo)
    sfx.hit()
    if (crit) {
      sfx.crit()
      pushFx({ type: 'crit', x: d.x, y: d.y + 1.2, z: d.z })
    }
    return
  }
}

/** The lobby parkour: the clock starts off the gold block and stops on the finish plate. */
function parkour(world, b, now) {
  if (!b.onGround) return
  const under = world.get(b.x, b.y - 0.1, b.z)
  const pk = runtime.parkour
  const { start } = lobbyLayout().parkour
  if (under === B.GOLD && Math.hypot(b.x - start.x, b.z - start.z) < 1.6) pk.startedAt = now
  else if (under === B.FINISH && pk.startedAt) {
    send('parkour', { ms: Math.round(now - pk.startedAt) })
    sfx.reward()
    pk.startedAt = 0
  }
}

/** A small mutable bag that survives re-renders (no React state in the frame loop). */
const stateBag = { attackWas: false, useWas: false, placeAt: 0, swingSentAt: 0, throwAt: 0, digSoundAt: 0, digCooldownUntil: 0, holdAt: 0, under: false }

function setBlocking(on) {
  if (runtime.blocking === on) return
  runtime.blocking = on
  send('block', { on })
}

/** Lets go of the shield, the apple and the bow. */
function stopHolding() {
  setBlocking(false)
  runtime.eatStart = 0
  runtime.bowPullAt = 0
}

function act(st, world, now, dt, b, dx, dy, dz) {
  const input = runtime.input
  const target = runtime.target
  const fight = canAct()
  const held = heldId()
  const item = ITEMS[held] || ITEMS.fist
  const attackEdge = input.attack && !st.attackWas
  const useEdge = input.use && !st.useWas
  const useRelease = !input.use && st.useWas
  st.attackWas = input.attack
  st.useWas = input.use
  if (attackEdge) recordClick('l')
  if (useEdge) recordClick('r')
  const dig = runtime.dig

  // --- Left button: hit (every click; holding repeats slowly), or break.
  if (input.attack && fight) {
    if (attackEdge && runtime.blocking) setBlocking(false)
    if (target.kind === 'ent') {
      dig.progress = 0
      const cd = MELEE_KINDS.has(item.kind) ? item.cd : 250
      const swing = attackEdge || now - st.holdAt >= HOLD_REPEAT_MS
      if (swing && now - runtime.attackAt >= cd * 0.9) {
        st.holdAt = now
        runtime.attackAt = now
        runtime.swingAt = now
        sfx.swing()
        send('attack', { eid: target.eid })
        // Show the hit now (flash, sound, sparks); the host's word follows a moment later.
        // Not when it can't land: they were just hit, or their shield is up.
        const r = runtime.remotes.get(target.eid)
        if (r && now - r.hurtAt > COMBAT.iframesMs && r.anim !== 5) {
          r.hurtAt = now
          runtime.predictedHitAt = now
          sfx.hit()
          pushFx({ type: 'hit', x: r.x, y: r.y + 1.2, z: r.z })
        }
        // A sprint hit spends your sprint: let go of forward (w-tap) to get it back.
        if (runtime.player.sprinting) sprintSpent(true)
      } else if (attackEdge) runtime.swingAt = now
    } else if (target.kind === 'block' && target.id === B.LOOT_CHEST) {
      // Hitting a chest opens it too (one button on a phone).
      if (attackEdge) openChest(now)
    } else if (target.kind === 'block' && now > st.digCooldownUntil && canBreak(target.x, target.y, target.z)) {
      const def = BLOCKS[target.id]
      const key = blockKey(target.x, target.y, target.z)
      if (Number.isFinite(def.hard)) {
        if (dig.key !== key) {
          dig.key = key
          dig.x = target.x
          dig.y = target.y
          dig.z = target.z
          dig.progress = 0
          send('dig', { x: target.x, y: target.y, z: target.z })
        }
        const need = Math.max(0.05, breakSeconds(def.hard))
        dig.progress += dt / need
        if (now - runtime.swingAt > 250) runtime.swingAt = now
        if (now - st.digSoundAt > 200) {
          st.digSoundAt = now
          sfx.dig()
        }
        if (dig.progress >= 1) {
          // Our guess: gone now; the host confirms (or puts it back).
          const id = target.id
          setBlock(target.x, target.y, target.z, B.AIR)
          if (BLOCKS[world.get(target.x, target.y + 1, target.z)]?.render === 'cross') setBlock(target.x, target.y + 1, target.z, B.AIR)
          pushFx({ type: 'break', x: target.x, y: target.y, z: target.z, id })
          sfx.breakBlock(1, materialOf(id))
          send('break', { x: target.x, y: target.y, z: target.z })
          dig.key = -1
          dig.progress = 0
          st.digCooldownUntil = now + 120
        }
      } else dig.progress = 0
    } else if (attackEdge) {
      runtime.swingAt = now
      sfx.swing()
    }
    if (now - st.swingSentAt > SWING_SEND_MS && now - runtime.swingAt < 50) {
      st.swingSentAt = now
      if (target.kind !== 'ent') send('swing')
    }
  } else {
    dig.progress = 0
    dig.key = -1
  }

  if (!fight) {
    stopHolding()
    return
  }

  // --- Right button: a loot chest opens; otherwise place, eat, drink, throw, shoot, lunge -
  // with the right hand's item if it does something, else the left hand's - or raise the
  // shield.
  if (runtime.target.kind === 'block' && runtime.target.id === B.LOOT_CHEST) {
    if (useEdge) openChest(now)
    setBlocking(false)
    return
  }
  let wantsBlock = false
  const use = rightClickTarget()
  const usedId = use.id
  const usedItem = ITEMS[usedId] || ITEMS.fist
  const hand = use.hand
  runtime.useHand = hand
  if (usedItem.kind === 'block' || usedItem.kind === 'crystal') {
    const pl = runtime.place
    if (input.use && pl.ok && (useEdge || now - st.placeAt > PLACE_REPEAT_MS)) {
      st.placeAt = now
      runtime.swingAt = now
      const id = usedItem.kind === 'crystal' ? B.CRYSTAL : blockOfItem(usedId)
      setBlock(pl.x, pl.y, pl.z, id)
      pushFx({ type: 'place', x: pl.x, y: pl.y, z: pl.z, id })
      sfx.place(materialOf(id))
      send('place', { x: pl.x, y: pl.y, z: pl.z, hand })
    }
  } else if (usedItem.kind === 'bucket') {
    // One pour or scoop per click.
    if (useEdge && now - st.placeAt > 250) {
      const pl = runtime.place
      st.placeAt = now
      if (usedItem.fill && pl.ok) {
        runtime.swingAt = now
        setBlock(pl.x, pl.y, pl.z, B.WATER)
        pushFx({ type: 'douse', x: pl.x + 0.5, y: pl.y + 0.5, z: pl.z + 0.5 })
        sfx.splash(0.8)
        send('place', { x: pl.x, y: pl.y, z: pl.z, hand })
      } else if (usedItem.fill) {
        // Nowhere to pour: over your own head (out goes the fire).
        runtime.swingAt = now
        sfx.splash(0.8)
        send('use', { hand })
      } else {
        const w = findWater(worldState.world, b, dx, dy, dz)
        if (w) {
          runtime.swingAt = now
          sfx.splash(0.5)
          send('use', { hand, x: w.x, y: w.y, z: w.z })
        }
      }
    }
  } else if (usedItem.kind === 'food' || usedItem.kind === 'potion') {
    if (input.use) {
      if (!runtime.eatStart) runtime.eatStart = now
      else if (now - runtime.eatStart >= EAT_MS[usedItem.kind]) {
        send('use', { hand })
        runtime.eatStart = now
      }
    } else runtime.eatStart = 0
  } else if (usedItem.kind === 'throw' || usedItem.kind === 'splash') {
    if (input.use && now - st.throwAt > THROW_REPEAT_MS) {
      st.throwAt = now
      runtime.swingAt = now
      send('use', { dir: [dx, dy, dz], hand })
    }
  } else if (item.kind === 'bow') {
    if (useEdge) runtime.bowPullAt = now
    if (useRelease && runtime.bowPullAt) {
      const charge = Math.min(1, (now - runtime.bowPullAt) / BOW_FULL_MS)
      runtime.bowPullAt = 0
      if (charge > 0.12) send('use', { dir: [dx, dy, dz], charge })
    }
  } else if (item.kind === 'spear') {
    if (useEdge && now - runtime.lungeAt >= item.lungeCd) {
      // The dash is ours at once; the host lets the move through.
      runtime.lungeAt = now
      runtime.swingAt = now
      const len = Math.hypot(dx, dz) || 1
      b.pushX += (dx / len) * COMBAT.lungeSpeed
      b.pushZ += (dz / len) * COMBAT.lungeSpeed
      b.vy = Math.max(b.vy, COMBAT.lungeLift)
      b.onGround = false
      runtime.camera.fovKick = 1.6
      sfx.lunge()
      send('use', { dir: [dx, dy, dz] })
    } else if (input.use && hasShield()) wantsBlock = true
  } else if (input.use && hasShield()) {
    // Swords, axes, maces, the shield itself, an empty hand: right click blocks.
    wantsBlock = true
  }
  if (usedItem.kind !== 'food' && usedItem.kind !== 'potion') runtime.eatStart = 0
  if (!input.use && item.kind !== 'bow') runtime.bowPullAt = 0
  setBlocking(wantsBlock && !shieldDown() && !input.attack)
}
