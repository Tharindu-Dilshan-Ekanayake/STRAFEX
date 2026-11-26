import assert from 'node:assert/strict'
import { test } from 'node:test'

import { QUICK_CHAT_MS, ROUND } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { ISLAND_TOP } from '../../shared/maps.js'
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

test('everyone in the round sees what a player is doing: mining, building, eating', () => {
  let t = 1_000_000
  const sent = []
  const host = new GameHost({ send: (cid, type, payload) => sent.push({ cid, type, payload }), now: () => t, random: mulberry32(8), log: () => {} })
  host.join('a', 'Ann')
  host.join('b', 'Bo')
  for (let i = 0; i < ROUND.intermissionMs + ROUND.cagesMs + 400; i += 50) {
    t += 50
    host.tick(0.05)
  }
  const a = host.entOf('a')
  const toB = (type) => sent.filter((m) => m.cid === 'b' && m.type === type && m.payload.eid === a.eid)
  // Mining: B learns which block.
  host.message('a', 'dig', { x: 5, y: 6, z: 7 })
  assert.deepEqual(toB('act').at(-1).payload, { eid: a.eid, kind: 'dig', x: 5, y: 6, z: 7 })
  assert.ok(!sent.some((m) => m.cid === 'a' && m.type === 'act'), 'not echoed back')
  // Eating.
  a.inv[1] = { id: 'gapple', n: 2 }
  t += 500
  host.useItem(a, 1, [0, 0, 1])
  assert.equal(toB('act').at(-1).payload.kind, 'food')
  // Building: the arm swings.
  const before = toB('swing').length
  const s = host.match.spawns[a.island]
  a.inv[2] = { id: 'wool', n: 5 }
  a.sel = 2
  Object.assign(a, { x: s.x, y: ISLAND_TOP + 1, z: s.z })
  // Any free cell on the island top a few blocks away.
  let cell = null
  for (let dx = -4; dx <= 4 && !cell; dx += 1) {
    for (let dz = -4; dz <= 4 && !cell; dz += 1) {
      const x = Math.floor(s.x) + dx
      const z = Math.floor(s.z) + dz
      if (Math.abs(dx) + Math.abs(dz) > 1 && host.canPlaceAt(x, ISLAND_TOP + 1, z)) cell = [x, ISLAND_TOP + 1, z]
    }
  }
  assert.ok(cell, 'found a cell')
  const placed = host.placeBlock(a, ...cell)
  assert.ok(placed)
  assert.equal(toB('swing').length, before + 1)
})
