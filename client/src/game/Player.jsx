import { useEffect } from 'react'

import { useFrame, useThree } from '@react-three/fiber'
import { ATTACK_COOLDOWN_MS, breakSeconds, EFFECTS, ITEMS, lavaHeight } from '@shared/balance'
import { PLAYER, stepBody } from '@shared/physics'
import { B, BLOCKS, blockKey } from '@shared/voxel'

import { materialOf, sfx } from '../audio/sfx'
import { send } from '../net/actions'
import { interpolateRemotes } from '../net/remotes'
import { getGame } from '../store/game'
import { blockOfItem } from './art/items'
import { installInput, wantsSprint } from './input'
import { pushFx, runtime } from './runtime'
import { lobbyLayout, setBlock, worldState } from './world'
import { BOW_FULL_MS, placeCamera } from './player/camera'
import { aim, findPlacement, heldId } from './player/aim'

/**
 * You: movement against the voxel world (the same physics as the bots on the server),
 * what the crosshair is on, breaking / placing / hitting / using items, and the camera
 * (first person, third person, or following someone while spectating).
 *
 * Everything here runs in the frame loop and writes only to `runtime` and the network -
 * never to React state.
 */

const PLACE_REPEAT_MS = 210

const SWING_SEND_MS = 300

const THROW_REPEAT_MS = 300

function effect(name) {
  const left = runtime.me.effects?.[name]
  return left && performance.now() - runtime.me.effectsAt < left
}

/** Can we act in the round right now (not in the lobby, cages, dead or spectating)? */
function canAct() {
  return runtime.zone === 'match' && runtime.me.alive && getGame().phase.phase === 'fight' && worldState.kind === 'match'
}

export default function Player() {
  const camera = useThree((s) => s.camera)

  useEffect(() => installInput(), [])
  useEffect(() => {
    runtime.camera.mode = getGame().settings.camera === 'third' ? 'third' : 'first'
  }, [])
  useEffect(() => {
    camera.rotation.order = 'YXZ'
  }, [camera])

  // Local edge-detection state for the mouse buttons.
  const state = useStateRef()

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
    const b = p.body

    if (!spectating) {
      // Movement.
      const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + input.joyY
      const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.joyX
      const fx = -Math.sin(p.yaw)
      const fz = -Math.cos(p.yaw)
      const rx = Math.cos(p.yaw)
      const rz = -Math.sin(p.yaw)
      let mx = frozen ? 0 : fx * fwd + rx * strafe
      let mz = frozen ? 0 : fz * fwd + rz * strafe
      const len = Math.hypot(mx, mz)
      if (len > 1) {
        mx /= len
        mz /= len
      }
      const sneak = !frozen && (input.sneak || input.sneakToggle)
      // Holding blocks in a round: you never walk off an edge by accident (jumping
      // still can) - so bridging doesn't need Shift.
      const heldKind = ITEMS[heldId()]?.kind
      const guard = runtime.zone === 'match' && (heldKind === 'block' || heldKind === 'tnt') && !input.jump
      const sprint = !frozen && !sneak && fwd > 0.5 && (wantsSprint() || Math.hypot(input.joyX, input.joyY) > 0.95)
      const wasGround = b.onGround
      const fallSpeed = b.vy
      stepBody(
        world,
        b,
        { moveX: mx, moveZ: mz, jump: !frozen && input.jump, sneak, sprint, guard, autoJump: input.touch },
        dt,
        effect('speed') ? EFFECTS.speed.speedMul : 1,
        effect('jump') ? EFFECTS.jump.jumpMul : 1,
      )
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
        // The camera (and the hand) dips with the impact.
        runtime.camera.landAt = performance.now()
        runtime.camera.landAmp = Math.min(1, (-fallSpeed - 4) / 18)
        if (fallSpeed < -9) sfx.land()
      }
      p.anim = !b.onGround ? 4 : sneak ? 3 : moving > 0.5 ? (p.sprinting ? 2 : 1) : 0
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

    // The lava's height this frame (the HUD and the lava mesh read it).
    if (runtime.lava.active) runtime.lava.y = lavaHeight(now - runtime.lava.fightStart, runtime.lava.mode)

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
      if (!frozen) act(state, world, now, dt, b, eyeY, dx, dy, dz)
    } else {
      runtime.dig.progress = 0
      runtime.place.ok = false
      // In the lobby your sword is just for show: a click swings it (others see it).
      const st = state
      if (runtime.zone === 'lobby' && !frozen && input.attack && !st.attackWas && now - runtime.swingAt > 280) {
        runtime.swingAt = now
        sfx.swing()
        send('swing')
      }
      st.attackWas = input.attack
    }

    placeCamera(camera, game, b, eyeY, dt, now)
  }, -1)

  return null
}

/** A small mutable bag that survives re-renders (no React state in the frame loop). */
function useStateRef() {
  return stateBag
}

const stateBag = { attackWas: false, useWas: false, placeAt: 0, swingSentAt: 0, throwAt: 0, digSoundAt: 0, digCooldownUntil: 0 }

function act(st, world, now, dt, b, eyeY, dx, dy, dz) {
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
  const dig = runtime.dig

  // --- Left button: hit, or break.
  if (input.attack && fight) {
    if (target.kind === 'ent') {
      dig.progress = 0
      if (now - runtime.attackAt >= ATTACK_COOLDOWN_MS) {
        runtime.attackAt = now
        runtime.swingAt = now
        sfx.swing()
        send('attack', { eid: target.eid })
      }
    } else if (target.kind === 'block' && now > st.digCooldownUntil) {
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
        const need = Math.max(0.05, breakSeconds(def.hard, held))
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
      } else {
        dig.progress = 0
      }
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

  if (!fight) return

  // --- Right button: place, eat, drink, throw, draw the bow.
  if (item.kind === 'block' || item.kind === 'tnt') {
    const pl = runtime.place
    if (input.use && pl.ok && (useEdge || now - st.placeAt > PLACE_REPEAT_MS)) {
      st.placeAt = now
      runtime.swingAt = now
      setBlock(pl.x, pl.y, pl.z, blockOfItem(held))
      pushFx({ type: 'place', x: pl.x, y: pl.y, z: pl.z, id: blockOfItem(held) })
      sfx.place(materialOf(blockOfItem(held)))
      send('place', { x: pl.x, y: pl.y, z: pl.z })
    }
  } else if (item.kind === 'food' || item.kind === 'potion' || item.kind === 'heart') {
    if (useEdge) send('use', {})
  } else if (item.kind === 'throw') {
    if (input.use && now - st.throwAt > THROW_REPEAT_MS) {
      st.throwAt = now
      runtime.swingAt = now
      send('use', { dir: [dx, dy, dz] })
    }
  } else if (item.kind === 'bow') {
    if (useEdge) runtime.bowPullAt = now
    if (useRelease && runtime.bowPullAt) {
      const charge = Math.min(1, (now - runtime.bowPullAt) / BOW_FULL_MS)
      runtime.bowPullAt = 0
      if (charge > 0.12) send('use', { dir: [dx, dy, dz], charge })
    }
  }
  if (!input.use && item.kind !== 'bow') runtime.bowPullAt = 0
}
