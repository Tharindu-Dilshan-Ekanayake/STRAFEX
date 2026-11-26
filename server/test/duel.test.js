import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COMBAT, DUEL, FFA, HOTBAR, HP, INV_SIZE, MODES, OFFHAND } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { ARENA_FLOOR } from '../../shared/maps.js'
import { mulberry32 } from '../../shared/rng.js'
import { B, blockKey } from '../../shared/voxel.js'

/** A host on a fake clock, recording everything it sends. */
function makeHost(seed = 1) {
  const clock = { t: 1_000_000 }
  const sent = []
  const rewards = []
  const host = new GameHost({
    send: (cid, type, payload) => sent.push({ cid, type, payload }),
    onReward: (cid, r) => rewards.push({ cid, ...r }),
    now: () => clock.t,
    random: mulberry32(seed),
    log: () => {},
  })
  const tick = (ms) => {
    for (let i = 0; i < ms; i += 50) {
      clock.t += 50
      host.tick(0.05)
    }
  }
  return { host, sent, rewards, clock, tick }
}

/** Two players queued for `mode`, voted, and fighting (round one). */
function duelOf(mode = 'sword', seed = 1) {
  const h = makeHost(seed)
  h.host.join('a', 'Ann')
  h.host.join('b', 'Bo')
  h.host.message('a', 'queue', { mode })
  h.host.message('b', 'queue', { mode })
  h.tick(100)
  const arena = [...h.host.arenas.values()].find((x) => x.kind === 'duel')
  h.host.message('a', 'voteMap', { map: 'meadow' })
  h.host.message('b', 'voteMap', { map: 'meadow' })
  h.tick(100)
  h.tick(DUEL.countdownMs + 100)
  return { ...h, arena, a: h.host.entOf('a'), b: h.host.entOf('b') }
}

/** Puts two fighters face to face, a step apart, out of their no-damage windows. */
function faceOff(h, a, b) {
  const c = h.arena.center
  Object.assign(a, { x: c.x, y: ARENA_FLOOR + 1, z: c.z, yaw: Math.PI, hurtUntil: 0, lastAttackAt: 0, anim: 0, wasAir: false })
  Object.assign(b, { x: c.x, y: ARENA_FLOOR + 1, z: c.z + 1.5, yaw: 0, hurtUntil: 0, lastAttackAt: 0, anim: 0, wasAir: false })
}

test('two players in the same queue: map vote, rounds, a winner, rewards, back to the lobby', () => {
  const h = duelOf('sword')
  const { host, arena, a, b } = h
  assert.equal(arena.mapId, 'meadow', 'both voted for it')
  assert.equal(arena.phase, 'fight')
  assert.equal(a.zone, 'match')
  assert.equal(a.armor.tier, 'diamond')
  assert.equal(a.inv[0].id, 'diamond_sword')
  assert.ok(h.sent.some((m) => m.cid === 'a' && m.type === 'match' && m.payload.kind === 'duel' && m.payload.map === 'meadow'))
  // Sword is first to 3: Ann takes three rounds.
  for (let r = 0; r < MODES.sword.ft; r += 1) {
    assert.equal(arena.phase, 'fight', `round ${r + 1} is on`)
    host.kill(arena, b, a, 'melee')
    if (r < MODES.sword.ft - 1) {
      assert.equal(arena.phase, 'between')
      h.tick(DUEL.betweenMs + DUEL.countdownMs + 200)
      assert.equal(b.alive, true, 'back for the next round')
      assert.equal(b.hp, HP)
    }
  }
  assert.equal(arena.phase, 'ended')
  const end = h.sent.find((m) => m.cid === 'b' && m.type === 'duelEnd').payload
  assert.equal(end.winner, a.eid)
  assert.deepEqual(end.score.map((s) => s.wins), [3, 0])
  const ra = h.rewards.find((r) => r.cid === 'a')
  const rb = h.rewards.find((r) => r.cid === 'b')
  assert.equal(ra.win, true)
  assert.equal(ra.kills, 3)
  assert.equal(rb.win, false)
  h.tick(DUEL.endMs + 100)
  assert.equal(host.arenas.size, 0)
  assert.equal(a.zone, 'lobby')
  assert.equal(b.zone, 'lobby')
})

test('alone in the queue, a bot steps in; play again goes straight back in the queue', () => {
  const h = makeHost(4)
  h.host.join('a', 'Ann')
  h.host.message('a', 'queue', { mode: 'axe' })
  h.tick(DUEL.soloBotMs + 100)
  const arena = [...h.host.arenas.values()][0]
  assert.ok(arena, 'a duel started')
  const bot = h.host.ents.get(arena.fighters[1])
  assert.equal(bot.bot, true)
  h.tick(DUEL.voteMs + DUEL.countdownMs + 300)
  assert.equal(arena.phase, 'fight')
  assert.ok(bot.inv.some((s) => s?.id === 'shield'), 'the bot has the axe kit')
  // The bot fights: within a while someone is hurt.
  h.tick(15_000)
  assert.ok(h.sent.some((m) => m.type === 'hurt'), 'blows were traded')
  // End it and play again.
  h.host.endDuel(arena, h.host.entOf('a'), false)
  h.host.message('a', 'requeue', {})
  assert.equal(h.host.members.get('a').queue, 'axe')
  assert.equal(h.host.entOf('a').zone, 'lobby')
})

test('leaving mid-duel is a forfeit: the other player wins', () => {
  const h = duelOf('uhc')
  h.host.leave('a')
  const end = h.sent.find((m) => m.cid === 'b' && m.type === 'duelEnd')?.payload
  assert.ok(end, 'the duel ended')
  assert.equal(end.forfeit, true)
  assert.equal(end.winner, h.b.eid)
  assert.equal(h.rewards.find((r) => r.cid === 'b').win, true)
  h.tick(DUEL.endMs + 100)
  assert.equal(h.b.zone, 'lobby')
})

test('armour soaks damage, the no-damage window stops stacking, falling hits are crits', () => {
  const h = duelOf('sword')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const first = host.melee(arena, a, b)
  assert.ok(first > 0 && first < 7, `diamond armour soaks some of the sword (${first})`)
  assert.ok(b.armor.dura[1] < 528, 'the chestplate wore down')
  // Straight away again: inside the window, nothing.
  a.lastAttackAt = 0
  assert.equal(host.melee(arena, a, b), 0)
  // After the window: a falling hit does more.
  h.clock.t += COMBAT.iframesMs + 10
  a.anim = 4
  a.falling = true
  const crit = host.melee(arena, a, b)
  assert.ok(crit > first, `crit ${crit} > ${first}`)
  assert.equal(a.stats.hits, 2)
  assert.equal(a.stats.best, 2)
  assert.equal(b.stats.taken, 2)
})

test('a shield blocks hits from the front; an axe knocks it down', () => {
  const h = duelOf('axe')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  host.setBlocking(b, true)
  h.clock.t += COMBAT.shieldWindupMs + 10
  a.sel = a.inv.findIndex((s) => s?.id === 'diamond_sword')
  assert.equal(host.melee(arena, a, b), 0, 'blocked')
  assert.ok(h.sent.some((m) => m.type === 'blocked'))
  // From behind, the shield doesn't help.
  h.clock.t += 300
  b.yaw = Math.PI
  a.lastAttackAt = 0
  assert.ok(host.melee(arena, a, b) > 0)
  // Face front again: the axe puts the shield down.
  b.yaw = 0
  host.setBlocking(b, false)
  host.setBlocking(b, true)
  h.clock.t += COMBAT.iframesMs + 200
  a.sel = a.inv.findIndex((s) => s?.id === 'diamond_axe')
  a.lastAttackAt = 0
  assert.equal(host.melee(arena, a, b), 0)
  assert.equal(b.blocking, false)
  assert.ok(b.shieldOffUntil > h.clock.t)
  host.setBlocking(b, true)
  assert.equal(b.blocking, false, "can't raise it while it's down")
})

test('two hands: a shield in the offhand blocks with the sword still held; swap and swap hands', () => {
  const h = duelOf('uhc')
  const { host, arena, a, b } = h
  assert.equal(b.inv.length, INV_SIZE)
  assert.equal(b.inv[OFFHAND].id, 'shield', 'the kit puts the shield in the left hand')
  assert.ok(b.inv.slice(HOTBAR, OFFHAND).some(Boolean), 'refills in the bag')
  assert.ok(!b.inv.slice(0, HOTBAR).some((s) => s?.id === 'shield'), 'not on the hotbar')
  // Sword in the right hand, shield up in the left: the hit is blocked.
  faceOff(h, a, b)
  b.sel = 0
  assert.equal(b.inv[0].id, 'diamond_sword')
  host.message('b', 'block', { on: true })
  assert.equal(b.blocking, true)
  h.clock.t += COMBAT.shieldWindupMs + 10
  assert.equal(host.melee(arena, a, b), 0, 'blocked by the offhand shield')
  // The snapshot carries the offhand item for everyone else.
  host.flush()
  const snap = h.sent.find((m) => m.cid === 'a' && m.type === 'snap')
  assert.ok(snap.payload.e.length % 9 === 0, 'nine numbers per entity')

  // F: the sword goes to the left hand and the shield to the right; still a shield in hand.
  host.message('b', 'swapHands')
  assert.equal(b.inv[OFFHAND].id, 'diamond_sword')
  assert.equal(b.inv[0].id, 'shield')
  assert.equal(b.blocking, true)
  // Shield into the bag: no shield in either hand, so it drops.
  const empty = b.inv.findIndex((s, i) => i >= HOTBAR && i < OFFHAND && !s)
  host.message('b', 'swap', { a: 0, b: empty })
  assert.equal(b.inv[empty].id, 'shield')
  assert.equal(b.blocking, false, 'shield put away: no longer blocking')
  host.message('b', 'block', { on: true })
  assert.equal(b.blocking, false)

  // The same item stacks instead of swapping; junk indices do nothing.
  const gap = b.inv.findIndex((s) => s?.id === 'gapple')
  const bagGap = b.inv.findIndex((s, i) => i >= HOTBAR && s?.id === 'gapple')
  const before = b.inv[gap].n + b.inv[bagGap].n
  host.message('b', 'swap', { a: bagGap, b: gap })
  assert.equal(b.inv[gap].n, before)
  assert.equal(b.inv[bagGap], null)
  host.message('b', 'swap', { a: -1, b: 999 })
  assert.equal(b.inv.length, INV_SIZE)

  // Eating from the left hand: gapple in the offhand, sword held.
  b.inv[OFFHAND] = { id: 'gapple', n: 2 }
  b.sel = b.inv.findIndex((s) => s?.id === 'diamond_axe')
  b.hp = 5
  b.lastUseAt = 0
  host.message('b', 'use', { hand: 'off' })
  assert.ok(b.hp > 5, 'ate the offhand apple')
  assert.equal(b.inv[OFFHAND].n, 1)
  assert.equal(b.inv[b.sel].id, 'diamond_axe', 'the right hand is untouched')
})

test('a revive charm saves you from a killing blow, once', () => {
  const h = duelOf('smp')
  const { host, arena, a, b } = h
  const charms = () => b.inv.filter((s) => s?.id === 'charm').length
  assert.equal(charms(), 2)
  host.damage(b, 999, a.eid, 'melee', { pierce: true })
  assert.equal(b.alive, true)
  assert.equal(b.hp, 2)
  assert.equal(charms(), 1)
  assert.ok(h.sent.some((m) => m.type === 'charm'))
  h.clock.t += 1000
  host.damage(b, 999, a.eid, 'melee', { pierce: true })
  h.clock.t += 1000
  host.damage(b, 999, a.eid, 'melee', { pierce: true })
  assert.equal(b.alive, false, 'out of charms')
})

test('the mace hits harder the further you fell, and you bounce', () => {
  const h = duelOf('mace')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const plain = host.melee(arena, a, b)
  h.clock.t += COMBAT.iframesMs + 10
  b.hp = HP
  a.lastAttackAt = 0
  // Coming down from 6 blocks up.
  Object.assign(a, { wasAir: true, peakY: a.y + 6, anim: 4, falling: true })
  const smash = host.melee(arena, a, b)
  assert.ok(smash > plain * 2, `smash ${smash} vs ${plain}`)
  assert.ok(h.sent.some((m) => m.type === 'smash'))
  assert.ok(a.noFallUntil > h.clock.t, 'no fall damage after a smash')
  assert.ok(h.sent.some((m) => m.cid === 'a' && m.type === 'kb' && m.payload.y > 0), 'the attacker bounces')
})

test('a gust charge at your feet launches you; falls hurt, but not after a gust', () => {
  const h = duelOf('mace')
  const { host, arena, a } = h
  const c = arena.center
  Object.assign(a, { x: c.x, y: ARENA_FLOOR + 1, z: c.z })
  host.gustBurst(arena, c.x, ARENA_FLOOR + 1.1, c.z, a.eid)
  const kb = h.sent.filter((m) => m.cid === 'a' && m.type === 'kb').at(-1).payload
  assert.ok(kb.y > 12, 'up you go')
  // Landing from high up right after: no damage.
  const hp = a.hp
  host.trackFall(a, arena, true, a.y + 10, h.clock.t)
  host.trackFall(a, arena, false, a.y, h.clock.t + 900)
  assert.equal(a.hp, hp)
  // Later, the same fall hurts.
  h.clock.t += 6000
  host.trackFall(a, arena, true, a.y + 10, h.clock.t)
  host.trackFall(a, arena, false, a.y, h.clock.t + 900)
  assert.ok(a.hp < hp)
})

test('blast crystals explode when hit; in a duel only placed blocks break', () => {
  const h = duelOf('crystal')
  const { host, arena, a, b } = h
  const c = arena.center
  const x = Math.floor(c.x)
  const z = Math.floor(c.z) + 3
  Object.assign(a, { x: c.x, y: ARENA_FLOOR + 1, z: c.z })
  Object.assign(b, { x: c.x, y: ARENA_FLOOR + 1, z: c.z + 4.5, hurtUntil: 0 })
  // The arena itself can't be broken.
  host.message('a', 'break', { x, y: ARENA_FLOOR, z })
  assert.notEqual(arena.world.get(x, ARENA_FLOOR, z), B.AIR)
  // Obsidian, then a crystal on it.
  a.sel = a.inv.findIndex((s) => s?.id === 'obsidian')
  assert.ok(host.placeBlock(arena, a, x, ARENA_FLOOR + 1, z))
  a.sel = a.inv.findIndex((s) => s?.id === 'crystal')
  assert.equal(host.placeBlock(arena, a, x + 1, ARENA_FLOOR + 1, z), false, 'not on grass')
  assert.ok(host.placeBlock(arena, a, x, ARENA_FLOOR + 2, z))
  assert.equal(arena.world.get(x, ARENA_FLOOR + 2, z), B.CRYSTAL)
  const hp = b.hp
  host.message('a', 'break', { x, y: ARENA_FLOOR + 2, z })
  assert.equal(arena.world.get(x, ARENA_FLOOR + 2, z), B.AIR)
  assert.ok(h.sent.some((m) => m.type === 'boom'))
  assert.ok(b.hp < hp, 'the blast hurt the opponent')
  assert.equal(arena.world.get(x, ARENA_FLOOR + 1, z), B.OBSIDIAN, 'obsidian survives')
  assert.ok(arena.placed.has(blockKey(x, ARENA_FLOOR + 1, z)))
})

test('Spirelands: pick a kit, kills heal and pay, death sends you to the kit picker, bots fill in, the world mends', () => {
  const h = makeHost(7)
  const { host } = h
  host.join('p', 'Pat')
  host.message('p', 'ffa', {})
  const me = host.entOf('p')
  assert.equal(me.zone, 'spec')
  assert.ok(h.sent.some((m) => m.type === 'match' && m.payload.kind === 'ffa'))
  host.message('p', 'kit', { mode: 'sword' })
  assert.equal(me.alive, true)
  assert.equal(me.inv[0].id, 'diamond_sword')
  h.tick(2000)
  const arena = host.arenas.get('ffa')
  const bots = [...host.ents.values()].filter((e) => e.bot && e.arena === 'ffa')
  assert.equal(bots.length, Math.min(FFA.maxBots, FFA.population - 1))
  // A kill: healed and counted.
  const victim = bots[0]
  me.hp = 8
  host.kill(arena, victim, me, 'melee')
  assert.equal(me.hp, 8 + FFA.killHeal)
  assert.equal(me.lifeKills, 1)
  // Dying pays out the life and asks for a kit.
  host.kill(arena, me, bots[1], 'melee')
  assert.equal(me.zone, 'spec')
  const r = h.rewards.at(-1)
  assert.equal(r.kind, 'ffa')
  assert.equal(r.kills, 1)
  h.tick(100)
  assert.ok(h.sent.some((m) => m.cid === 'p' && m.type === 'phase' && m.payload.needKit))
  // Broken ground grows back.
  host.message('p', 'kit', { mode: 'uhc' })
  const s = arena.spawns[0]
  const gx = Math.floor(s.x) + 2
  const gz = Math.floor(s.z)
  const gy = arena.world.surface(gx, gz)
  const before = arena.world.get(gx, gy, gz)
  host.setBlock(arena, gx, gy, gz, B.AIR)
  h.tick(FFA.restoreMs + 6000)
  assert.equal(arena.world.get(gx, gy, gz), before)
  // Nobody left: the bots go.
  host.message('p', 'lobby', {})
  h.tick(200)
  assert.equal([...host.ents.values()].filter((e) => e.bot).length, 0)
})

test('Spirelands: bots fill in for a few players, all leave once five real players are in, and fifty fit', () => {
  const h = makeHost(3)
  const { host } = h
  const bots = () => [...host.ents.values()].filter((e) => e.bot && e.arena === 'ffa')
  const enter = (n) => {
    const id = `p${n}`
    host.join(id, `P${n}`)
    host.message(id, 'ffa', {})
    host.message(id, 'kit', { mode: 'sword' })
  }
  enter(0)
  h.tick(1000)
  assert.equal(bots().length, FFA.maxBots, 'one player: bots to fight')
  for (let n = 1; n < FFA.botsOffAt - 1; n += 1) enter(n)
  h.tick(1000)
  assert.ok(bots().length > 0, 'four players: still a bot or two')
  enter(FFA.botsOffAt - 1)
  h.tick(200)
  assert.equal(bots().length, 0, 'five real players: the bots are gone')
  h.tick(FFA.botRespawnMs + 2000)
  assert.equal(bots().length, 0, 'and they stay gone')
  // A full server: everyone in Spirelands, alive and fighting.
  for (let n = FFA.botsOffAt; n < FFA.maxPlayers; n += 1) enter(n)
  h.tick(500)
  const people = [...host.ents.values()].filter((e) => !e.bot && e.arena === 'ffa' && e.alive)
  assert.equal(people.length, FFA.maxPlayers)
  assert.equal(bots().length, 0)
  // Back down to a few: the bots come back to keep it lively.
  for (let n = 3; n < FFA.maxPlayers; n += 1) host.leave(`p${n}`)
  h.tick(2000)
  assert.ok(bots().length > 0, 'three left: bots fill in again')
})
