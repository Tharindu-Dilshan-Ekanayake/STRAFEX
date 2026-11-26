/**
 * Turns the host's anonymous gameplay events into the numbers that matter for balance
 * and retention. Used by the server's /api/analytics report and by offline simulations.
 *
 * Events are `{ type, at, data }` with types:
 * - round:        one finished round (length, how it ended, how everyone died)
 * - player_round: one real player's round (placement, how they died, how long they lived)
 * - leave:        a player left (where they were, how long they stayed, rounds played)
 * - tutorial:     a player reached tutorial step n
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
  const rounds = events.filter((e) => e.type === 'round').map((e) => e.data)
  const players = events.filter((e) => e.type === 'player_round').map((e) => e.data)
  const leaves = events.filter((e) => e.type === 'leave').map((e) => e.data)
  const tutorial = events.filter((e) => e.type === 'tutorial').map((e) => e.data)

  // How everyone (bots too) died, across all rounds.
  const deaths = {}
  for (const r of rounds) for (const [how, n] of Object.entries(r.deaths || {})) deaths[how] = (deaths[how] || 0) + n
  const totalDeaths = Object.values(deaths).reduce((a, b) => a + b, 0)
  const byPlayer = rounds.reduce((a, r) => a + (r.byPlayer || 0), 0)

  // How real players died.
  const playerDeaths = countBy(players.filter((p) => p.died), (p) => (p.byPlayer ? `by a player (${p.died})` : p.died))

  return {
    rounds: {
      count: rounds.length,
      avgLengthS: secs(avg(rounds.map((r) => r.durationMs))),
      medianLengthS: secs(median(rounds.map((r) => r.durationMs))),
      endedByTimePct: pct(rounds.filter((r) => r.reason === 'time').length, rounds.length),
      wonByBotPct: pct(rounds.filter((r) => r.winnerBot === true).length, rounds.filter((r) => r.winnerBot !== null).length),
      avgFirstKillS: secs(avg(rounds.filter((r) => r.firstKillMs).map((r) => r.firstKillMs))),
      avgLavaAtEnd: Math.round(avg(rounds.map((r) => r.lavaY)) * 10) / 10,
      byMode: countBy(rounds, (r) => r.mode),
      byMap: countBy(rounds, (r) => r.map),
    },
    deaths: {
      total: totalDeaths,
      killedByPlayerPct: pct(byPlayer, totalDeaths),
      // Caught by the rising lava vs fell (or was knocked) into the lava sea.
      lavaPct: pct(deaths.lava || 0, totalDeaths),
      fellPct: pct(deaths.fell || 0, totalDeaths),
      voidPct: pct(deaths.void || 0, totalDeaths),
      byCause: deaths,
    },
    players: {
      rounds: players.length,
      winPct: pct(players.filter((p) => p.win).length, players.length),
      avgSurvivedS: secs(avg(players.map((p) => p.survivedMs))),
      avgKills: Math.round(avg(players.map((p) => p.kills)) * 100) / 100,
      avgLucky: Math.round(avg(players.map((p) => p.lucky)) * 10) / 10,
      avgPlaced: Math.round(avg(players.map((p) => p.placed)) * 10) / 10,
      howTheyDied: playerDeaths,
    },
    sessions: {
      count: leaves.length,
      medianMinutes: Math.round(median(leaves.map((l) => l.sessionMs)) / 6000) / 10,
      avgRounds: Math.round(avg(leaves.map((l) => l.rounds)) * 10) / 10,
      leftWithoutPlayingPct: pct(leaves.filter((l) => !l.rounds).length, leaves.length),
      // Where people quit: 'lobby/intermission', 'match/fight', 'spec/fight'...
      quitWhere: countBy(leaves, (l) => `${l.zone}/${l.phase}`),
    },
    tutorial: {
      // How many reached each step (step 5 done = finished).
      reachedStep: countBy(tutorial, (t) => t.step),
    },
  }
}
