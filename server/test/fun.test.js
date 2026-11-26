import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOUNTY_STREAK, DAY_MS, DUEL, REWARDS } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { applyRoundResult, claimParkour, createProfile } from '../../shared/logic.js'
import { FFA_SEA, FFA_SIZE, generateLobby, generateSpirelands } from '../../shared/maps.js'
import { checkMove, createMoveState } from '../../shared/movecheck.js'
import { createBody, PAD_V, stepBody, SWIM } from '../../shared/physics.js'
import { mulberry32 } from '../../shared/rng.js'
import { B, VoxelWorld } from '../../shared/voxel.js'

function makeHost(extra = {}) {
  const clock = { t: 20_000 * DAY_MS }
  const sent = []
  const rewards = []
  const parkour = []
  const host = new GameHost({
    send: (cid, type, payload) => sent.push({ cid, type, payload }),
    onReward: (cid, r) => rewards.push({ cid, ...r }),
    onParkour: (cid, ms) => parkour.push({ cid, ms }),
    now: () => clock.t,
    random: mulberry32(3),
    log: () => {},
    ...extra,
  })
  const tick = (ms) => {
    for (let i = 0; i < ms; i += 50) {
      clock.t += 50
      host.tick(0.05)
    }
  }
  return { host, sent, rewards, parkour, clock, tick }
}

test('the lobby has room for a full server, and everything stands on solid ground', () => {
  const lobby = generateLobby()
  const w = lobby.world
  const standing = (p) => w.isSolid(p.x, p.y - 1, p.z) && !w.isSolid(p.x, p.y, p.z) && !w.isSolid(p.x, p.y + 1, p.z)
  assert.deepEqual(lobby.stations.map((s) => s.id).sort(), ['case:cape', 'case:sword', 'duels', 'ffa'])
  assert.ok(standing(lobby.spawn), 'spawn')
  assert.ok(standing(lobby.parkour.start), 'parkour start')
  assert.equal(w.get(lobby.parkour.start.x, lobby.parkour.start.y - 1, lobby.parkour.start.z), B.GOLD)
  assert.equal(w.get(lobby.parkour.finish.x, lobby.parkour.finish.y - 1, lobby.parkour.finish.z), B.FINISH)
  assert.ok(lobby.dummies.length >= 6)
  // Fifty people join: all of them in the lobby, spread round the spawn.
  const h = makeHost()
  for (let i = 0; i < 50; i += 1) h.host.join(`p${i}`, `P${i}`)
  const ents = [...h.host.ents.values()]
  assert.equal(ents.length, 50)
  assert.ok(ents.every((e) => e.zone === 'lobby' && Math.hypot(e.x - lobby.spawn.x, e.z - lobby.spawn.z) <= 5.01))
})

test('the parkour pays once a day, only from the top, and the lobby hears about it', () => {
  const h = makeHost()
  h.host.join('a', 'Ann')
  const me = h.host.entOf('a')
  const f = h.host.lobby.parkour.finish
  // Not at the top: nothing.
  h.host.message('a', 'parkour', { ms: 40_000 })
  assert.equal(h.parkour.length, 0)
  Object.assign(me, { x: f.x, y: f.y, z: f.z })
  h.host.message('a', 'parkour', { ms: 40_000 })
  assert.deepEqual(h.parkour, [{ cid: 'a', ms: 40_000 }])
  assert.ok(h.sent.some((m) => m.type === 'toast' && /finished the parkour in 40\.0s/.test(m.payload.text)))
  // Straight away again: ignored. Impossible times: ignored.
  h.host.message('a', 'parkour', { ms: 30_000 })
  h.clock.t += 20_000
  h.host.message('a', 'parkour', { ms: 10 })
  assert.equal(h.parkour.length, 1)
  // The reward itself: cash the first time today, the best time kept.
  const p = createProfile('a', 'Ann')
  const cash = p.cash
  assert.deepEqual(claimParkour(p, 40_000, h.clock.t), { cash: REWARDS.parkour, best: true })
  assert.deepEqual(claimParkour(p, 50_000, h.clock.t), { cash: 0, best: false })
  assert.deepEqual(claimParkour(p, 35_000, h.clock.t + DAY_MS), { cash: REWARDS.parkour, best: true })
  assert.equal(p.cash, cash + 2 * REWARDS.parkour)
  assert.equal(p.stats.parkourBest, 35_000)
})

test('Spirelands: a streak puts a bounty up, ending it pays, and kill effects burst', () => {
  const h = makeHost()
  h.host.join('a', 'Ann')
  h.host.join('b', 'Bo')
  for (const cid of ['a', 'b']) {
    h.host.message(cid, 'ffa', {})
    h.host.message(cid, 'kit', { mode: 'sword' })
  }
  const arena = h.host.arenas.get('ffa')
  const a = h.host.entOf('a')
  const b = h.host.entOf('b')
  a.cape = 'flame'
  b.lifeKills = BOUNTY_STREAK
  h.host.kill(arena, b, a, 'melee')
  assert.equal(a.bounties, 1)
  assert.ok(h.sent.some((m) => m.type === 'toast' && /claimed Bo's bounty/.test(m.payload.text)))
  const fx = h.sent.find((m) => m.type === 'kfx')
  assert.ok(fx && fx.payload.fx === 'flame', 'the kill effect went out')
  // Ann's life ends: the bounty pays with it.
  h.host.kill(arena, a, null, 'void')
  const r = h.rewards.find((x) => x.cid === 'a')
  assert.equal(r.bounties, 1)
  const p = createProfile('a', 'Ann')
  const res = applyRoundResult(p, r, h.clock.t)
  assert.equal(res.cash, r.kills * REWARDS.kill + REWARDS.bounty)
})

test('jump pads throw you up, and the movement check lets that through', () => {
  const w = new VoxelWorld(20, 30, 20)
  for (let x = 0; x < 20; x += 1) for (let z = 0; z < 20; z += 1) w.set(x, 4, z, B.STONE)
  w.set(10, 4, 10, B.JUMP_PAD)
  const body = createBody(10.5, 5, 10.5)
  stepBody(w, body, {}, 1 / 60)
  assert.equal(body.vy, PAD_V)
  assert.equal(body.bounced, true)
  // Fly it at 60 Hz, reporting at 20 Hz: no flags.
  const mv = createMoveState(5, 0)
  let from = { x: body.x, y: body.y, z: body.z }
  const flags = []
  for (let i = 1; i <= 180; i += 1) {
    stepBody(w, body, {}, 1 / 60)
    if (i % 3 === 0) {
      const to = { x: body.x, y: body.y, z: body.z }
      const bad = checkMove(w, mv, from, to, 0.05, (i / 60) * 1000)
      if (bad) flags.push(bad)
      from = to
    }
  }
  assert.deepEqual(flags, [])
  // The same rise with no pad under you: flying.
  const cheat = createMoveState(5, 0)
  assert.equal(checkMove(w, cheat, { x: 3.5, y: 5, z: 3.5 }, { x: 3.5, y: 9, z: 3.5 }, 0.05, 50), 'fly')
})

test('bots are easy: duels and Spirelands', () => {
  const h = makeHost()
  h.host.join('a', 'Ann')
  h.host.message('a', 'queue', { mode: 'sword' })
  h.tick(DUEL.soloBotMs + 100)
  const duel = [...h.host.arenas.values()].find((x) => x.kind === 'duel')
  assert.equal(duel.botLevel, 'easy')
  assert.equal(h.host.ffaArena().botLevel, 'easy')
})

test('Spirelands is an island in the sea: spawns on land, water all round, walls at the edge', () => {
  const { world, spawns } = generateSpirelands()
  assert.equal(world.sx, FFA_SIZE.x)
  for (const s of spawns) assert.equal(world.get(s.x, s.y - 1, s.z), B.GRASS)
  // Open sea at every edge.
  for (const [x, z] of [[2, 96], [189, 96], [96, 2], [96, 189]]) assert.equal(world.get(x, FFA_SEA, z), B.WATER)
  // Nobody walks (or swims) off the side of the world.
  assert.equal(world.isSolid(-1, FFA_SEA, 96), true)
  assert.equal(world.isSolid(FFA_SIZE.x, FFA_SEA, 96), true)
})

test('swimming: you sink slowly, swim up holding jump, climb out onto the shore, and nothing flags it', () => {
  // A pool: floor at y=2, water up to y=7, a shore at y=7 to the east.
  const w = new VoxelWorld(48, 20, 24)
  for (let x = 0; x < 48; x += 1) {
    for (let z = 0; z < 24; z += 1) {
      w.set(x, 2, z, B.SAND)
      if (x >= 16) for (let y = 3; y <= 7; y += 1) w.set(x, y, z, B.SAND)
      else for (let y = 3; y <= 7; y += 1) w.set(x, y, z, B.WATER)
    }
  }
  const body = createBody(8.5, 7.5, 8.5)
  for (let i = 0; i < 30; i += 1) stepBody(w, body, {}, 1 / 60)
  assert.ok(body.inWater)
  assert.ok(body.vy >= -SWIM.maxSink - 1e-6, 'a slow sink, never a plunge')
  const low = body.y
  for (let i = 0; i < 40; i += 1) stepBody(w, body, { jump: true }, 1 / 60)
  assert.ok(body.y > low, 'swam up')
  // Swim east into the shore holding jump: out onto the sand.
  const mv = createMoveState(body.y, 0)
  let from = { x: body.x, y: body.y, z: body.z }
  const flags = []
  for (let i = 1; i <= 360; i += 1) {
    stepBody(w, body, { moveX: 1, jump: true }, 1 / 60)
    if (i % 3 === 0) {
      const to = { x: body.x, y: body.y, z: body.z }
      const bad = checkMove(w, mv, from, to, 0.05, (i / 60) * 1000)
      if (bad) flags.push(bad)
      from = to
    }
  }
  assert.ok(body.x > 16.5 && body.y >= 8, `on the shore (${body.x.toFixed(1)}, ${body.y.toFixed(1)})`)
  assert.deepEqual(flags, [])
})
