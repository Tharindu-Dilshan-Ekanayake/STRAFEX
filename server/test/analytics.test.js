import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summarize } from '../../shared/analytics.js'
import { ROUND } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { mulberry32 } from '../../shared/rng.js'
import { closeStorage, openStorage, recentEvents, recordEvent } from '../src/db.js'

test('a round reports how it went, anonymously, and the summary reads it', () => {
  let t = 1_000_000
  const events = []
  const host = new GameHost({ send: () => {}, onAnalytics: (type, data) => events.push({ type, at: t, data }), now: () => t, random: mulberry32(11), log: () => {} })
  host.join('p', 'Pat')
  host.message('p', 'tut', { step: 1 })
  host.message('p', 'tut', { step: 1 })
  host.message('p', 'tut', { step: 9 })
  const step = () => {
    t += 50
    host.tick(0.05)
  }
  while (host.phase !== 'fight') step()
  for (let i = 0; i < 100; i += 1) step()
  host.kill(host.entOf('p'), null, 'void')
  while (host.phase === 'fight') step()
  host.leave('p')
  // Walking out mid-round still counts that round.
  host.join('q', 'Quinn')
  while (host.phase !== 'fight') step()
  host.leave('q')

  const types = events.map((e) => e.type)
  assert.deepEqual(types.filter((x) => x === 'tutorial').length, 1, 'each step once, junk ignored')
  assert.ok(types.includes('round') && types.includes('player_round') && types.includes('leave'))
  const round = events.find((e) => e.type === 'round').data
  assert.ok(round.durationMs > 0 && round.deaths.void >= 1)
  const mine = events.find((e) => e.type === 'player_round').data
  assert.equal(mine.died, 'void')
  assert.equal(mine.byPlayer, false)
  // Nothing personal in any event.
  assert.ok(!JSON.stringify(events).includes('Pat') && !JSON.stringify(events).includes('Quinn'))

  const s = summarize(events)
  // Quinn walking out ends that round too (no real players left in it).
  assert.equal(s.rounds.count, 2)
  assert.equal(s.players.rounds, 2)
  assert.equal(s.sessions.count, 2)
  assert.equal(s.sessions.avgRounds, 1)
  assert.equal(s.sessions.quitWhere['match/fight'], 1)
  assert.equal(s.tutorial.reachedStep[1], 1)
  assert.ok(s.deaths.total >= 1)
  assert.ok(s.rounds.avgLengthS <= ROUND.fightMs / 1000)
})

test('events are stored and read back', async () => {
  await openStorage({ path: ':memory:', mongoUri: '' })
  recordEvent('round', { durationMs: 1000, deaths: { lava: 2 } })
  recordEvent('leave', { zone: 'lobby', phase: 'waiting', sessionMs: 5000, rounds: 0 })
  const back = await recentEvents(1)
  assert.equal(back.length, 2)
  assert.deepEqual(back.find((e) => e.type === 'round').data.deaths, { lava: 2 })
  await closeStorage()
})
