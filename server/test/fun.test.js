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
    duelBots: true,
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
  const mid = FFA_SIZE.x / 2
  const far = FFA_SIZE.x - 3
  for (const [x, z] of [[2, mid], [far, mid], [mid, 2], [mid, far]]) assert.equal(world.get(x, FFA_SEA, z), B.WATER)
  // Nobody walks (or swims) off the side of the world.
  assert.equal(world.isSolid(-1, FFA_SEA, mid), true)
  assert.equal(world.isSolid(FFA_SIZE.x, FFA_SEA, mid), true)
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

test('Spirelands loot chests: open one for gear, it is gone, and it fills again later', async () => {
  const { LOOT } = await import('../../shared/balance.js')
  const { B } = await import('../../shared/voxel.js')
  const h = makeHost()
  const { host } = h
  host.join('a', 'Ann')
  host.message('a', 'ffa', {})
  host.message('a', 'kit', { mode: 'sword' })
  h.tick(200)
  const arena = host.arenas.get('ffa')
  assert.ok(arena.chests.length >= 30, `plenty of chests (${arena.chests.length})`)
  const c = arena.chests[0]
  assert.equal(arena.world.get(c.x, c.y, c.z), B.LOOT_CHEST)
  const a = host.entOf('a')
  const before = a.inv.filter(Boolean).length
  // Too far away: nothing.
  host.message('a', 'loot', { x: c.x, y: c.y, z: c.z })
  assert.equal(arena.world.get(c.x, c.y, c.z), B.LOOT_CHEST)
  // Next to it: open.
  Object.assign(a, { x: c.x + 1.5, y: c.y, z: c.z + 0.5 })
  host.message('a', 'loot', { x: c.x, y: c.y, z: c.z })
  assert.equal(arena.world.get(c.x, c.y, c.z), B.AIR, 'opened')
  assert.ok(a.inv.filter(Boolean).length > before || h.sent.some((m) => m.type === 'looted'), 'gear in the inventory')
  const looted = h.sent.find((m) => m.cid === 'a' && m.type === 'looted')
  assert.ok(looted && looted.payload.items.length > 0)
  // Opening it again does nothing; later it is back.
  host.message('a', 'loot', { x: c.x, y: c.y, z: c.z })
  Object.assign(a, { x: c.x + 6, z: c.z + 6 })
  h.tick(LOOT.refillMs + 1000)
  assert.equal(arena.world.get(c.x, c.y, c.z), B.LOOT_CHEST, 'filled again')
})

test('jump berries: bushes on the island; break one for berries, eat one and jump ten times as high, no fall damage', async () => {
  const { EFFECTS, ITEMS } = await import('../../shared/balance.js')
  const { B } = await import('../../shared/voxel.js')
  const { world } = generateSpirelands()
  let bushes = 0
  for (let x = 0; x < world.sx; x += 1) for (let z = 0; z < world.sz; z += 1) {
    const y = world.surface(x, z)
    if (world.get(x, y + 1, z) === B.BERRY_BUSH) bushes += 1
  }
  assert.ok(bushes >= 40, `bushes about (${bushes})`)
  assert.ok(EFFECTS.leap.jumpMul ** 2 >= 9.5, 'about ten times the height')
  const h = makeHost()
  const { host } = h
  host.join('a', 'Ann')
  host.message('a', 'ffa', {})
  host.message('a', 'kit', { mode: 'sword' })
  h.tick(200)
  const a = host.entOf('a')
  a.inv[1] = { id: 'jump_berry', n: 2 }
  a.sel = 1
  a.lastUseAt = 0
  host.useItem(a, 1, [0, 0, -1])
  assert.ok(a.effects.leap > h.clock.t, 'leaping')
  assert.ok(a.noFallUntil > h.clock.t + ITEMS.jump_berry.dur * 1000, 'no fall damage until after it ends')
  assert.equal(a.inv[1].n, 1)
})

test('a full server: looks go out only when they change, kills send a small update; snapshots carry only who is near', () => {
  const h = makeHost()
  const { host } = h
  for (let i = 0; i < 6; i += 1) {
    host.join(`p${i}`, `P${i}`)
    host.message(`p${i}`, 'ffa', {})
    host.message(`p${i}`, 'kit', { mode: 'sword' })
  }
  h.tick(1000)
  h.sent.length = 0
  // A death: state only, no looks.
  const arena = host.arenas.get('ffa')
  const [a, b] = [host.entOf('p0'), host.entOf('p1')]
  host.kill(arena, b, a, 'melee')
  h.tick(400)
  assert.ok(h.sent.some((m) => m.type === 'rstate'), 'small state update')
  assert.ok(!h.sent.some((m) => m.type === 'roster'), 'no full roster for a kill')
  const st = h.sent.find((m) => m.cid === 'p2' && m.type === 'rstate').payload.s
  const i = st.indexOf(b.eid)
  assert.equal(st[i + 3], 0, 'they show as down')
  // Someone new: the full roster, looks and all.
  h.sent.length = 0
  host.join('p9', 'P9')
  h.tick(400)
  assert.ok(h.sent.some((m) => m.type === 'roster'))
  // Snapshots in Spirelands: someone far across the island is left out.
  const c = host.entOf('p2')
  const d = host.entOf('p3')
  Object.assign(d, { x: c.x + 200, z: c.z })
  h.sent.length = 0
  h.tick(200)
  const snap = h.sent.filter((m) => m.cid === 'p2' && m.type === 'snap').at(-1).payload.e
  const eids = snap.filter((_, k) => k % 9 === 0)
  assert.ok(!eids.includes(d.eid), 'far player not sent')
  assert.ok(eids.includes(c.eid), 'yourself (and anyone near) still in it')
})

test('Spirelands resources: iron and diamond ore (diamonds deep), mountains, caves and crafting tables', async () => {
  const { B } = await import('../../shared/voxel.js')
  const { world } = generateSpirelands()
  let iron = 0
  let diamond = 0
  let deepest = 0
  let tables = 0
  let caveAir = 0
  let peak = 0
  for (let x = 0; x < world.sx; x += 1) {
    for (let z = 0; z < world.sz; z += 1) {
      const top = world.surface(x, z)
      if (top > peak) peak = top
      for (let y = 0; y < world.sy; y += 1) {
        const id = world.get(x, y, z)
        if (id === B.IRON_ORE) iron += 1
        else if (id === B.DIAMOND_ORE) {
          diamond += 1
          deepest = Math.max(deepest, y)
        } else if (id === B.CRAFTING_TABLE) tables += 1
        else if (id === B.AIR && y > 3 && y < top - 2) caveAir += 1
      }
    }
  }
  assert.ok(iron > 500, `iron ore (${iron})`)
  assert.ok(diamond > 20 && diamond < iron / 4, `diamonds, rarer (${diamond})`)
  assert.ok(deepest < 16, 'diamonds only deep down')
  assert.ok(tables >= 8, `crafting tables (${tables})`)
  assert.ok(caveAir > 300, `caves under the surface (${caveAir} air cells)`)
  assert.ok(peak > 34, `mountains (highest ground ${peak})`)
})

test('upgrades: at a crafting table, mined iron and diamonds make better gear; armour only ever goes up', async () => {
  const { B } = await import('../../shared/voxel.js')
  const { ARMOR, breakSeconds, mineSpeed } = await import('../../shared/balance.js')
  const h = makeHost()
  const { host } = h
  host.join('a', 'Ann')
  host.message('a', 'ffa', {})
  host.message('a', 'kit', { mode: 'sword' })
  h.tick(200)
  const a = host.entOf('a')
  const arena = host.arenas.get('ffa')
  host.give(a, 'iron', 30)
  host.give(a, 'diamond', 20)
  host.give(a, 'planks', 20)
  host.give(a, 'obsidian', 2)
  // Away from any table: refused.
  const tableNear = () => host.nearTable(a)
  if (tableNear()) Object.assign(a, { x: 30.5, z: 30.5 })
  const before = host.count(a, 'iron')
  host.message('a', 'craft', { id: 'iron_pickaxe' })
  if (!tableNear()) {
    assert.equal(host.count(a, 'iron_pickaxe'), 0, 'needs a crafting table')
    assert.equal(host.count(a, 'iron'), before)
  }
  // Put a table beside her: now it works.
  const x = Math.floor(a.x) + 1
  const z = Math.floor(a.z)
  arena.world.set(x, Math.floor(a.y), z, B.CRAFTING_TABLE)
  host.message('a', 'craft', { id: 'iron_pickaxe' })
  assert.equal(host.count(a, 'iron_pickaxe'), 1)
  host.message('a', 'craft', { id: 'cinder_sword' })
  assert.equal(host.count(a, 'cinder_sword'), 1, 'the kit diamond sword upgraded')
  assert.equal(host.count(a, 'diamond_sword'), 0, 'used up in the upgrade')
  // Armour: the sword kit wears diamond. Iron is a step down: refused. Cindersteel: yes.
  assert.equal(a.armor.tier, 'diamond')
  host.message('a', 'craft', { id: 'armor_iron' })
  assert.equal(a.armor.tier, 'diamond')
  host.give(a, 'obsidian', 6)
  host.message('a', 'craft', { id: 'armor_cinder' })
  assert.equal(a.armor.tier, 'cindersteel')
  assert.deepEqual(a.armor.dura, ARMOR.cindersteel.dura)
  // Worn armour mended with iron.
  a.armor.dura[1] = 10
  host.message('a', 'craft', { id: 'armor_repair' })
  assert.equal(a.armor.dura[1], ARMOR.cindersteel.dura[1])
  // The pickaxe mines stone and ore three times as fast; dirt no faster.
  assert.equal(breakSeconds(2.2, mineSpeed('iron_pickaxe', 2.2)), 2.2 / 3)
  assert.equal(mineSpeed('iron_pickaxe', 0.5), 1)
})
