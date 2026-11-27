import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AIR, COMBAT, DUEL, FFA, FIRE, HOTBAR, HP, INV_SIZE, MODES, OFFHAND, RECIPES, WATER } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { ARENA_FLOOR } from '../../shared/maps.js'
import { mulberry32 } from '../../shared/rng.js'
import { B, blockKey, isWater, waterLevel } from '../../shared/voxel.js'

/** A host on a fake clock, recording everything it sends. */
function makeHost(seed = 1, opts = {}) {
  const clock = { t: 1_000_000 }
  const sent = []
  const rewards = []
  const host = new GameHost({
    send: (cid, type, payload) => sent.push({ cid, type, payload }),
    onReward: (cid, r) => rewards.push({ cid, ...r }),
    now: () => clock.t,
    random: mulberry32(seed),
    log: () => {},
    ...opts,
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

test('a real opponent first; nobody within 10 seconds and a bot steps in (not while playing Spirelands)', () => {
  const h = makeHost(4)
  h.host.join('a', 'Ann')
  h.host.join('b', 'Bo')
  h.host.message('a', 'queue', { mode: 'axe' })
  h.tick(DUEL.botFillMs - 1000)
  assert.equal(h.host.arenas.size, 0, 'still looking for a real player')
  // Someone joins in time: the two of them.
  h.host.message('b', 'queue', { mode: 'axe' })
  h.tick(200)
  const duel = [...h.host.arenas.values()][0]
  assert.ok(duel.fighters.every((eid) => !h.host.ents.get(eid).bot), 'two real players')
  // Alone for ten seconds in the lobby: a bot.
  const h2 = makeHost(5)
  h2.host.join('c', 'Cy')
  h2.host.join('d', 'Di')
  h2.host.message('c', 'queue', { mode: 'sword' })
  h2.tick(DUEL.botFillMs + 200)
  const botDuel = [...h2.host.arenas.values()].find((x) => x.kind === 'duel')
  assert.ok(botDuel, 'a bot duel')
  assert.ok(botDuel.fighters.some((eid) => h2.host.ents.get(eid).bot))
  // Searching from Spirelands: no bot - it waits for a real player there.
  h2.host.message('d', 'queue', { mode: 'sword' })
  h2.host.message('d', 'ffa', {})
  h2.host.message('d', 'kit', { mode: 'sword' })
  h2.tick(DUEL.botFillMs + 2000)
  assert.equal(h2.host.entOf('d').arena, 'ffa', 'still in Spirelands')
  assert.equal(h2.host.members.get('d').queue, 'sword', 'still searching')
})

test('test hosts with duelBots: alone in the queue, a bot steps in; play again goes straight back in the queue', () => {
  const h = makeHost(4, { duelBots: true })
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
  assert.equal(bots.length, FFA.population - 1)
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

test('Spirelands: bots fill in for a few players, bots fill Spirelands up to ten fighters, none from ten real players on, and a full server fits', () => {
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
  assert.equal(bots().length, FFA.population - 1, 'one player: nine bots, ten fighters')
  for (let n = 1; n < 5; n += 1) enter(n)
  h.tick(1000)
  assert.equal(bots().length, FFA.population - 5, 'five players: five bots')
  for (let n = 5; n < FFA.population - 1; n += 1) enter(n)
  h.tick(1000)
  assert.equal(bots().length, 1, 'nine players: one bot')
  enter(FFA.population - 1)
  h.tick(200)
  assert.equal(bots().length, 0, 'ten real players: the bots are gone')
  h.tick(FFA.botRespawnMs + 2000)
  assert.equal(bots().length, 0, 'and they stay gone')
  // A full server: everyone in Spirelands, alive and fighting.
  for (let n = FFA.population; n < FFA.maxPlayers; n += 1) enter(n)
  h.tick(500)
  const people = [...host.ents.values()].filter((e) => !e.bot && e.arena === 'ffa' && e.alive)
  assert.equal(people.length, FFA.maxPlayers)
  assert.equal(bots().length, 0)
  // Back down to a few: the bots come back to keep it lively.
  for (let n = 3; n < FFA.maxPlayers; n += 1) host.leave(`p${n}`)
  h.tick(2000)
  assert.ok(bots().length > 0, 'three left: bots fill in again')
})

test('mining fills your inventory; crafting turns it into gear', () => {
  const h = duelOf('uhc')
  const { host, arena, a } = h
  faceOff(h, a, h.b)
  const c = arena.center
  const planks = () => host.count(a, 'planks')
  // In a duel you can only break what was placed: place a block, mine it back.
  const before = planks()
  a.sel = a.inv.findIndex((s) => s?.id === 'planks')
  const x = Math.floor(c.x) + 1
  const y = ARENA_FLOOR + 1
  const z = Math.floor(c.z) - 1
  host.message('a', 'place', { x, y, z })
  assert.equal(arena.world.get(x, y, z), B.PLANKS)
  assert.equal(planks(), before - 1)
  host.message('a', 'dig', { x, y, z })
  h.clock.t += 3000
  host.message('a', 'break', { x, y, z })
  assert.equal(arena.world.get(x, y, z), B.AIR)
  assert.equal(planks(), before, 'the mined block came back')
  assert.ok(h.sent.some((m) => m.cid === 'a' && m.type === 'pickup' && m.payload.id === 'planks'))

  // Crafting: a shield from six planks; obsidian from stone bricks.
  const shields = host.count(a, 'shield')
  host.message('a', 'craft', { id: 'shield' })
  assert.equal(host.count(a, 'shield'), shields + 1)
  assert.equal(planks(), before - 6)
  const bricks = host.count(a, 'stone_bricks')
  host.message('a', 'craft', { id: 'obsidian' })
  assert.equal(host.count(a, 'obsidian'), 2)
  assert.equal(host.count(a, 'stone_bricks'), bricks - 4)
  assert.ok(h.sent.some((m) => m.cid === 'a' && m.type === 'crafted' && m.payload.id === 'obsidian'))
  // Not enough: nothing happens.
  for (const s of a.inv) if (s?.id === 'planks') s.n = 1
  host.message('a', 'craft', { id: 'shield' })
  assert.equal(host.count(a, 'shield'), shields + 1)
  assert.ok(RECIPES.every((r) => r.need.length && (r.out?.[1] > 0 || r.armor || r.repair)))
})

test('a fire arrow sets the ground and its target alight; water puts it out', () => {
  const h = duelOf('uhc')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const c = arena.center
  // Shot at the floor in front of you: a small patch catches.
  a.sel = a.inv.findIndex((s) => s?.id === 'flame_bow')
  assert.ok(a.sel >= 0, 'UHC has a fire bow')
  b.x = c.x + 6
  host.useItem(a, a.sel, [0, -1, -0.6], 1)
  h.tick(600)
  const fires = () => {
    let n = 0
    const w = arena.world
    for (let x = 0; x < w.sx; x += 1) for (let z = 0; z < w.sz; z += 1) for (let y = ARENA_FLOOR; y < ARENA_FLOOR + 4; y += 1) if (w.get(x, y, z) === B.FIRE) n += 1
    return n
  }
  const lit = fires()
  assert.ok(lit > 0 && lit <= FIRE.cells, `a small patch burns (${lit})`)
  assert.ok(h.sent.some((m) => m.type === 'ignite'))
  // Walk into it: you burn, and it hurts every second (armour doesn't help).
  const f = arena.fires[0]
  Object.assign(b, { x: f.x + 0.5, y: f.y, z: f.z + 0.5, hurtUntil: 0 })
  const hp = b.hp
  h.tick(100)
  assert.ok(b.effects.burn > h.clock.t, 'on fire')
  Object.assign(b, { x: c.x + 6, z: c.z + 6 })
  h.tick(2100)
  assert.ok(b.hp < hp, 'burning hurts')
  assert.equal(b.lastHitBy?.eid ?? a.eid, a.eid)
  // A water bucket tipped over yourself puts it out.
  b.inv[b.sel] = { id: 'water_bucket', n: 1 }
  host.message('b', 'use', {})
  assert.equal(b.effects.burn, undefined, 'out')
  assert.equal(b.inv[b.sel].id, 'bucket', 'the bucket is empty now')
  // The flames burn out on their own.
  h.tick(FIRE.lifeMs + 2000)
  assert.equal(fires(), 0)
})

test('buckets: pour water (it douses flames), scoop it back up', () => {
  const h = duelOf('uhc')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const c = arena.center
  a.sel = a.inv.findIndex((s) => s?.id === 'water_bucket')
  const x = Math.floor(c.x) + 1
  const y = ARENA_FLOOR + 1
  const z = Math.floor(c.z) - 1
  // Some fire right next to where it's poured, and someone burning there.
  host.igniteAt(arena, x + 1.5, y, z + 0.5, b.eid)
  assert.ok(arena.fires.length > 0)
  b.effects.burn = h.clock.t + 3000
  Object.assign(b, { x: x + 0.5, y, z: z + 1.5 })
  host.message('a', 'place', { x, y, z })
  assert.equal(arena.world.get(x, y, z), B.WATER)
  assert.equal(a.inv[a.sel].id, 'bucket')
  assert.equal(b.effects.burn, undefined, 'the splash put them out')
  assert.ok(arena.fires.every((f) => Math.hypot(f.x - x, f.z - z) > FIRE.douse), 'nearby flames went out')
  assert.ok(h.sent.some((m) => m.type === 'douse'))
  // Scoop it back: the bucket is full again and the water is gone.
  host.message('a', 'use', { x, y, z })
  assert.equal(a.inv[a.sel].id, 'water_bucket')
  assert.equal(arena.world.get(x, y, z), B.AIR)
  // Junk targets do nothing.
  a.inv[a.sel] = { id: 'bucket', n: 1 }
  host.message('a', 'use', { x: 'nope' })
  host.message('a', 'use', { x: c.x, y: ARENA_FLOOR, z: c.z })
  assert.equal(a.inv[a.sel].id, 'bucket')
})

test('two people searching different modes are paired at once, in the mode of whoever waited longer', () => {
  const h = makeHost(6)
  const { host } = h
  host.join('a', 'Ann')
  host.join('b', 'Bo')
  host.join('c', 'Cy')
  host.join('d', 'Di')
  host.message('a', 'queue', { mode: 'strafex' })
  h.tick(400)
  host.message('b', 'queue', { mode: 'pot' })
  h.tick(200)
  const arenas = () => [...host.arenas.values()].filter((x) => x.kind === 'duel')
  assert.equal(arenas().length, 1, 'paired straight away')
  const arena = arenas()[0]
  assert.equal(arena.mode, 'strafex', 'Ann was waiting first')
  assert.ok(arena.fighters.includes(host.entOf('a').eid) && arena.fighters.includes(host.entOf('b').eid))
  // Same mode still goes first: Cy and Di both pick sword; nobody is left waiting.
  host.message('c', 'queue', { mode: 'sword' })
  host.message('d', 'queue', { mode: 'sword' })
  h.tick(200)
  assert.equal(arenas().length, 2)
  assert.equal(arenas()[1].mode, 'sword')
})

test('water flows: a poured source falls and spreads up to 7 blocks, and dries up when scooped', () => {
  const h = duelOf('uhc')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const c = arena.center
  const w = arena.world
  const y = ARENA_FLOOR + 1
  const x = Math.floor(c.x) - 4
  const z = Math.floor(c.z) - 4
  // A pillar to pour from: water on top of it falls to the floor and spreads.
  for (let k = 0; k < 2; k += 1) w.set(x, y + k, z, B.STONE_BRICKS)
  a.x = x + 1.5
  a.z = z + 1.5
  a.sel = a.inv.findIndex((s) => s?.id === 'water_bucket')
  host.message('a', 'place', { x, y: y + 2, z })
  assert.equal(w.get(x, y + 2, z), B.WATER, 'the source on the pillar')
  h.tick(WATER.stepMs * 30)
  assert.ok(isWater(w.get(x + 1, y + 2, z)), 'spreads off the top')
  assert.ok(isWater(w.get(x + 1, y, z)), 'and falls to the floor')
  // On the floor it spreads, weaker each block, never past level 7.
  let far = 0
  for (let d = 1; d < 14; d += 1) if (isWater(w.get(x + d, y, z))) far = d
  assert.ok(far >= 4 && far <= 9, `spread ${far} blocks along the floor`)
  for (let d = 1; d <= far; d += 1) assert.ok(waterLevel(w.get(x + d, y, z)) <= 7)
  // Scoop the source: everything that came from it dries up.
  host.message('a', 'use', { x, y: y + 2, z })
  assert.equal(a.inv[a.sel].id, 'water_bucket')
  h.tick(WATER.stepMs * 40)
  let left = 0
  for (let dx = -10; dx <= 10; dx += 1) for (let dz = -10; dz <= 10; dz += 1) for (let dy = 0; dy < 4; dy += 1) if (isWater(w.get(x + dx, y + dy, z + dz))) left += 1
  assert.equal(left, 0, 'all dried up')
})

test('drowning: head under water uses up your air, then hurts; air comes back on the surface', () => {
  const h = duelOf('uhc')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const w = arena.world
  const c = arena.center
  const x = Math.floor(c.x) - 3
  const z = Math.floor(c.z) + 3
  const y = ARENA_FLOOR + 1
  // A deep pool of still water round the player, walled in.
  for (let dy = 0; dy < 3; dy += 1) w.set(x, y + dy, z, B.WATER)
  Object.assign(a, { x: x + 0.5, y, z: z + 0.5 })
  const hp = a.hp
  h.tick(AIR.ms - 1000)
  assert.ok(a.airBubbles < AIR.bubbles && a.airBubbles > 0, 'running out of air')
  assert.equal(a.hp, hp, 'not hurt yet')
  h.tick(2600)
  assert.ok(a.hp < hp, 'drowning')
  // Back to the surface: breath returns.
  Object.assign(a, { x: c.x + 6, y, z: c.z + 6 })
  h.tick(2500)
  assert.equal(a.airBubbles, AIR.bubbles)
  const me = h.sent.filter((m) => m.cid === 'a' && m.type === 'me').at(-1)
  assert.equal(me.payload.air, AIR.bubbles)
})

test('torches and campfires: crafted from wood; a campfire warms (heals) those beside it and burns whoever stands in it', async () => {
  const { CAMPFIRE } = await import('../../shared/balance.js')
  const h = duelOf('uhc')
  const { host, arena, a, b } = h
  faceOff(h, a, b)
  const c = arena.center
  // Wood into light.
  host.message('a', 'craft', { id: 'torch' })
  assert.equal(host.count(a, 'torch'), 4)
  host.message('a', 'craft', { id: 'campfire' })
  assert.equal(host.count(a, 'campfire'), 1)
  // Place the campfire on the floor beside Ann.
  const x = Math.floor(c.x) + 2
  const y = ARENA_FLOOR + 1
  const z = Math.floor(c.z) - 2
  a.sel = a.inv.findIndex((s) => s?.id === 'campfire')
  host.message('a', 'place', { x, y, z })
  assert.equal(arena.world.get(x, y, z), B.CAMPFIRE)
  assert.ok(arena.campfires.has(blockKey(x, y, z)))
  // Sitting beside it, hurt: it heals slowly.
  Object.assign(a, { x: x + 2.5, y, z: z + 0.5, hp: 10, lastHurtAt: h.clock.t })
  h.tick(CAMPFIRE.everyMs * 3 + 100)
  assert.ok(a.hp > 10, 'warmed back up')
  // Standing in it burns.
  Object.assign(b, { x: x + 0.5, y, z: z + 0.5, hurtUntil: 0 })
  h.tick(200)
  assert.ok(b.effects.burn > h.clock.t, 'on fire')
})

test('search for a duel while playing Spirelands: the moment an opponent turns up, you are pulled into the duel', () => {
  const h = makeHost(9)
  const { host } = h
  host.join('a', 'Ann')
  host.message('a', 'queue', { mode: 'sword' })
  host.message('a', 'ffa', {})
  host.message('a', 'kit', { mode: 'uhc' })
  h.tick(300)
  const a = host.entOf('a')
  assert.equal(a.arena, 'ffa', 'fighting in Spirelands')
  assert.equal(host.members.get('a').queue, 'sword', 'still searching')
  const phase = h.sent.filter((m) => m.cid === 'a' && m.type === 'phase').at(-1).payload
  assert.equal(phase.kind, 'ffa')
  assert.equal(phase.queue, 'sword', 'the queue bar shows in there')
  // Back to the lobby and in again: the search goes on.
  host.message('a', 'lobby', {})
  assert.equal(host.members.get('a').queue, 'sword')
  host.message('a', 'ffa', {})
  host.message('a', 'kit', { mode: 'uhc' })
  h.tick(300)
  // Someone else searches (any mode): a duel, and Ann is brought out of Spirelands to it.
  host.join('b', 'Bo')
  host.message('b', 'queue', { mode: 'axe' })
  h.tick(300)
  const duel = [...host.arenas.values()].find((x) => x.kind === 'duel')
  assert.ok(duel, 'paired')
  assert.equal(duel.mode, 'sword', 'Ann searched first')
  assert.notEqual(a.arena, 'ffa', 'out of Spirelands')
  assert.equal(host.members.get('a').duel, duel.key)
  assert.ok(h.sent.some((m) => m.cid === 'a' && m.type === 'lobby'), 'back to the lobby for the vote')
  h.tick(DUEL.voteMs + DUEL.countdownMs + 400)
  assert.equal(duel.phase, 'fight')
  assert.equal(a.arena, duel.key)
})
