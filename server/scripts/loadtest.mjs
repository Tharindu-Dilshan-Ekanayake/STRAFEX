/**
 * Load test: starts the game server on a spare port (with a throwaway database), connects
 * N fake players who vote, wander and report positions like real clients, and reports the
 * server's CPU and memory and how evenly snapshots arrive.
 *
 *   node scripts/loadtest.mjs [players=32] [seconds=60] [mix|ffa]
 *
 * `ffa`: everyone in Spirelands at once (the heaviest case: one world, everyone visible).
 *
 * Fake players stand still-ish (small steps around where they were put), so the movement
 * checks should never correct them: any `tp` beyond the game's own teleports is counted.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@colyseus/sdk'

const PLAYERS = Number(process.argv[2] || 32)
const SECONDS = Number(process.argv[3] || 60)
const ALL_FFA = process.argv[4] === 'ffa'
const PORT = 2599
const dir = mkdtempSync(join(tmpdir(), 'strafex-load-'))

const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'load.db'), NODE_ENV: 'development', MONGODB_URI: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
server.stdout.on('data', (d) => serverLog.push(String(d)))
server.stderr.on('data', (d) => serverLog.push(String(d)))
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 20000)
  server.stdout.on('data', (d) => {
    if (String(d).includes('listening')) {
      clearTimeout(t)
      resolve()
    }
  })
})

const run = promisify(execFile)

/** CPU time and memory of the server process (async: never stalls the fake clients). */
async function sampleServer() {
  try {
    if (process.platform === 'win32') {
      const out = (await run('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${server.pid}; "$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64)"`])).stdout.trim()
      const [cpuMs, rss] = out.split(' ').map(Number)
      return { cpuMs, rss }
    }
    const out = (await run('ps', ['-o', 'times=,rss=', '-p', String(server.pid)])).stdout.trim()
    const [secs, rssKb] = out.split(/\s+/).map(Number)
    return { cpuMs: secs * 1000, rss: rssKb * 1024 }
  } catch {
    return null
  }
}

const stats = { joined: 0, failed: 0, snaps: 0, bytes: 0, gaps: [], tps: 0, rooms: new Set(), phases: new Map() }
const bots = []

async function connect(i) {
  const client = new Client(`ws://localhost:${PORT}`)
  const room = await client.joinOrCreate('game', { playerId: `load-${i}`, name: `Load${i}` })
  stats.joined += 1
  stats.rooms.add(room.roomId)
  const me = { room, pos: null, lastSnap: 0, zone: 'lobby' }
  room.onMessage('*', (type, payload) => {
    stats.bytes += JSON.stringify(payload ?? '').length
    if (type === 'snap') {
      const now = performance.now()
      if (me.lastSnap && payload?.z === (me.zone === 'lobby' ? 'lobby' : 'match')) stats.gaps.push(now - me.lastSnap)
      me.lastSnap = now
      stats.snaps += 1
    } else if (type === 'tp') {
      me.pos = { x: payload.x, y: payload.y, z: payload.z }
      if (payload.zone && payload.zone !== me.zone) me.lastSnap = 0
      if (payload.zone) me.zone = payload.zone
      else stats.tps += 1
    } else if (type === 'phase') {
      stats.phases.set(room.roomId, payload.phase)
      // Every third player lives in Spirelands; the rest queue for sword duels (paired
      // with each other, or a bot), vote, and play again when a duel ends.
      if (payload.kind === 'lobby' && !payload.queue) {
        if (ALL_FFA || i % 3 === 0) room.send('ffa')
        else room.send('queue', { mode: 'sword' })
      } else if (payload.kind === 'ffa' && payload.needKit) room.send('kit', { mode: 'sword' })
      else if (payload.kind === 'duel' && payload.phase === 'vote' && !payload.myMapVote) room.send('voteMap', { map: 'meadow' })
      else if (payload.kind === 'duel' && payload.phase === 'ended') room.send('requeue')
    }
  })
  bots.push(me)
}

for (let i = 0; i < PLAYERS; i += 1) {
  try {
    await connect(i)
  } catch (err) {
    stats.failed += 1
    console.warn('join failed', err?.message || err)
  }
}

// Report positions at 10 Hz: tiny steps around wherever the host put us.
const posTimer = setInterval(() => {
  for (const b of bots) {
    if (!b.pos) continue
    const t = performance.now() / 1000
    b.room.send('pos', { x: b.pos.x + Math.sin(t + b.pos.z) * 0.2, y: b.pos.y, z: b.pos.z + Math.cos(t) * 0.2, yaw: t % 6, pitch: 0, a: 1 })
  }
}, 100)

const start = await sampleServer()
const startAt = performance.now()
const cpuSeries = []
let prev = start
let prevAt = startAt
for (let s = 0; s < SECONDS; s += 3) {
  await new Promise((r) => setTimeout(r, 3000))
  const cur = await sampleServer()
  const at = performance.now()
  if (cur && prev) cpuSeries.push(((cur.cpuMs - prev.cpuMs) / (at - prevAt)) * 100)
  prev = cur
  prevAt = at
}
clearInterval(posTimer)
const end = await sampleServer()
const elapsed = (performance.now() - startAt) / 1000

const gaps = stats.gaps.sort((a, b) => a - b)
const pct = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))].toFixed(0) : '-')
console.log(`players ${stats.joined} joined (${stats.failed} failed) in ${stats.rooms.size} rooms; phases: ${[...stats.phases.values()].join(', ')}`)
console.log(`server CPU avg ${(((end.cpuMs - start.cpuMs) / 1000 / elapsed) * 100).toFixed(1)}% of a core, peak ${Math.max(...cpuSeries).toFixed(1)}%; memory ${(end.rss / 1048576).toFixed(0)} MB`)
console.log(`snapshots ${stats.snaps} (${(stats.snaps / elapsed / Math.max(1, stats.joined)).toFixed(1)}/s per player); gap p50 ${pct(0.5)} ms, p99 ${pct(0.99)} ms, max ${pct(1)} ms`)
console.log(`downstream ~${((stats.bytes / elapsed / Math.max(1, stats.joined)) / 1024).toFixed(1)} KB/s per player (JSON size); movement corrections: ${stats.tps}`)

for (const b of bots) await b.room.leave().catch(() => {})
server.kill()
await new Promise((r) => setTimeout(r, 500))
rmSync(dir, { recursive: true, force: true })
if (serverLog.some((l) => /error/i.test(l) && !/ECONNRESET/.test(l))) console.log('server log errors:\n' + serverLog.filter((l) => /error/i.test(l)).join('').slice(0, 2000))
process.exit(0)
