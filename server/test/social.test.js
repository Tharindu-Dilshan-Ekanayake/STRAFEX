import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DUEL, QUICK_CHAT_MS } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { ARENA_FLOOR } from '../../shared/maps.js'
import { mulberry32 } from '../../shared/rng.js'

test('quick chat reaches everyone in your zone, one line at a time', () => {
  let t = 1_000_000
  const sent = []
  const host = new GameHost({ send: (cid, type, payload) => sent.push({ cid, type, payload }), now: () => t, random: mulberry32(5), log: () => {} })
  host.join('a', 'Ann')
  host.join('b', 'Bo')
  host.message('a', 'qc', { i: 0 })
  const lines = sent.filter((m) => m.type === 'qc')
  assert.deepEqual(lines.map((m) => m.cid).sort(), ['a', 'b'])
  assert.equal(lines[0].payload.name, 'Ann')
  assert.equal(lines[0].payload.i, 0)
  // Too soon, out of range, junk: nothing.
  host.message('a', 'qc', { i: 1 })
  host.message('b', 'qc', { i: 99 })
  host.message('b', 'qc', { i: 'x' })
  assert.equal(sent.filter((m) => m.type === 'qc').length, 2)
  t += QUICK_CHAT_MS
  host.message('a', 'qc', { i: 2 })
  assert.equal(sent.filter((m) => m.type === 'qc').length, 4)
})

test('in a duel, the opponent sees what you do (mining, eating, building); the lobby does not', () => {
  let t = 1_000_000
  const sent = []
  const host = new GameHost({ send: (cid, type, payload) => sent.push({ cid, type, payload }), now: () => t, random: mulberry32(8), log: () => {} })
  const step = (ms) => {
    for (let i = 0; i < ms; i += 50) {
      t += 50
      host.tick(0.05)
    }
  }
  host.join('a', 'Ann')
  host.join('b', 'Bo')
  host.join('c', 'Cy')
  host.message('a', 'queue', { mode: 'uhc' })
  host.message('b', 'queue', { mode: 'uhc' })
  step(DUEL.voteMs + DUEL.countdownMs + 300)
  const a = host.entOf('a')
  const arena = host.arenas.get(a.arena)
  assert.equal(arena.phase, 'fight')
  const toB = (type) => sent.filter((m) => m.cid === 'b' && m.type === type && m.payload.eid === a.eid)
  host.message('a', 'dig', { x: 5, y: 6, z: 7 })
  assert.deepEqual(toB('act').at(-1).payload, { eid: a.eid, kind: 'dig', x: 5, y: 6, z: 7 })
  assert.ok(!sent.some((m) => m.cid === 'a' && m.type === 'act'), 'not echoed back')
  assert.ok(!sent.some((m) => m.cid === 'c' && m.type === 'act'), 'the lobby sees nothing')
  // Eating (an apple from the UHC kit).
  t += 1500
  const apple = a.inv.findIndex((s) => s?.id === 'gapple')
  host.useItem(a, apple, [0, 0, 1])
  assert.equal(toB('act').at(-1).payload.kind, 'food')
  assert.ok(a.absorb > 0, 'golden hearts')
  // Building: the arm swings.
  const before = toB('swing').length
  a.sel = a.inv.findIndex((s) => s?.id === 'planks')
  const c = arena.center
  Object.assign(a, { x: c.x, y: ARENA_FLOOR + 1, z: c.z })
  assert.ok(host.placeBlock(arena, a, Math.floor(c.x) + 2, ARENA_FLOOR + 1, Math.floor(c.z)))
  assert.equal(toB('swing').length, before + 1)
})
