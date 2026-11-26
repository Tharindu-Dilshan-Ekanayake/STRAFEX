import { PLAYER } from './physics.js'

/**
 * Server-side sanity checks on the positions clients report (the client simulates its
 * own movement; the host only decides whether a move was possible):
 *
 * - speed: a budget of distance that refills at your top speed (sprint, potions, a 25%
 *   tolerance) and holds at most `burst` blocks, so lag bursts pass but a steady speed
 *   hack drains it within a second or two
 * - fly:   while nothing is under you, you can't rise higher than a jump above where
 *   you last stood, and you can't hang in the air (not falling) for long
 * - wall:  your feet and head can't both be inside solid blocks
 *
 * Knockback, launch pads and teleports open a short grace window (host.js), during
 * which only a loose speed cap applies and this state is reset to where you are.
 */

export const MOVE = {
  speedTolerance: 1.25,
  burst: 8,
  riseSlack: 0.45,
  hoverMs: 2500,
}

const rise = (v) => (v * v) / (2 * PLAYER.gravity)

export function createMoveState(y = 0, now = 0) {
  return { budget: MOVE.burst, baseY: y, groundAt: now, strikes: 0, strikeAt: 0 }
}

/** After a teleport or knockback: start over from here. */
export function resetMoveState(mv, y, now) {
  mv.budget = MOVE.burst
  mv.baseY = y
  mv.groundAt = now
}

/** Is there a solid block under any corner of a body standing at (x, y, z)? */
export function supported(world, x, y, z) {
  const fy = Math.floor(y - 0.08)
  const hw = PLAYER.halfW - 0.001
  for (const dx of [-hw, hw]) {
    for (const dz of [-hw, hw]) {
      if (world.isSolid(Math.floor(x + dx), fy, Math.floor(z + dz))) return true
    }
  }
  return false
}

/**
 * Checks a reported move from `from` to `to` (`{ x, y, z }`), `dt` seconds after the
 * last one. Returns null when it's fine, or 'speed' | 'fly' | 'wall'. Updates `mv`.
 */
export function checkMove(world, mv, from, to, dt, now, { speedMul = 1, jumpMul = 1 } = {}) {
  const maxSpeed = PLAYER.sprint * speedMul * MOVE.speedTolerance
  mv.budget = Math.min(MOVE.burst, mv.budget + maxSpeed * Math.max(0, dt))
  const dist = Math.hypot(to.x - from.x, to.z - from.z)
  if (dist > mv.budget + 0.05) return 'speed'
  mv.budget -= dist

  const cx = Math.floor(to.x)
  const cz = Math.floor(to.z)
  if (world.isSolid(cx, Math.floor(to.y + 0.1), cz) && world.isSolid(cx, Math.floor(to.y + 1.5), cz)) return 'wall'

  if (supported(world, to.x, to.y, to.z)) {
    mv.baseY = to.y
    mv.groundAt = now
    return null
  }
  if (to.y > mv.baseY + rise(PLAYER.jumpV * Math.max(1, jumpMul)) + MOVE.riseSlack) return 'fly'
  if (now - mv.groundAt > MOVE.hoverMs && to.y >= from.y - 0.01) return 'fly'
  return null
}
