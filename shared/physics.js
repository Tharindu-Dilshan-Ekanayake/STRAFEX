/**
 * Player movement against the voxel grid, shared by the client (your own character)
 * and the server (bots), so a bot walks, jumps and falls exactly the way you do.
 *
 * A body is an axis-aligned box `PLAYER.halfW` either side of (x, z), from y (feet) up
 * `PLAYER.height`. Movement is resolved one axis at a time in small steps, so even a
 * fast knockback can't tunnel through a wall.
 */

import { B } from './voxel.js'

/** Swimming: how fast you swim up (holding jump), sink, and move through water. */
export const SWIM = { up: 4.4, upAccel: 30, gravity: 7, maxSink: 3.5, speed: 0.6, climbOut: 7 }

/** Is the body at feet (x, y, z) in water (feet or chest)? */
export function inWater(world, x, y, z) {
  return world.get(x, y + 0.3, z) === B.WATER || world.get(x, y + 1.1, z) === B.WATER
}

/** A jump pad's launch (blocks/s up): about 8 blocks high. */
export const PAD_V = 21

export const PLAYER = {
  halfW: 0.3,
  height: 1.8,
  eye: 1.62,
  walk: 4.3,
  sprint: 5.9,
  sneak: 1.5,
  jumpV: 8.6,
  gravity: 27,
  maxFall: 42,
  /** How fast you reach your walking speed on the ground / in the air (1/s). */
  groundAccel: 14,
  airAccel: 3.2,
  /** Knockback and other pushes fade at this rate on the ground (1/s). */
  groundFriction: 9,
}

/** Is the box with feet at (x, y, z) inside any solid block? */
export function boxBlocked(world, x, y, z, hw = PLAYER.halfW, h = PLAYER.height) {
  const x0 = Math.floor(x - hw + 1e-4)
  const x1 = Math.floor(x + hw - 1e-4)
  const y0 = Math.floor(y + 1e-4)
  const y1 = Math.floor(y + h - 1e-4)
  const z0 = Math.floor(z - hw + 1e-4)
  const z1 = Math.floor(z + hw - 1e-4)
  for (let by = y0; by <= y1; by += 1) {
    for (let bz = z0; bz <= z1; bz += 1) {
      for (let bx = x0; bx <= x1; bx += 1) if (world.isSolid(bx, by, bz)) return true
    }
  }
  return false
}

/** Is a jump pad under the box? */
export function onPad(world, x, y, z, hw = PLAYER.halfW) {
  const by = Math.floor(y - 0.05)
  const x0 = Math.floor(x - hw)
  const x1 = Math.floor(x + hw)
  const z0 = Math.floor(z - hw)
  const z1 = Math.floor(z + hw)
  const P = B.JUMP_PAD
  return world.get(x0, by, z0) === P || world.get(x1, by, z0) === P || world.get(x0, by, z1) === P || world.get(x1, by, z1) === P
}

/** Is there a solid block right under the box (what you'd stand on)? */
export function hasSupport(world, x, y, z, hw = PLAYER.halfW) {
  const by = Math.floor(y - 0.05)
  const x0 = Math.floor(x - hw + 1e-4)
  const x1 = Math.floor(x + hw - 1e-4)
  const z0 = Math.floor(z - hw + 1e-4)
  const z1 = Math.floor(z + hw - 1e-4)
  for (let bz = z0; bz <= z1; bz += 1) {
    for (let bx = x0; bx <= x1; bx += 1) if (world.isSolid(bx, by, bz)) return true
  }
  return false
}

/** Does block cell (bx, by, bz) overlap the body at feet (x, y, z)? */
export function cellOverlapsBody(bx, by, bz, x, y, z, hw = PLAYER.halfW, h = PLAYER.height) {
  return bx + 1 > x - hw && bx < x + hw && by + 1 > y && by < y + h && bz + 1 > z - hw && bz < z + hw
}

export function createBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, pushX: 0, pushZ: 0, hitWall: false }
}

/**
 * Advances `body` by `dt` seconds.
 *
 * `input`: `{ moveX, moveZ }` the wished direction in world space (length 0..1),
 * `jump`, `sprint`, `sneak` (slow, and never walks off an edge), `guard` (never walks
 * off an edge, at full speed), `autoJump` (hops a
 * one-block step on its own - touch controls and bots), `speedMul` (potions).
 */
export function stepBody(world, body, input, dt, speedMul = 1, jumpMul = 1) {
  const p = PLAYER
  const wet = inWater(world, body.x, body.y, body.z)
  body.inWater = wet
  const speed = (input.sneak ? p.sneak : input.sprint ? p.sprint : p.walk) * speedMul * (wet ? SWIM.speed : 1)
  const wantX = (input.moveX || 0) * speed
  const wantZ = (input.moveZ || 0) * speed
  const accel = body.onGround || wet ? p.groundAccel : p.airAccel
  const k = Math.min(1, accel * dt)
  // Walking velocity eases toward the wish; pushes (knockback) ride on top and fade.
  body.vx += (wantX - body.vx) * k
  body.vz += (wantZ - body.vz) * k
  if (body.onGround) {
    const f = Math.max(0, 1 - p.groundFriction * dt)
    body.pushX *= f
    body.pushZ *= f
  } else {
    const f = Math.max(0, 1 - 0.6 * dt)
    body.pushX *= f
    body.pushZ *= f
  }

  if (wet) {
    // Swimming: hold jump to rise, otherwise sink slowly; water slows a fall at once.
    if (input.jump) body.vy = Math.min(SWIM.up, body.vy + SWIM.upAccel * dt)
    else body.vy = Math.max(-SWIM.maxSink, body.vy - SWIM.gravity * dt)
    if (body.vy < -SWIM.maxSink) body.vy = -SWIM.maxSink
  } else {
    if (input.jump && body.onGround) {
      body.vy = p.jumpV * jumpMul
      body.onGround = false
    }
    body.vy = Math.max(-p.maxFall, body.vy - p.gravity * dt)
  }

  const dx = (body.vx + body.pushX) * dt
  const dy = body.vy * dt
  const dz = (body.vz + body.pushZ) * dt
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.35))
  const sx = dx / steps
  const sy = dy / steps
  const sz = dz / steps
  const guardEdge = (input.sneak || input.guard) && body.onGround
  let landed = false
  body.hitWall = false

  for (let i = 0; i < steps; i += 1) {
    // Vertical first: landing and bumping your head.
    if (sy !== 0) {
      const ny = body.y + sy
      if (boxBlocked(world, body.x, ny, body.z)) {
        if (sy < 0) {
          body.y = Math.floor(ny) + 1
          landed = true
        } else {
          body.y = Math.floor(ny + p.height) - p.height - 1e-3
        }
        body.vy = 0
      } else {
        body.y = ny
      }
    }
    if (sx !== 0) {
      const nx = body.x + sx
      if (boxBlocked(world, nx, body.y, body.z) || (guardEdge && !hasSupport(world, nx, body.y, body.z))) {
        body.hitWall = true
        body.vx = 0
        body.pushX = 0
      } else {
        body.x = nx
      }
    }
    if (sz !== 0) {
      const nz = body.z + sz
      if (boxBlocked(world, body.x, body.y, nz) || (guardEdge && !hasSupport(world, body.x, body.y, nz))) {
        body.hitWall = true
        body.vz = 0
        body.pushZ = 0
      } else {
        body.z = nz
      }
    }
  }

  body.onGround = landed || (body.vy <= 0 && hasSupport(world, body.x, body.y, body.z) && Math.abs(body.y - Math.round(body.y)) < 0.02)
  if (body.onGround && body.vy < 0) body.vy = 0
  // Swimming into the shore: climb out.
  if (wet && body.hitWall && (wantX || wantZ)) body.vy = Math.max(body.vy, SWIM.climbOut)
  // Standing on a jump pad: up you go (`bounced` tells the caller, for the sound).
  body.bounced = false
  if (body.onGround && onPad(world, body.x, body.y, body.z)) {
    body.vy = PAD_V
    body.onGround = false
    body.bounced = true
  }

  // Auto-jump: walking into a single block with room above it.
  if (input.autoJump && body.onGround && body.hitWall && (wantX || wantZ)) {
    const len = Math.hypot(wantX, wantZ) || 1
    const ax = body.x + (wantX / len) * 0.45
    const az = body.z + (wantZ / len) * 0.45
    if (boxBlocked(world, ax, body.y, az) && !boxBlocked(world, ax, body.y + 1.05, az) && !boxBlocked(world, body.x, body.y + 1.05, body.z)) {
      body.vy = p.jumpV * Math.max(1, jumpMul)
      body.onGround = false
    }
  }
  return body
}
