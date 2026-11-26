import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summarize } from '../../shared/analytics.js'
import { DUEL } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { mulberry32 } from '../../shared/rng.js'
import { closeStorage, openStorage, recentEvents, recordEvent } from '../src/db.js'

test('duels and Spirelands report how they went, anonymously, and the summary reads it', () => {
  let t = 1_000_000
  const events = []
  const host = new GameHost({ duelBots: true, send: () => {}, onAnalytics: (type, data) => events.push({ type, at: t, data }), now: () => t, random: mulberry32(11), log: () => {} })
  const step = (ms) => {
    for (let i = 0; i < ms; i += 50) {
      t += 50
      host.tick(0.05)
    }
  }
  host.join('p', 'Pat')
  host.message('p', 'queue', { mode: 'sword' })
  step(DUEL.soloBotMs + DUEL.voteMs + DUEL.countdownMs + 400)
  const me = host.entOf('p')
  const arena = host.arenas.get(me.arena)
  // The bot wins three rounds.
  const bot = host.ents.get(arena.fighters[1])
  for (let r = 0; r < 3; r += 1) {
    host.kill(arena, me, bot, 'melee')
    step(DUEL.betweenMs + DUEL.countdownMs + 200)
  }
  step(DUEL.endMs + 200)
  // Then Spirelands, a death to the void, and away.
  host.message('p', 'ffa', {})
  host.message('p', 'kit', { mode: 'mace' })
  step(500)
  host.kill(host.arenas.get('ffa'), me, null, 'void')
  host.leave('p')
  host.join('q', 'Quinn')
  host.leave('q')

  const types = events.map((e) => e.type)
  assert.ok(types.includes('duel_start') && types.includes('duel_end') && types.includes('ffa_death') && types.includes('leave'))
  const end = events.find((e) => e.type === 'duel_end').data
  assert.equal(end.winnerBot, true)
  assert.equal(end.rounds, 3)
  // Nothing personal in any event.
  assert.ok(!JSON.stringify(events).includes('Pat') && !JSON.stringify(events).includes('Quinn'))

  const s = summarize(events)
  assert.equal(s.duels.started, 1)
  assert.equal(s.duels.finished, 1)
  assert.equal(s.duels.botWinPct, 100)
  assert.equal(s.spirelands.byCause.void, 1)
  assert.equal(s.sessions.count, 2)
  assert.equal(s.sessions.leftWithoutPlayingPct, 50)
})

test('events are stored and read back', async () => {
  await openStorage({ path: ':memory:', mongoUri: '' })
  recordEvent('duel_end', { durationMs: 1000, rounds: 2, forfeit: false })
  recordEvent('leave', { zone: 'lobby', sessionMs: 5000, rounds: 0 })
  const back = await recentEvents(1)
  assert.equal(back.length, 2)
  assert.equal(back.find((e) => e.type === 'duel_end').data.rounds, 2)
  await closeStorage()
})
