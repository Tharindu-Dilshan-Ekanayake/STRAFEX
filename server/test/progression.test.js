import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DAY_MS, levelXp, QUESTS, QUESTS_PER_DAY, ROUND } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { addXp, applyRoundResult, createProfile, normalizeProfile, refreshQuests } from '../../shared/logic.js'
import { mulberry32 } from '../../shared/rng.js'
import { PlayerSession } from '../../shared/session.js'

const NOW = 20_000 * DAY_MS + 5000

test('XP levels you up, pays cash each level and a free case every fifth', () => {
  const p = createProfile('u1', 'A')
  const cash = p.cash
  const ups = addXp(p, levelXp(1) + levelXp(2) + 10)
  assert.equal(p.level, 3)
  assert.equal(p.xp, 10)
  assert.equal(ups.length, 2)
  assert.equal(p.cash, cash + ups[0].cash + ups[1].cash)
  // Up to level 5: a free case.
  let needed = 0
  for (let l = 3; l < 5; l += 1) needed += levelXp(l)
  const more = addXp(p, needed, mulberry32(1))
  assert.equal(p.level, 5)
  assert.ok(more.at(-1).case?.ok)
  assert.equal(p.stats.casesOpened, 1)
})

test('daily quests: three a day, the same for the same player, paying out when done', () => {
  const p = createProfile('player-7', 'Q')
  refreshQuests(p, NOW)
  assert.equal(p.quests.list.length, QUESTS_PER_DAY)
  const stats = p.quests.list.map((q) => QUESTS[q.id].stat)
  assert.equal(new Set(stats).size, QUESTS_PER_DAY, 'one quest per stat')
  const again = createProfile('player-7', 'Q')
  refreshQuests(again, NOW + 1000)
  assert.deepEqual(again.quests.list.map((q) => q.id), p.quests.list.map((q) => q.id))
  // A huge round finishes everything.
  const before = p.cash
  const r = applyRoundResult(p, { kills: 20, placement: 1, win: true, lucky: 50, placed: 200 }, NOW)
  const round = { kills: 20, wins: 1, lucky: 50, games: 1, placed: 200, top3: 1 }
  const expected = p.quests.list.filter((q) => round[QUESTS[q.id].stat] >= QUESTS[q.id].goal).map((q) => q.id)
  assert.deepEqual(r.quests.map((q) => q.id), expected)
  assert.ok(p.quests.list.every((q) => q.done === expected.includes(q.id)))
  assert.equal(p.cash, before + r.cash + r.quests.reduce((s, q) => s + q.cash, 0) + r.levelUps.reduce((s, u) => s + u.cash, 0))
  assert.ok(r.xp > 0 && r.levelUps.length >= 1)
  // Done quests don't pay twice; the next day brings new ones.
  const r2 = applyRoundResult(p, { kills: 20, placement: 1, win: true, lucky: 50, placed: 200 }, NOW)
  assert.ok(r2.quests.every((q) => !r.quests.some((d) => d.id === q.id)))
  refreshQuests(p, NOW + DAY_MS)
  assert.ok(p.quests.list.every((q) => !q.done && q.progress === 0))
})

test('old saves gain a level, XP and quests; junk is cleaned', () => {
  const old = { ...createProfile('x', 'Old') }
  delete old.level
  delete old.xp
  delete old.quests
  const p = normalizeProfile(old, 'x', 'Old')
  assert.equal(p.level, 1)
  assert.equal(p.xp, 0)
  assert.deepEqual(p.quests, { day: -1, swaps: 0, list: [] })
  const junk = normalizeProfile({ ...createProfile('x', 'J'), level: -4, xp: 'lots', quests: { day: 3, list: [{ id: 'nope' }, { id: 'win1', progress: -2 }] } }, 'x', 'J')
  assert.equal(junk.level, 1)
  assert.equal(junk.xp, 0)
  assert.deepEqual(junk.quests.list, [{ id: 'win1', progress: 0, done: false }])
})

test('a round counts lucky blocks and placed blocks and shows your level to everyone', () => {
  let t = NOW
  const sent = []
  const rewards = []
  const host = new GameHost({ send: (cid, type, payload) => sent.push({ cid, type, payload }), onReward: (cid, r) => rewards.push(r), now: () => t, random: mulberry32(9), log: () => {} })
  const profile = createProfile('p', 'Lvl')
  profile.level = 7
  const session = new PlayerSession(profile, { now: t, emit: () => {} })
  host.join('p', 'Lvl', session.look())
  t += 50
  host.tick(0.05)
  const roster = [...sent].reverse().find((m) => m.type === 'roster').payload.list
  assert.equal(roster.find((e) => e.name === 'Lvl').level, 7)
  assert.ok(roster.length >= 1)
  for (let i = 0; i < ROUND.intermissionMs + ROUND.cagesMs + 300; i += 50) {
    t += 50
    host.tick(0.05)
  }
  const me = host.entOf('p')
  me.lucky = 3
  me.placed = 12
  host.reward(me, 4)
  assert.equal(rewards[0].lucky, 3)
  assert.equal(rewards[0].placed, 12)
  const r = session.awardRound(rewards[0], t)
  assert.ok(r.xp >= 25 + 3 * 4)
})
