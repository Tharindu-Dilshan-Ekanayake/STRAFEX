/**
 * Turns the host's anonymous gameplay events into the numbers that matter for balance
 * and retention. Used by the server's /api/analytics report and by offline simulations.
 *
 * Events are `{ type, at, data }` with types:
 * - duel_start: a duel's map is picked (mode, map, against a bot?)
 * - duel_end:   a duel is decided (rounds, forfeit, who won, how long)
 * - ffa_death:  someone died in Spirelands (how, by a bot?, their kit)
 * - leave:      a player left (where they were, how long they stayed, duels played)
 */

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0)
const median = (list) => {
  if (!list.length) return 0
  const s = [...list].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const secs = (ms) => Math.round(ms / 100) / 10
const countBy = (list, key) => list.reduce((acc, x) => ((acc[key(x)] = (acc[key(x)] || 0) + 1), acc), {})

export function summarize(events) {
  const starts = events.filter((e) => e.type === 'duel_start').map((e) => e.data)
  const duels = events.filter((e) => e.type === 'duel_end').map((e) => e.data)
  const ffa = events.filter((e) => e.type === 'ffa_death').map((e) => e.data)
  const leaves = events.filter((e) => e.type === 'leave').map((e) => e.data)
  const vsBots = duels.filter((d) => d.bot)

  return {
    duels: {
      started: starts.length,
      finished: duels.length,
      avgLengthS: secs(avg(duels.map((d) => d.durationMs))),
      medianLengthS: secs(median(duels.map((d) => d.durationMs))),
      avgRounds: Math.round(avg(duels.map((d) => d.rounds)) * 10) / 10,
      forfeitPct: pct(duels.filter((d) => d.forfeit).length, duels.length),
      vsBotPct: pct(vsBots.length, duels.length),
      // Against bots: how often the bot wins (too high = bots too strong).
      botWinPct: pct(vsBots.filter((d) => d.winnerBot === true).length, vsBots.length),
      byMode: countBy(starts, (d) => d.mode),
      byMap: countBy(starts, (d) => d.map),
    },
    spirelands: {
      deaths: ffa.length,
      byCause: countBy(ffa, (d) => d.how),
      byKit: countBy(ffa, (d) => d.kit),
      killedByBotPct: pct(ffa.filter((d) => d.byBot).length, ffa.length),
    },
    sessions: {
      count: leaves.length,
      medianMinutes: Math.round(median(leaves.map((l) => l.sessionMs)) / 6000) / 10,
      avgDuels: Math.round(avg(leaves.map((l) => l.rounds)) * 10) / 10,
      leftWithoutPlayingPct: pct(leaves.filter((l) => !l.rounds).length, leaves.length),
      quitWhere: countBy(leaves, (l) => l.zone),
    },
  }
}
