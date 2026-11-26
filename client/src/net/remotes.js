import { ANIMS, ITEM_IDS } from '@shared/protocol'

import { pushFx, runtime } from '../game/runtime'

/**
 * Other players and bots, as the host last described them. Snapshots arrive ~10-20 Hz;
 * the renderer draws everyone ~100 ms in the past, blending between the two snapshots
 * around that moment, so movement looks smooth at any frame rate.
 */

const MAX_SNAPS = 20
export const INTERP_MS = 90

function makeRemote(eid) {
  return {
    eid,
    name: '',
    bot: false,
    cape: 'none',
    sword: 'classic',
    snaps: [],
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    anim: 0,
    held: 'fist',
    off: 'fist',
    walkPhase: 0,
    speed: 0,
    swingAt: 0,
    hurtAt: 0,
    /** Seen in the latest snapshot of our zone. */
    seenAt: 0,
    firstSeen: 0,
  }
}

/** A `snap` message: `{ z: zone, e: [eid, x, y, z, yaw, pitch, anim, held, offhand, ...] }` (x100). */
const STRIDE = 9
export function applySnapshot(zone, e) {
  const viewing = runtime.zone === 'lobby' ? 'lobby' : 'match'
  if (zone !== viewing) return
  const now = performance.now()
  for (let i = 0; i + STRIDE - 1 < e.length; i += STRIDE) {
    const eid = e[i]
    if (eid === runtime.eid) continue
    let r = runtime.remotes.get(eid)
    if (!r) {
      r = makeRemote(eid)
      r.firstSeen = now
      runtime.remotes.set(eid, r)
      const entry = rosterCache.get(eid)
      if (entry) dress(r, entry)
      r.x = e[i + 1] / 100
      r.y = e[i + 2] / 100
      r.z = e[i + 3] / 100
    }
    r.seenAt = now
    r.anim = e[i + 6]
    r.held = ITEM_IDS[e[i + 7]] || 'fist'
    r.off = ITEM_IDS[e[i + 8]] || 'fist'
    // Snapshot entries are recycled: no garbage at 20 Hz x 8 players.
    const snap = r.snaps.length >= MAX_SNAPS ? r.snaps.shift() : freeSnaps.pop() || {}
    snap.t = now
    snap.x = e[i + 1] / 100
    snap.y = e[i + 2] / 100
    snap.z = e[i + 3] / 100
    snap.yaw = e[i + 4] / 100
    snap.pitch = e[i + 5] / 100
    r.snaps.push(snap)
  }
  // Anyone missing from the snapshot left our zone (or died).
  for (const [eid, r] of runtime.remotes) {
    if (r.seenAt === now) continue
    releaseSnaps(r)
    runtime.remotes.delete(eid)
    // Gone from the round (eliminated, fell, left): a puff of smoke where they stood.
    if (viewing === 'match' && now - r.firstSeen > 500) pushFx({ type: 'poof', x: r.x, y: r.y + 0.9, z: r.z })
  }
}

const freeSnaps = []
function releaseSnaps(r) {
  for (const s of r.snaps) if (freeSnaps.length < 400) freeSnaps.push(s)
  r.snaps.length = 0
}


/** The last roster, by eid: remotes created later pick their names up from here. */
const rosterCache = new Map()

function dress(r, entry) {
  r.name = entry.name
  r.bot = entry.bot
  r.cape = entry.cape
  r.sword = entry.sword
  /** Their Bloxity avatar as JSON `{ equipped, proportions }` ('' = base body). */
  r.lookKey = entry.look || ''
  r.team = entry.team ?? -1
  r.level = entry.level || 0
  r.vip = Boolean(entry.vip)
  r.armor = entry.armor || 'none'
  r.streak = entry.streak || 0
}

/** Names, skins, armour and streaks from the roster. */
export function applyRoster(list) {
  rosterCache.clear()
  for (const entry of list) {
    rosterCache.set(entry.eid, entry)
    const r = runtime.remotes.get(entry.eid)
    if (r) dress(r, entry)
  }
}

export const rosterEntry = (eid) => rosterCache.get(eid)

const lerpAngle = (a, b, t) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Moves every remote to where it was INTERP_MS ago. Call once per frame. */
export function interpolateRemotes(dt) {
  const t = performance.now() - INTERP_MS
  for (const r of runtime.remotes.values()) {
    const s = r.snaps
    if (!s.length) continue
    const px = r.x
    const pz = r.z
    let a = s[0]
    let b = s[0]
    for (let i = s.length - 1; i >= 0; i -= 1) {
      if (s[i].t <= t) {
        a = s[i]
        b = s[i + 1] || s[i]
        break
      }
    }
    const span = b.t - a.t
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1
    r.x = a.x + (b.x - a.x) * k
    r.y = a.y + (b.y - a.y) * k
    r.z = a.z + (b.z - a.z) * k
    r.yaw = lerpAngle(a.yaw, b.yaw, k)
    r.pitch = a.pitch + (b.pitch - a.pitch) * k
    const moved = Math.hypot(r.x - px, r.z - pz)
    r.speed = dt > 0 ? moved / dt : 0
    r.walkPhase += moved * 2.6
  }
}

export function clearRemotes() {
  for (const r of runtime.remotes.values()) releaseSnaps(r)
  runtime.remotes.clear()
}

export const animName = (code) => ANIMS[code] || 'idle'
