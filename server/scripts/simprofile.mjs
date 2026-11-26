/**
 * Game-simulation profile: 50 players in Spirelands inside one process (no network),
 * walking about, fighting and building, for a stretch of game time. Prints the host's
 * tick and flush cost; run with `node --cpu-prof scripts/simprofile.mjs` for a profile.
 *
 *   node scripts/simprofile.mjs [players=50] [seconds=40]
 */
import { GameHost } from '../../shared/host.js'
import { mulberry32 } from '../../shared/rng.js'

const PLAYERS = Number(process.argv[2] || 50)
const SECONDS = Number(process.argv[3] || 40)
const clock = { t: 1_000_000 }
let sent = 0
let bytes = 0
let rosterMsgs = 0
let rosterBytes = 0
/** A typical Bloxity look (equipped items and proportions), as real players carry. */
const LOOK = JSON.stringify({ equipped: { hat: 'item_1234567', hair: 'item_7654321', shirt: 'item_1111111', pants: 'item_2222222', face: 'item_3333333', back: 'item_4444444' }, proportions: { height: 1, width: 1, head: 1, bodyType: 0.3 } })
const host = new GameHost({
  send: (cid, type, payload) => {
    sent += 1
    if (type === 'snap') bytes += payload.e.length * 3
    if (type === 'roster' || type === 'rstate') {
      rosterMsgs += 1
      rosterBytes += JSON.stringify(payload).length
    }
  },
  now: () => clock.t,
  random: mulberry32(7),
  log: () => {},
})
const rng = mulberry32(3)
const players = []
for (let i = 0; i < PLAYERS; i += 1) {
  const cid = `p${i}`
  host.join(cid, `P${i}`, { look: LOOK })
  host.message(cid, 'ffa', {})
  host.message(cid, 'kit', { mode: ['sword', 'uhc', 'axe', 'smp'][i % 4] })
  players.push({ cid, a: rng() * Math.PI * 2 })
}
const dt = 1 / 20
const ticks = SECONDS * 20
let tickMs = 0
let worst = 0
const t0 = performance.now()
for (let k = 0; k < ticks; k += 1) {
  // Each player reports a step (10 Hz, like a client) and now and then swings or builds.
  if (k % 2 === 0) {
    for (const p of players) {
      const e = host.entOf(p.cid)
      if (!e?.alive) {
        host.message(p.cid, 'kit', { mode: 'sword' })
        continue
      }
      p.a += (rng() - 0.5) * 0.6
      const x = e.x + Math.cos(p.a) * 0.42
      const z = e.z + Math.sin(p.a) * 0.42
      host.message(p.cid, 'pos', { x, y: e.y, z, yaw: -p.a, pitch: 0, a: 1 })
      if (rng() < 0.15) {
        // Hit whoever is nearest.
        let best = null
        let bd = 4
        for (const o of players) {
          const oe = host.entOf(o.cid)
          if (oe === e || !oe?.alive) continue
          const d = Math.hypot(oe.x - e.x, oe.z - e.z)
          if (d < bd) {
            bd = d
            best = oe
          }
        }
        if (best) host.message(p.cid, 'attack', { eid: best.eid })
      }
      if (rng() < 0.02) host.message(p.cid, 'place', { x: Math.floor(x + 1), y: Math.floor(e.y), z: Math.floor(z) })
    }
  }
  clock.t += 50
  const s = performance.now()
  host.tick(dt)
  const took = performance.now() - s
  tickMs += took
  if (k > 40) worst = Math.max(worst, took)
}
const wall = performance.now() - t0
console.log(`${PLAYERS} players, ${SECONDS}s of game in ${(wall / 1000).toFixed(1)}s wall`)
console.log(`tick avg ${(tickMs / ticks).toFixed(2)} ms, worst ${worst.toFixed(2)} ms (budget 50 ms at 20 Hz) -> ${((tickMs / ticks / 50) * 100).toFixed(1)}% of a core`)
console.log(`messages out ${(sent / SECONDS).toFixed(0)}/s, snapshot payload ~${(bytes / SECONDS / 1024).toFixed(0)} KB/s total`)
console.log(`roster ${(rosterMsgs / SECONDS).toFixed(1)} msgs/s total, ${(rosterBytes / SECONDS / 1024).toFixed(0)} KB/s total (${(rosterBytes / Math.max(1, rosterMsgs) / 1024).toFixed(1)} KB each)`)
