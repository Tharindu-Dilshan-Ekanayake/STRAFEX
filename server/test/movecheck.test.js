import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DUEL } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { ARENA_FLOOR } from '../../shared/maps.js'
import { checkMove, createMoveState } from '../../shared/movecheck.js'
import { createBody, stepBody } from '../../shared/physics.js'
import { mulberry32 } from '../../shared/rng.js'
import { B, VoxelWorld } from '../../shared/voxel.js'

/** A floor at y=4 over x<20, a one-block step and a pillar, empty space beyond x=20. */
function course() {
  const w = new VoxelWorld(40, 24, 24)
  for (let x = 0; x < 20; x += 1) for (let z = 0; z < 24; z += 1) w.set(x, 4, z, B.STONE)
  w.set(10, 5, 12, B.STONE)
  return w
}

/** Runs real physics with `input(i)` at 60 Hz, reporting at 20 Hz; returns any flags. */
function play(w, body, frames, input, opts = {}) {
  const mv = createMoveState(body.y, 0)
  let from = { x: body.x, y: body.y, z: body.z }
  const flags = []
  for (let i = 1; i <= frames; i += 1) {
    stepBody(w, body, input(i), 1 / 60, opts.speedMul || 1, opts.jumpMul || 1)
    if (i % 3 === 0) {
      const to = { x: body.x, y: body.y, z: body.z }
      const bad = checkMove(w, mv, from, to, 0.05, (i / 60) * 1000, opts)
      if (bad) flags.push(`${bad}@${i}`)
      from = to
    }
  }
  return flags
}

test('movement checks never flag honest play: sprinting, jumping, steps, falling, potions', () => {
  const w = course()
  // Sprint-jumping around on the floor.
  assert.deepEqual(play(w, createBody(2.5, 5, 2.5), 600, (i) => ({ moveX: Math.cos(i / 90), moveZ: Math.sin(i / 90), sprint: true, jump: i % 40 < 3 })), [])
  // Auto-jumping up the step.
  assert.deepEqual(play(w, createBody(8.5, 5, 12.5), 120, () => ({ moveX: 1, autoJump: true })), [])
  // Sprinting off the edge and falling into the void.
  assert.deepEqual(play(w, createBody(16.5, 5, 6.5), 240, () => ({ moveX: 1, sprint: true })), [])
  // Speed and jump potions.
  const opts = { speedMul: 1.35, jumpMul: 1.3 }
  assert.deepEqual(play(w, createBody(2.5, 5, 2.5), 400, (i) => ({ moveZ: 1, sprint: true, jump: i % 30 < 2 }), opts), [])
})

test('movement checks catch speed hacks, flying and walking through walls', () => {
  const w = course()
  // Twice sprint speed, steadily: caught within a couple of seconds.
  const mv = createMoveState(5, 0)
  let x = 1
  let flag = null
  for (let i = 1; i < 60 && !flag; i += 1) {
    const to = { x: x + 0.6, y: 5, z: 3 }
    flag = checkMove(w, mv, { x, y: 5, z: 3 }, to, 0.05, i * 50)
    x = to.x
  }
  assert.equal(flag, 'speed')
  // Rising into the air with nothing underneath.
  const fly = createMoveState(5, 0)
  assert.equal(checkMove(w, fly, { x: 2, y: 5, z: 2 }, { x: 2, y: 7.5, z: 2 }, 0.05, 50), 'fly')
  // Hanging over the void without falling.
  const hover = createMoveState(5, 0)
  let bad = null
  for (let i = 1; i < 80 && !bad; i += 1) bad = checkMove(w, hover, { x: 25, y: 5.5, z: 5 }, { x: 25, y: 5.5, z: 5 }, 0.05, i * 50)
  assert.equal(bad, 'fly')
  // Inside the floor.
  w.set(5, 5, 5, B.STONE)
  w.set(5, 6, 5, B.STONE)
  assert.equal(checkMove(w, createMoveState(5, 0), { x: 4.5, y: 5, z: 5.5 }, { x: 5.5, y: 5, z: 5.5 }, 0.05, 50), 'wall')
})

test('the host puts a cheating player back and ignores their stale reports', () => {
  let t = 1_000_000
  const sent = []
  const host = new GameHost({ send: (cid, type, payload) => sent.push({ type, payload }), now: () => t, random: mulberry32(3), log: () => {} })
  host.join('p1', 'Runner')
  host.message('p1', 'queue', { mode: 'sword' })
  for (let i = 0; i < DUEL.soloBotMs + DUEL.voteMs + DUEL.countdownMs + 2000; i += 50) {
    t += 50
    host.tick(0.05)
  }
  const me = host.entOf('p1')
  const arena = host.arenas.get(me.arena)
  assert.equal(arena.phase, 'fight')
  const c = arena.spawns[0]
  // Standing on the arena floor at the spawn, well past the spawn teleport's grace.
  Object.assign(me, { x: c.x, y: ARENA_FLOOR + 1, z: c.z, posAt: t, tpGrace: 0, awaitTp: null })
  me.mv.groundAt = t
  t += 50
  host.message('p1', 'pos', { x: me.x + 0.25, y: me.y, z: me.z })
  assert.ok(Math.abs(me.x - (c.x + 0.25)) < 1e-6, 'a normal step is accepted')
  // A 30-block jump: refused, corrected.
  const before = { x: me.x, z: me.z }
  t += 50
  host.message('p1', 'pos', { x: me.x + 30, y: me.y, z: me.z })
  assert.equal(me.x, before.x)
  assert.equal(sent.at(-1).type, 'tp')
  // Reports still coming from the cheat position are ignored until the client takes the fix.
  t += 50
  host.message('p1', 'pos', { x: before.x + 31, y: me.y, z: before.z })
  assert.equal(me.x, before.x)
  t += 50
  host.message('p1', 'pos', { x: before.x + 0.1, y: me.y, z: before.z })
  assert.ok(Math.abs(me.x - (before.x + 0.1)) < 1e-6)
})
