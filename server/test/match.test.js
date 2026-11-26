import assert from 'node:assert/strict'
import { test } from 'node:test'

import { casePool, CASES, ITEMS, lavaHeight, LUCKY_LOOT, MAP_CHOICES, MODES, ROUND, rollLucky } from '../../shared/balance.js'
import { GameHost, ITEM_IDS } from '../../shared/host.js'
import { applyRoundResult, claimDaily, createProfile, normalizeProfile, openCase } from '../../shared/logic.js'
import { generateLobby, generateMatch, ISLAND_TOP, MAP_IDS } from '../../shared/maps.js'
import { createBody, stepBody } from '../../shared/physics.js'
import { mulberry32 } from '../../shared/rng.js'
import { B, isLucky, raycastVoxels, VoxelWorld } from '../../shared/voxel.js'

/** A host on a fake clock, with one or more fake players recording what they're sent. */
function makeHost(seed = 1) {
  let t = 1_000_000
  const sent = new Map()
  const rewards = []
  const host = new GameHost({
    send: (cid, type, payload) => {
      if (!sent.has(cid)) sent.set(cid, [])
      sent.get(cid).push({ type, payload })
    },
    onReward: (cid, result) => rewards.push({ cid, ...result }),
    now: () => t,
    random: mulberry32(seed),
  })
  const advance = (ms, step = 50) => {
    for (let i = 0; i < ms; i += step) {
      t += step
      host.tick(step / 1000)
    }
  }
  /** Ticks until `pred()` holds (at most `ms`). */
  const until = (pred, ms = 120_000) => {
    for (let i = 0; i < ms && !pred(); i += 50) {
      t += 50
      host.tick(0.05)
    }
    return pred()
  }
  return { host, sent, rewards, advance, until, now: () => t }
}

const last = (list, type) => [...list].reverse().find((m) => m.type === type)?.payload

test('every map generates islands, cages, and lucky blocks for each mode', () => {
  for (const map of MAP_IDS) {
    for (const mode of Object.keys(MODES)) {
      const g = generateMatch(map, 42, mode)
      assert.equal(g.spawns.length, 8)
      for (const s of g.spawns) {
        assert.equal(g.world.get(s.x, s.y - 1, s.z), B.CAGE, `${map}: cage floor under spawn`)
        assert.ok(g.world.isSolid(s.x, ISLAND_TOP, s.z), `${map}: island under the cage`)
      }
      assert.ok(g.lucky.length >= 8 * MODES[mode].luckyPerIsland - 4, `${map}/${mode}: lucky blocks`)
      for (const l of g.lucky) assert.ok(isLucky(g.world.get(l.x, l.y, l.z)))
      if (mode === 'maxluck') assert.ok(g.lucky.every((l) => l.rare))
    }
  }
  // Same seed, same world: clients rebuild it from just these two numbers.
  assert.deepEqual(generateMatch('candy', 7).world.data, generateMatch('candy', 7).world.data)
})

test('lobby has the case stations and a floor to stand on', () => {
  const lobby = generateLobby()
  assert.equal(lobby.stations.length, 2)
  assert.ok(lobby.world.isSolid(lobby.spawn.x, lobby.spawn.y - 1, lobby.spawn.z))
})

test('physics: falls, lands, walks, jumps one block, sneaking stops at the edge', () => {
  const w = new VoxelWorld(16, 16, 16)
  for (let x = 0; x < 8; x += 1) for (let z = 0; z < 16; z += 1) w.set(x, 4, z, B.STONE)
  w.set(4, 5, 8, B.STONE)
  const body = createBody(2.5, 9, 8.5)
  for (let i = 0; i < 60; i += 1) stepBody(w, body, {}, 1 / 60)
  assert.ok(body.onGround)
  assert.ok(Math.abs(body.y - 5) < 1e-6)
  // Walk +x into the step with auto-jump: ends up on top of it.
  for (let i = 0; i < 60; i += 1) stepBody(w, body, { moveX: 1, autoJump: true }, 1 / 60)
  assert.ok(body.x > 4)
  // Sneak toward the edge at x = 8: never falls.
  const s = createBody(6.5, 5, 3.5)
  for (let i = 0; i < 180; i += 1) stepBody(w, s, { moveX: 1, sneak: true }, 1 / 60)
  assert.ok(s.y >= 5 - 1e-6 && s.x < 8.35, `stayed on the edge (x=${s.x}, y=${s.y})`)
  // Without sneaking you walk off.
  const f = createBody(6.5, 5, 3.5)
  for (let i = 0; i < 120; i += 1) stepBody(w, f, { moveX: 1 }, 1 / 60)
  assert.ok(f.y < 4)
})

test('voxel raycast finds the first block and its face', () => {
  const w = new VoxelWorld(8, 8, 8)
  w.set(5, 2, 2, B.DIRT)
  const hit = raycastVoxels(w, 0.5, 2.5, 2.5, 1, 0, 0, 10)
  assert.equal(hit.x, 5)
  assert.equal(hit.nx, -1)
})

test('loot tables and cases are well formed', () => {
  for (const e of LUCKY_LOOT) {
    if (e.give) for (const [id] of e.give) assert.ok(ITEMS[id], `item ${id}`)
  }
  const rng = mulberry32(3)
  for (let i = 0; i < 200; i += 1) assert.ok(rollLucky(rng, i % 2 === 0).text)
  for (const id of Object.keys(CASES)) {
    const pool = casePool(id)
    const total = pool.reduce((s, e) => s + e.chance, 0)
    assert.ok(Math.abs(total - 1) < 1e-9)
  }
  assert.ok(lavaHeight(0) < lavaHeight(ROUND.fightMs))
})

test('profile: cases cost cash, duplicates refund, rewards add up, daily streak', () => {
  const p = createProfile('a', 'A')
  p.cash = 10_000
  const r = openCase(p, 'cape', mulberry32(5))
  assert.ok(r.ok && p.capes.includes(r.id))
  assert.equal(p.cash, 10_000 - CASES.cape.price + r.refund)
  assert.equal(openCase({ ...createProfile('b', 'B'), cash: 0 }, 'cape').ok, false)
  const reward = applyRoundResult(p, { kills: 2, placement: 1, win: true })
  assert.ok(reward.cash > 0 && p.wins === 1 && p.kills === 2)
  assert.ok(claimDaily(p, 0).ok)
  assert.equal(claimDaily(p, 1000).ok, false)
  const restored = normalizeProfile(JSON.parse(JSON.stringify(p)), 'a', 'A')
  assert.deepEqual(restored.capes, p.capes)
})

test('a full round: lobby countdown, cages, fight, a winner, everyone back in the lobby', () => {
  const { host, sent, rewards, advance, until } = makeHost(11)
  host.join('p1', 'Tester')
  host.message('p1', 'vote', { mode: 'lavarush' })
  assert.equal(host.phase, 'intermission')
  assert.ok(until(() => host.phase === 'cages'), 'the round starts after the votes')
  assert.equal(host.match.mode, 'lavarush')
  const fighters = host.aliveFighters()
  assert.equal(fighters.length, ROUND.minFighters)
  assert.ok(last(sent.get('p1'), 'match'))
  advance(ROUND.cagesMs + 100)
  assert.equal(host.phase, 'fight')
  // The cages are gone.
  for (const s of host.match.spawns) assert.notEqual(host.match.world.get(s.x, s.y - 1, s.z), B.CAGE)

  // The player stands still on their island. Bots loot, bridge, fight; the lava ends it.
  const me = host.entOf('p1')
  let reported = false
  for (let i = 0; i < (ROUND.fightMs + 10_000) / 1000 && host.phase === 'fight'; i += 1) {
    advance(1000)
    if (me.alive && !reported) {
      // Our client keeps reporting a standing position on the island.
      host.message('p1', 'pos', { x: me.x, y: me.y, z: me.z, yaw: 0, pitch: 0, a: 0 })
    }
  }
  assert.equal(host.phase, 'ended')
  assert.ok(last(sent.get('p1'), 'win'))
  assert.ok(rewards.some((r) => r.cid === 'p1'), 'player rewarded')
  const opened = host.match.lucky.filter((l) => !isLucky(host.match.world.get(l.x, l.y, l.z))).length
  assert.ok(opened > 0, 'bots opened lucky blocks')
  advance(ROUND.endMs + 100)
  assert.equal(me.zone, 'lobby')
  assert.ok(![...host.ents.values()].some((e) => e.bot), 'bots gone')
  assert.equal(host.phase, 'intermission')
})

test('players break blocks (after digging), get drops, place blocks and open lucky blocks', () => {
  const { host, sent, advance } = makeHost(2)
  host.join('p1', 'Builder')
  advance(ROUND.intermissionMs + ROUND.cagesMs + 300)
  assert.equal(host.phase, 'fight')
  const me = host.entOf('p1')
  // Drop the player onto their island.
  const s = host.match.spawns[me.island]
  me.x = s.x
  me.y = ISLAND_TOP + 1
  me.z = s.z
  const w = host.match.world
  // Find a lucky block on our island and dig it.
  const lucky = host.match.lucky.find((l) => Math.hypot(l.x - s.x, l.z - s.z) < 5)
  me.x = lucky.x + 1.5
  me.z = lucky.z + 0.5
  host.message('p1', 'break', { x: lucky.x, y: lucky.y, z: lucky.z })
  assert.ok(isLucky(w.get(lucky.x, lucky.y, lucky.z)), 'instant break refused')
  host.message('p1', 'dig', { x: lucky.x, y: lucky.y, z: lucky.z })
  advance(1200)
  host.message('p1', 'break', { x: lucky.x, y: lucky.y, z: lucky.z })
  assert.equal(w.get(lucky.x, lucky.y, lucky.z), B.AIR)
  assert.ok(last(sent.get('p1'), 'loot'))
  assert.ok(me.inv.some((slot) => slot?.id === 'wool'))
  // Place a block next to the island edge with the wool.
  me.sel = me.inv.findIndex((slot) => slot?.id === 'wool')
  const count = me.inv[me.sel].n
  host.message('p1', 'place', { x: lucky.x, y: lucky.y, z: lucky.z })
  assert.equal(w.get(lucky.x, lucky.y, lucky.z), B.WOOL_WHITE)
  assert.equal(me.inv[me.sel]?.n ?? 0, count - 1)
  // Too far away: refused and corrected.
  host.message('p1', 'place', { x: lucky.x, y: lucky.y + 20, z: lucky.z })
  assert.equal(w.get(lucky.x, lucky.y + 20, lucky.z), B.AIR)
})

test('melee hits hurt, knock back, and can eliminate', () => {
  const { host, sent, advance } = makeHost(4)
  host.join('a', 'A')
  host.join('b', 'B')
  advance(ROUND.intermissionMs + ROUND.cagesMs + 300)
  const a = host.entOf('a')
  const b = host.entOf('b')
  // Put both somewhere quiet, next to each other, on the middle island.
  const mid = host.match.middle
  Object.assign(a, { x: mid.x + 8, y: mid.y, z: mid.z })
  Object.assign(b, { x: mid.x + 9.5, y: mid.y, z: mid.z })
  const hp = b.hp
  host.message('a', 'attack', { eid: b.eid })
  assert.ok(b.hp < hp)
  assert.ok(last(sent.get('b'), 'kb'))
  // Too soon for another hit.
  const after = b.hp
  host.message('a', 'attack', { eid: b.eid })
  assert.equal(b.hp, after)
  b.hp = 1
  advance(500)
  Object.assign(a, { x: mid.x + 8, y: mid.y, z: mid.z })
  Object.assign(b, { x: mid.x + 9.5, y: mid.y, z: mid.z })
  host.message('a', 'attack', { eid: b.eid })
  assert.equal(b.alive, false)
  assert.equal(b.zone, 'spec')
  assert.equal(a.kills, 1)
  assert.ok(last(sent.get('b'), 'dead'))
})

test('a player\'s Bloxity avatar look is cleaned and shared in the roster', () => {
  const { host, sent, advance } = makeHost(9)
  host.join('a', 'A')
  host.join('b', 'B')
  host.message('a', 'look', { equipped: { hatId: '12', skinId: 3, bad: { x: 1 } }, proportions: { height: 1.2, armLength: 99 } })
  advance(100)
  const roster = last(sent.get('b'), 'roster')
  const me = roster.list.find((e) => e.name === 'A')
  assert.deepEqual(JSON.parse(me.look), { equipped: { hatId: '12', skinId: 3 }, proportions: { height: 1.2 } })
})

test('the lobby votes on the mode first, then the map, and everyone holds a sword there', () => {
  const { host, sent, advance } = makeHost(13)
  host.join('a', 'A')
  host.join('b', 'B')
  advance(100)
  const snap = last(sent.get('a'), 'snap')
  assert.equal(snap.e[7], ITEM_IDS.indexOf('diamond_sword'))
  // First a countdown: votes made now count, but the vote only closes once it's over.
  assert.equal(last(sent.get('a'), 'phase').voteStage, 'wait')
  host.message('a', 'vote', { mode: 'classic' })
  host.message('b', 'vote', { mode: 'classic' })
  advance(1000)
  assert.equal(last(sent.get('a'), 'phase').voteStage, 'wait', 'the countdown always runs out')
  advance(ROUND.waitMs)
  assert.equal(last(sent.get('a'), 'phase').voteStage, 'map', 'everyone had voted: straight to the map')
  // A new round to try the mode step itself.
  host.lockedMode = null
  host.voteStage = 'mode'
  host.stageEnds = host.now() + ROUND.modeVoteMs
  for (const m of host.members.values()) m.vote = null
  // Map votes wait for step two.
  host.message('a', 'voteMap', { map: 'candy' })
  assert.equal(host.members.get('a').mapVote, null)
  host.message('a', 'vote', { mode: 'teams2' })
  host.message('b', 'vote', { mode: 'teams2' })
  advance(100)
  let phase = last(sent.get('a'), 'phase')
  assert.equal(phase.voteStage, 'map')
  assert.equal(phase.chosenMode, 'teams2')
  host.message('a', 'vote', { mode: 'classic' })
  assert.equal(host.members.get('a').vote, 'teams2', 'no mode votes once the mode is chosen')
  // Three different maps are on offer; one that isn't can't be voted for.
  assert.equal(new Set(phase.mapOptions).size, MAP_CHOICES)
  const offMenu = MAP_IDS.find((id) => !phase.mapOptions.includes(id))
  host.message('a', 'voteMap', { map: offMenu })
  assert.equal(host.members.get('a').mapVote, null)
  // Both pick the map: the round starts straight away.
  const pick = phase.mapOptions[1]
  host.message('a', 'voteMap', { map: pick })
  host.message('b', 'voteMap', { map: pick })
  host.message('b', 'voteMap', { map: 'nope' })
  advance(100)
  assert.equal(host.phase, 'cages')
  assert.equal(host.match.mapId, pick)
  assert.equal(host.match.mode, 'teams2')
  assert.equal(host.aliveFighters().length, 2, 'nobody voted for bots: none by default')
})

test('a no-bots round is just the people (and alone, bots join anyway)', () => {
  const { host, until } = makeHost(17)
  host.join('a', 'A')
  host.join('b', 'B')
  host.message('a', 'voteBots', { level: 'off' })
  host.message('b', 'voteBots', { level: 'off' })
  assert.ok(until(() => host.phase === 'cages'))
  assert.equal(host.aliveFighters().length, 2)
  assert.ok(host.aliveFighters().every((e) => !e.bot))

  const solo = makeHost(18)
  solo.host.join('a', 'A')
  solo.host.message('a', 'voteBots', { level: 'off' })
  assert.ok(solo.until(() => solo.host.phase === 'cages'))
  assert.equal(solo.host.aliveFighters().length, 8)
})

test('someone arriving mid-round can join it by taking over a bot', () => {
  const { host, sent, until, advance } = makeHost(19)
  host.join('a', 'A')
  assert.ok(until(() => host.phase === 'fight'))
  advance(1000)
  host.join('late', 'Late')
  advance(100)
  assert.equal(last(sent.get('late'), 'phase').canJoin, true)
  const bots = host.aliveFighters().filter((e) => e.bot).length
  host.message('late', 'joinRound')
  const late = host.entOf('late')
  assert.equal(late.zone, 'match')
  assert.ok(late.alive)
  assert.equal(host.aliveFighters().filter((e) => e.bot).length, bots - 1, 'took a bot\'s place')
  assert.ok(last(sent.get('late'), 'match'), 'got the world')
  // Can't join twice.
  advance(100)
  assert.equal(last(sent.get('late'), 'phase').canJoin, false)
})

test('team modes: teammates spawn side by side, can\'t hurt each other, and win together', () => {
  for (const [mode, teamCount] of [['teams4', 4], ['teams3', 3], ['teams2', 2]]) {
    const { host, sent, rewards, advance } = makeHost(21)
    host.join('a', 'A')
    host.join('b', 'B')
    host.message('a', 'vote', { mode })
    host.message('a', 'voteBots', { level: 'normal' })
    advance(ROUND.intermissionMs + ROUND.cagesMs + 300)
    const fighters = host.aliveFighters()
    const size = host.match.teamSize
    assert.equal(new Set(fighters.map((e) => e.team)).size, teamCount, `${mode}: ${teamCount} teams`)
    // The two people are dealt onto different teams (balanced), bots fill the rest.
    assert.notEqual(host.entOf('a').team, host.entOf('b').team, `${mode}: players spread across teams`)
    if (mode === 'teams3') {
      const counts = [0, 1, 2].map((t) => fighters.filter((e) => e.team === t))
      const small = counts.find((m) => m.length === 2)
      const big = counts.find((m) => m.length === 3)
      assert.ok(small && big && small[0].maxHp > big[0].maxHp, 'the team of two gets extra hearts')
    }
    // Teammates are on neighbouring islands.
    for (const e of fighters) {
      const mates = fighters.filter((o) => o.team === e.team && o !== e)
      const ringGap = (p, q) => Math.min((p - q + 8) % 8, (q - p + 8) % 8)
      assert.ok(mates.every((o) => ringGap(o.island, e.island) <= size - 1), `${mode}: mates nearby`)
    }
    // A teammate's hit does nothing; an enemy's hit hurts.
    const a = host.entOf('a')
    const mate = fighters.find((e) => e !== a && e.team === a.team)
    const enemy = fighters.find((e) => e.team !== a.team)
    for (const t of [mate, enemy]) Object.assign(t, { x: a.x + 1.5, y: a.y, z: a.z })
    const mateHp = mate.hp
    host.message('a', 'attack', { eid: mate.eid })
    assert.equal(mate.hp, mateHp, 'no friendly fire')
    advance(500)
    Object.assign(enemy, { x: a.x + 1.5, y: a.y, z: a.z })
    const enemyHp = enemy.hp
    host.message('a', 'attack', { eid: enemy.eid })
    assert.ok(enemy.hp < enemyHp, 'enemies take damage')
    // Everyone not on A's team falls: A's team wins, together.
    for (const e of fighters) if (e.team !== a.team) host.kill(e, a.eid, 'melee')
    assert.equal(host.phase, 'ended')
    assert.ok(last(sent.get('a'), 'win').team === a.team)
    const aReward = rewards.find((r) => r.cid === 'a')
    assert.equal(aReward.win, true)
  }
})

test('bots play at the difficulty the lobby votes for', () => {
  const { host, advance } = makeHost(31)
  host.join('a', 'A')
  host.message('a', 'voteBots', { level: 'hard' })
  advance(ROUND.intermissionMs + 200)
  assert.equal(host.match.botLevel, 'hard')
  const bots = host.aliveFighters().filter((e) => e.bot)
  assert.ok(bots.length === 7 && bots.every((b) => b.brain.skill >= 0.8))
})

test('once every real player is out, the bots stop and the round ends', () => {
  const { host, until } = makeHost(23)
  host.join('a', 'A')
  host.join('b', 'B')
  host.message('a', 'voteBots', { level: 'normal' })
  assert.ok(until(() => host.phase === 'fight'))
  assert.ok(host.aliveFighters().some((e) => e.bot), 'bots in the round')
  // One is knocked out and watches; the other closes the game.
  host.kill(host.entOf('a'), null, 'void')
  assert.equal(host.phase, 'fight', 'someone real is still in')
  host.message('a', 'lobby')
  host.leave('b')
  host.tick(0.05)
  assert.equal(host.phase, 'ended', 'only bots left: over')
})

test('alone in the room, the round has bots by default (and the vote says so)', () => {
  const { host, sent, until } = makeHost(29)
  host.join('a', 'A')
  assert.ok(until(() => host.voteStage === 'map'))
  assert.equal(last(sent.get('a'), 'phase').chosenBots, 'normal')
  assert.ok(until(() => host.phase === 'cages'))
  assert.equal(host.aliveFighters().length, 8)
})
