import {
  AIR,
  ARMOR,
  armorReduce,
  BOT_LEVELS,
  BOT_NAMES,
  BOUNTY_STREAK,
  breakSeconds,
  CAMPFIRE,
  COMBAT,
  CRYSTAL,
  DUEL,
  EFFECTS,
  FFA,
  FIRE,
  GUST,
  HOTBAR,
  HP,
  INV_SIZE,
  ITEMS,
  kitArmor,
  kitHotbar,
  LOBBY_SWORD,
  LOOT,
  MELEE_KINDS,
  MODE_IDS,
  MODES,
  OFFHAND,
  PROJECTILES,
  QUICK_CHAT,
  QUICK_CHAT_MS,
  REACH,
  RECIPES,
  SPLASH,
  WATER,
} from './balance.js'
import { createBrain, thinkBot } from './bots.js'
import { ARENA_BUILD_HEIGHT, ARENA_FLOOR, DUEL_MAP_IDS, FFA_SEED, generateArena, generateLobby, generateSpirelands } from './maps.js'
import { checkMove, createMoveState, resetMoveState } from './movecheck.js'
import { cellOverlapsBody, createBody, inWater, PLAYER } from './physics.js'
import { ANIMS, ITEM_IDS } from './protocol.js'
import { B, BLOCKS, blockKey, flowBlock, isCrystal, isSolidBlock, isWater, raycastVoxels, rayBox, unpackKey, waterLevel } from './voxel.js'

/**
 * The game's authority for one server: the lobby, the duel queues, every duel in
 * progress (each in its own small arena world) and Spirelands, the free-for-all world.
 * Runs inside the Colyseus room on the server and inside the offline stand-in in the
 * browser, so the game plays the same either way.
 *
 * Players report where they are (movement is theirs, checked for speed); everything
 * else - hits, armour, health, blocks, projectiles, rounds, bots - is decided here and
 * sent out as small messages:
 *
 * - `snap`   ~20 Hz: everyone's position in your world (and what's in both hands)
 * - `roster` who is here (names, capes, where they are)
 * - `phase`  where you are in the flow: the lobby and your queue, a duel's vote, round
 *            and score, or Spirelands
 * - `match`  the world you're entering (kind, map, seed + edits so far)
 * - `edits`  block changes `[x, y, z, id, ...]`
 * - `me`     your health, armour, hotbar, effects and combat stats
 * - one-off events: `hurt`, `kb`, `tp`, `feed`, `proj`, `projEnd`, `boom`, `gust`,
 *   `splash`, `charm`, `blocked`, `shieldOff`, `smash`, `swing`, `act`, `dead`,
 *   `roundEnd`, `duelEnd`, `toast`, `qc`, `pickup`, `crafted`, `douse`, `ignite`
 */

export { ANIMS, ITEM_IDS }
const SIM_HZ = 20
/** Right after knockback or a teleport: a loose cap only (blocks/s, plus slack). */
const MAX_SPEED = 22
const MOVE_SLACK = 3
/** A rejected move: positions are ignored until the client takes the correction. */
const CORRECTION_MS = 1500
/** Allowance on reach checks for network lag. */
const REACH_SLACK = 1.4
/** Gaps between uses (ms): eating and drinking take time; the client holds to eat. */
const USE_GAP = { food: 1000, potion: 800, bow: 300, throw: 220, splash: 260 }
/** Bot skill by duel mode in Spirelands: kits bots can play well. */
const BOT_KITS = MODE_IDS.filter((id) => id !== 'crystal')

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** Roster state updates (kills, deaths) at most this often. */
const ROSTER_GAP_MS = 200
/** Spirelands snapshots carry players this close to you (blocks, across the ground). */
const SNAP_RANGE = 140
/** The entries of a snapshot list (9 numbers each, positions x100) within SNAP_RANGE of (x, z). */
function nearOnly(list, x, z) {
  const out = []
  const r = SNAP_RANGE * 100
  const cx = x * 100
  const cz = z * 100
  for (let i = 0; i + 8 < list.length; i += 9) {
    const dx = list[i + 1] - cx
    const dz = list[i + 3] - cz
    if (dx * dx + dz * dz <= r * r) for (let k = 0; k < 9; k += 1) out.push(list[i + k])
  }
  return out
}

/** A cell and its six neighbours; the four beside it. */
const NEIGHBOURS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const round1 = (v) => Math.round(v * 10) / 10

export class GameHost {
  /**
   * @param {object} o
   * @param {(cid: string, type: string, payload?: object) => void} o.send
   * @param {(cid: string, result: object) => void} [o.onReward] a duel (or a Spirelands life) is over
   * @param {() => number} [o.now]
   * @param {() => number} [o.random]
   */
  /**
   * Duels are always against a real player. `duelBots` (tests only) lets a lone player
   * in a duel queue get a bot instead.
   */
  constructor({ send, onReward = () => {}, onParkour = () => {}, onAnalytics = () => {}, now = () => Date.now(), random = Math.random, log = (msg) => console.warn(msg), duelBots = false }) {
    this.duelBots = duelBots
    this.sendTo = send
    /** A player reached the top of the lobby parkour: `(cid, ms)`. */
    this.onParkour = onParkour
    this.onAnalytics = onAnalytics
    this.log = log
    this.onReward = onReward
    this.now = now
    this.random = random
    this.lobby = generateLobby()
    /** cid -> { cid, eid, name, queue, queuedAt, duel, joinedAt, duels } */
    this.members = new Map()
    /** eid -> entity (players and bots) */
    this.ents = new Map()
    /** key -> arena (duels and Spirelands) */
    this.arenas = new Map()
    this.nextEid = 1
    this.nextArena = 1
    this.rosterDirty = true
    this.phaseDirty = true
    this.phaseSentAt = 0
    this.snapAcc = 0
  }

  // --- Members ------------------------------------------------------------------------

  join(cid, name, look = {}) {
    const eid = this.nextEid++
    const member = { cid, eid, name, queue: null, queuedAt: 0, duel: null, joinedAt: this.now(), duels: 0, lastMode: null }
    this.members.set(cid, member)
    const ent = this.makeEnt(eid, name, { cid, cape: look.cape, sword: look.sword, level: look.level || 1, vip: Boolean(look.vip) })
    this.ents.set(eid, ent)
    this.toLobby(ent, false)
    this.sendTo(cid, 'hello', { eid })
    this.rosterDirty = true
    this.phaseDirty = true
    return eid
  }

  leave(cid) {
    const member = this.members.get(cid)
    if (!member) return
    const ent = this.ents.get(member.eid)
    if (ent) this.leaveArena(ent, 'left')
    this.track('leave', { zone: ent?.zone || 'lobby', sessionMs: this.now() - member.joinedAt, rounds: member.duels })
    this.ents.delete(member.eid)
    this.members.delete(cid)
    this.rosterDirty = true
    this.phaseDirty = true
  }

  /** Cosmetics changed (equipped a new cape or sword skin). */
  setLook(cid, look) {
    const ent = this.entOf(cid)
    if (!ent) return
    if (look.cape) ent.cape = look.cape
    if (look.sword) ent.sword = look.sword
    if (Number.isFinite(look.level)) ent.level = look.level
    if (typeof look.vip === 'boolean') ent.vip = look.vip
    this.rosterDirty = true
  }

  entOf(cid) {
    const m = this.members.get(cid)
    return m ? this.ents.get(m.eid) : null
  }

  makeEnt(eid, name, extra = {}) {
    return {
      eid,
      cid: null,
      bot: false,
      name,
      zone: 'lobby',
      arena: null,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      anim: 0,
      alive: false,
      hp: HP,
      maxHp: HP,
      absorb: 0,
      inv: new Array(INV_SIZE).fill(null),
      sel: 0,
      armor: { tier: 'none', dura: [0, 0, 0, 0] },
      kit: null,
      effects: {},
      kills: 0,
      lifeKills: 0,
      team: -1,
      lastHurtAt: 0,
      hurtUntil: 0,
      lastAttackAt: 0,
      lastUseAt: 0,
      lastRegenAt: 0,
      lastHitBy: null,
      blocking: false,
      blockAt: 0,
      shieldOffUntil: 0,
      lungeAt: 0,
      lungeUntil: 0,
      peakY: 0,
      noFallUntil: 0,
      needKit: false,
      dig: null,
      posAt: 0,
      tpGrace: 0,
      mv: createMoveState(),
      awaitTp: null,
      stats: freshStats(),
      dirty: true,
      ...extra,
      cape: extra.cape || 'none',
      sword: extra.sword || 'classic',
    }
  }

  // --- Messages from players ------------------------------------------------------------

  message(cid, type, p = {}) {
    const ent = this.entOf(cid)
    const member = this.members.get(cid)
    if (!ent || !member) return
    p = p && typeof p === 'object' ? p : {}
    switch (type) {
      case 'pos':
        return this.onPos(ent, p)
      case 'sel':
        ent.sel = clamp(Math.floor(num(p.slot)), 0, HOTBAR - 1)
        ent.dirty = true
        return
      case 'dig': {
        const x = Math.floor(num(p.x))
        const y = Math.floor(num(p.y))
        const z = Math.floor(num(p.z))
        ent.dig = { key: blockKey(x, y, z), at: this.now() }
        if (ent.zone === 'match') this.toWatchers(ent, 'act', { eid: ent.eid, kind: 'dig', x, y, z })
        return
      }
      case 'break':
        return this.onBreak(ent, Math.floor(num(p.x)), Math.floor(num(p.y)), Math.floor(num(p.z)))
      case 'place':
        return this.onPlace(ent, Math.floor(num(p.x)), Math.floor(num(p.y)), Math.floor(num(p.z)), p.hand)
      case 'attack':
        return this.onAttack(ent, Math.floor(num(p.eid)))
      case 'use':
        return this.onUse(ent, p)
      case 'block':
        return this.setBlocking(ent, Boolean(p.on))
      case 'swap':
        return this.swapSlots(ent, Math.floor(num(p.a, -1)), Math.floor(num(p.b, -1)))
      case 'swapHands':
        return this.swapSlots(ent, ent.sel, OFFHAND)
      case 'craft':
        return this.craft(ent, String(p.id))
      case 'swing':
        if (ent.zone === 'lobby') this.toZone('lobby', null, 'swing', { eid: ent.eid }, ent.cid)
        else if (ent.arena) this.toWatchers(ent, 'swing', { eid: ent.eid })
        return
      case 'look':
        return this.onLook(ent, p)
      case 'queue':
        return this.joinQueue(member, ent, String(p.mode))
      case 'unqueue':
        if (member.queue) {
          member.queue = null
          this.phaseDirty = true
        }
        return
      case 'voteMap': {
        const arena = this.arenas.get(member.duel)
        if (arena && arena.phase === 'vote' && arena.mapOptions.includes(p.map)) {
          arena.votes.set(ent.eid, p.map)
          this.phaseDirty = true
        }
        return
      }
      case 'ffa':
        return this.enterFfa(member, ent)
      case 'kit':
        return this.pickKit(ent, String(p.mode))
      case 'lobby':
        if (ent.zone !== 'lobby' || member.duel) {
          this.leaveArena(ent, 'left')
          this.toLobby(ent)
          this.rosterDirty = true
          this.phaseDirty = true
        }
        return
      case 'requeue': {
        const mode = member.lastMode
        const arena = this.arenas.get(member.duel)
        if (arena && arena.kind === 'duel' && arena.phase !== 'ended') return
        if (ent.zone !== 'lobby' || member.duel) {
          this.leaveArena(ent, 'left')
          this.toLobby(ent)
        }
        if (mode) this.joinQueue(member, ent, mode)
        return
      }
      case 'parkour':
        return this.onParkourDone(member, ent, Math.floor(num(p.ms)))
      case 'loot':
        return this.openChest(ent, Math.floor(num(p.x)), Math.floor(num(p.y)), Math.floor(num(p.z)))
      case 'qc': {
        const i = Math.floor(num(p.i, -1))
        const now = this.now()
        if (i < 0 || i >= QUICK_CHAT.length || now - (ent.qcAt || 0) < QUICK_CHAT_MS) return
        ent.qcAt = now
        const msg = { eid: ent.eid, name: ent.name, i, team: ent.team ?? -1 }
        if (ent.zone === 'lobby') this.toZone('lobby', null, 'qc', msg)
        else this.toArena(this.arenas.get(ent.arena), 'qc', msg)
        return
      }
      default:
    }
  }

  /**
   * What a player's Bloxity avatar wears, so everyone else can dress them the same.
   * Purely cosmetic, so trusted as sent - but kept to a small object of short strings
   * and plain numbers.
   */
  onLook(ent, msg) {
    const clean = (obj, keep) => {
      const out = {}
      if (!obj || typeof obj !== 'object') return out
      for (const [key, value] of Object.entries(obj).slice(0, 24)) {
        if (key.length > 24) continue
        if (keep(value)) out[key] = value
      }
      return out
    }
    const look = JSON.stringify({
      equipped: clean(msg.equipped, (v) => (typeof v === 'string' && v.length <= 40) || (Number.isFinite(v) && Math.abs(v) < 1e12)),
      proportions: clean(msg.proportions, (v) => Number.isFinite(v) && v >= -1 && v <= 6),
    })
    if (look.length <= 2048 && look !== ent.look) {
      ent.look = look
      this.rosterDirty = true
    }
  }

  onPos(ent, p) {
    const x = num(p.x, NaN)
    const y = num(p.y, NaN)
    const z = num(p.z, NaN)
    if (![x, y, z].every(Number.isFinite)) return
    const now = this.now()
    ent.yaw = num(p.yaw)
    ent.pitch = clamp(num(p.pitch), -1.6, 1.6)
    const anim = clamp(Math.floor(num(p.a)), 0, ANIMS.length - 1)
    const arena = this.arenas.get(ent.arena)
    if (ent.zone === 'match' && ent.alive && arena?.world) {
      if (ent.awaitTp) {
        const t = ent.awaitTp
        if (Math.hypot(x - t.x, y - t.y, z - t.z) > 2 && now < t.until) return
        ent.awaitTp = null
        resetMoveState(ent.mv, ent.y, now)
        ent.posAt = now
      }
      const dt = Math.max(0.02, (now - ent.posAt) / 1000)
      let bad = null
      if (now <= ent.tpGrace) {
        if (Math.hypot(x - ent.x, z - ent.z) > MAX_SPEED * dt + MOVE_SLACK) bad = 'speed'
        else resetMoveState(ent.mv, y, now)
      } else {
        const fx = ent.effects
        bad = checkMove(arena.world, ent.mv, ent, { x, y, z }, dt, now, {
          speedMul: fx.speed > now ? EFFECTS.speed.speedMul : 1,
          jumpMul: fx.leap > now ? EFFECTS.leap.jumpMul : fx.jump > now ? EFFECTS.jump.jumpMul : 1,
        })
      }
      if (bad) {
        this.correct(ent, bad)
        return
      }
      ent.falling = y < ent.y - 0.01
      this.trackFall(ent, arena, anim === 4, y, now)
    }
    ent.anim = anim
    ent.x = x
    ent.y = y
    ent.z = z
    ent.posAt = now
  }

  /** Falls: the highest point since you last stood (the mace reads it), and landing hurts. */
  trackFall(ent, arena, inAir, y, now) {
    if (inWater(arena.world, ent.x, y, ent.z)) {
      ent.peakY = y
      ent.wasAir = false
      return
    }
    if (inAir) {
      if (!ent.wasAir) ent.peakY = Math.max(ent.y, y)
      else ent.peakY = Math.max(ent.peakY, y)
      ent.wasAir = true
      return
    }
    if (ent.wasAir && arena.phase === 'fight') {
      const fall = ent.peakY - y
      const wet = isWater(arena.world.get(ent.x, y, ent.z))
      if (fall > COMBAT.safeFall && now > ent.noFallUntil && !wet) this.damage(ent, Math.ceil(fall - COMBAT.safeFall), null, 'fall', { pierce: true, iframes: false })
    }
    ent.wasAir = false
    ent.peakY = y
  }

  // --- The lobby and the queues ------------------------------------------------------------

  /**
   * Someone says they reached the top of the parkour: they must be standing on it, and
   * not have just claimed. The lobby hears about it.
   */
  onParkourDone(member, ent, ms) {
    const now = this.now()
    const f = this.lobby.parkour.finish
    if (ent.zone !== 'lobby' || now - (member.parkourAt || 0) < 15_000) return
    if (Math.hypot(ent.x - f.x, ent.z - f.z) > 3 || ent.y < f.y - 1.5 || !(ms >= 6000 && ms < 3_600_000)) return
    member.parkourAt = now
    this.onParkour(ent.cid, ms)
    this.toZone('lobby', null, 'toast', { text: `${ent.name} finished the parkour in ${(ms / 1000).toFixed(1)}s!`, kind: 'success' })
  }

  joinQueue(member, ent, mode) {
    if (!MODES[mode]) return
    if (member.duel || ent.zone !== 'lobby') {
      if (ent.cid) this.sendTo(ent.cid, 'toast', { text: 'Leave your game first', kind: 'error' })
      return
    }
    member.queue = mode
    member.queuedAt = this.now()
    member.lastMode = mode
    this.phaseDirty = true
  }

  /**
   * Pairs everyone searching for a duel: two people who picked the same mode first; then
   * anyone left over with anyone else, straight away, in the mode of whoever has waited
   * longer - nobody sits in a queue while someone else in the room is searching too.
   * (Tests with `duelBots`: someone alone long enough gets a bot.)
   */
  matchmake(now) {
    const waiting = new Map()
    for (const m of this.members.values()) {
      if (!m.queue || m.duel) continue
      if (!waiting.has(m.queue)) waiting.set(m.queue, [])
      waiting.get(m.queue).push(m)
    }
    const leftover = []
    for (const [mode, list] of waiting) {
      list.sort((a, b) => a.queuedAt - b.queuedAt)
      while (list.length >= 2) {
        const a = list.shift()
        const b = list.shift()
        this.createDuel(mode, [this.ents.get(a.eid), this.ents.get(b.eid)])
      }
      if (list.length === 1) leftover.push(list[0])
    }
    leftover.sort((a, b) => a.queuedAt - b.queuedAt)
    while (leftover.length >= 2) {
      const a = leftover.shift()
      const b = leftover.shift()
      this.createDuel(a.queue, [this.ents.get(a.eid), this.ents.get(b.eid)])
    }
    if (this.duelBots && leftover.length === 1) {
      const m = leftover[0]
      if (now - m.queuedAt >= (this.members.size <= 1 ? DUEL.soloBotMs : DUEL.botFillMs)) this.createDuel(m.queue, [this.ents.get(m.eid), null])
    }
  }

  /** A duel between two players (or a player and a bot: `null`), starting with the map vote. */
  createDuel(mode, sides) {
    const key = `d${this.nextArena++}`
    const now = this.now()
    const ents = sides.map((e, i) => e || this.makeBot(mode, i))
    const arena = {
      key,
      kind: 'duel',
      mode,
      mapId: null,
      seed: Math.floor(this.random() * 2 ** 31),
      world: null,
      spawns: [],
      edits: new Map(),
      pending: [],
      projs: [],
      fires: [],
      fireBy: new Map(),
      nextProj: 1,
      phase: 'vote',
      phaseEnds: now + DUEL.voteMs,
      fighters: ents.map((e) => e.eid),
      score: new Map(ents.map((e) => [e.eid, 0])),
      round: 0,
      draws: 0,
      votes: new Map(),
      mapOptions: [...DUEL_MAP_IDS],
      placed: new Set(),
      protect: true,
      startedAt: now,
      roundWinner: null,
      winner: null,
      botLevel: 'easy',
    }
    this.arenas.set(key, arena)
    ents.forEach((e, i) => {
      e.team = i
      e.stats = freshStats()
      e.kills = 0
      if (e.bot) {
        arena.votes.set(e.eid, arena.mapOptions[Math.floor(this.random() * arena.mapOptions.length)])
        e.arena = key
        e.zone = 'limbo'
      } else {
        const m = this.members.get(e.cid)
        // Searching from Spirelands: out of it and back to the lobby for the map vote.
        if (e.arena === 'ffa') this.pullFromFfa(e)
        m.queue = null
        m.duel = key
        if (e.cid) this.sendTo(e.cid, 'toast', { text: `Opponent found: ${ents[1 - i].name}!`, kind: 'success' })
      }
    })
    this.phaseDirty = true
    this.rosterDirty = true
    return arena
  }

  /** Out of Spirelands to the lobby (an opponent was found for the duel you searched for). */
  pullFromFfa(ent) {
    const arena = this.arenas.get('ffa')
    if (arena) {
      if (ent.alive && ent.lifeKills > 0) this.reward(ent, { kind: 'ffa', mode: ent.kit, win: false, kills: ent.lifeKills, hits: ent.stats.hits, bestCombo: ent.stats.best, bounties: ent.bounties || 0 })
      if (ent.alive) this.toArena(arena, 'feed', { k: '', v: ent.name, how: 'left' })
    }
    ent.alive = false
    this.toLobby(ent)
  }

  makeBot(mode, team) {
    const eid = this.nextEid++
    const taken = new Set([...this.ents.values()].map((e) => e.name))
    const free = BOT_NAMES.filter((n) => !taken.has(n))
    const pool = free.length ? free : BOT_NAMES
    const name = pool[Math.floor(this.random() * pool.length)]
    // Bots' kill effects (the 'cape' slot).
    const capes = ['none', 'none', 'crimson', 'ocean', 'leaf', 'checker', 'pixel', 'galaxy']
    const bot = this.makeEnt(eid, name, { bot: true, cape: capes[Math.floor(this.random() * capes.length)], level: 2 + ((eid * 7) % 30), team })
    bot.kit = mode
    this.ents.set(eid, bot)
    return bot
  }

  /** The vote is in: build the arena and bring both fighters in for round one. */
  startDuel(arena) {
    const counts = {}
    for (const v of arena.votes.values()) counts[v] = (counts[v] || 0) + 1
    const best = Math.max(0, ...Object.values(counts))
    const pool = best ? arena.mapOptions.filter((id) => counts[id] === best) : arena.mapOptions
    arena.mapId = pool[Math.floor(this.random() * pool.length)]
    for (const eid of arena.fighters) {
      const e = this.ents.get(eid)
      if (e && !e.bot) {
        const m = this.members.get(e.cid)
        if (m) m.duels += 1
      }
    }
    this.startRound(arena)
    this.track('duel_start', { mode: arena.mode, map: arena.mapId, bot: arena.fighters.some((eid) => this.ents.get(eid)?.bot) })
  }

  /** A fresh arena, full health and kits, both on their spawns, and the countdown. */
  startRound(arena) {
    const gen = generateArena(arena.mapId, arena.seed)
    arena.world = gen.world
    arena.campfires = new Set()
    arena.fires = []
    arena.water = new Set()
    arena.waterAt = 0
    arena.spawns = gen.spawns
    arena.center = gen.center
    arena.edits.clear()
    arena.pending = []
    arena.projs = []
    arena.placed.clear()
    arena.round += 1
    arena.roundWinner = null
    arena.fighters.forEach((eid, i) => {
      const e = this.ents.get(eid)
      if (!e) return
      const s = gen.spawns[i]
      const yaw = Math.atan2(-(gen.center.x - s.x), -(gen.center.z - s.z))
      this.equip(e, arena.mode)
      e.zone = 'match'
      e.arena = arena.key
      e.alive = true
      e.yaw = yaw
      if (e.bot) {
        e.body = createBody(s.x, s.y, s.z)
        e.brain = createBrain(this.random, arena.botLevel)
        this.teleport(e, s.x, s.y, s.z, yaw)
      } else {
        this.sendMatch(e, arena)
        this.teleport(e, s.x, s.y, s.z, yaw)
      }
    })
    this.setArenaPhase(arena, 'countdown', DUEL.countdownMs)
    this.rosterDirty = true
  }

  /** Kit, armour and health for a fight. */
  equip(e, mode) {
    e.kit = mode
    e.inv = kitHotbar(mode)
    e.sel = 0
    e.armor = kitArmor(mode)
    e.hp = HP
    e.maxHp = HP
    e.absorb = 0
    e.effects = {}
    e.air = AIR.ms
    e.airBubbles = AIR.bubbles
    e.lastHitBy = null
    e.lastHurtAt = 0
    e.hurtUntil = 0
    e.blocking = false
    e.shieldOffUntil = 0
    e.lungeAt = 0
    e.lungeUntil = 0
    e.noFallUntil = 0
    e.wasAir = false
    e.lifeKills = 0
    e.dirty = true
  }

  setArenaPhase(arena, phase, ms) {
    arena.phase = phase
    arena.phaseEnds = this.now() + ms
    this.phaseDirty = true
  }

  tickDuel(arena, dt, now) {
    if (arena.phase === 'vote') {
      const humans = arena.fighters.map((eid) => this.ents.get(eid)).filter((e) => e && !e.bot)
      if (now >= arena.phaseEnds || humans.every((e) => arena.votes.has(e.eid))) this.startDuel(arena)
    } else if (arena.phase === 'countdown') {
      if (now >= arena.phaseEnds) {
        this.setArenaPhase(arena, 'fight', DUEL.roundMs)
        arena.fightStart = now
      }
    } else if (arena.phase === 'fight') {
      this.tickFighters(arena, dt, now)
      if (arena.phase === 'fight' && now >= arena.phaseEnds) this.duelTimeUp(arena)
    } else if (arena.phase === 'between') {
      if (now >= arena.phaseEnds) this.startRound(arena)
    } else if (arena.phase === 'ended') {
      if (now >= arena.phaseEnds) this.closeDuel(arena)
    }
  }

  /** Time's up: the healthier fighter (by share of health left) takes the round. */
  duelTimeUp(arena) {
    const [a, b] = arena.fighters.map((eid) => this.ents.get(eid))
    const share = (e) => (e && e.alive ? (e.hp + e.absorb) / e.maxHp : -1)
    const diff = share(a) - share(b)
    this.roundOver(arena, Math.abs(diff) < 0.001 ? null : diff > 0 ? a : b, 'time')
  }

  /** A round is decided (`winner` null for a draw): the next one, or the end of the duel. */
  roundOver(arena, winner, why = 'kill') {
    if (arena.phase !== 'fight') return
    arena.projs = []
    if (winner) arena.score.set(winner.eid, (arena.score.get(winner.eid) || 0) + 1)
    else arena.draws += 1
    arena.roundWinner = winner ? winner.eid : 0
    const score = this.scoreList(arena)
    this.toArena(arena, 'roundEnd', { winner: winner?.eid || 0, name: winner?.name || '', why, score, round: arena.round })
    const ft = MODES[arena.mode].ft
    const top = winner ? arena.score.get(winner.eid) : 0
    // Endless draws can't hold a duel hostage: after enough rounds the score decides.
    if (top >= ft || arena.round >= ft * 2 + 2) {
      const sorted = [...arena.score.entries()].sort((p, q) => q[1] - p[1])
      const champ = sorted[0][1] > (sorted[1]?.[1] ?? -1) ? this.ents.get(sorted[0][0]) : null
      this.endDuel(arena, champ, false)
    } else {
      this.setArenaPhase(arena, 'between', DUEL.betweenMs)
    }
  }

  scoreList(arena) {
    return arena.fighters.map((eid) => {
      const e = this.ents.get(eid)
      return { eid, name: e?.name || 'Player', wins: arena.score.get(eid) || 0, team: e?.team ?? 0, bot: Boolean(e?.bot) }
    })
  }

  endDuel(arena, winner, forfeit) {
    if (arena.phase === 'ended') return
    arena.winner = winner ? winner.eid : 0
    this.setArenaPhase(arena, 'ended', DUEL.endMs)
    const score = this.scoreList(arena)
    this.toArena(arena, 'duelEnd', { winner: winner?.eid || 0, name: winner?.name || 'Nobody', score, forfeit: Boolean(forfeit), mode: arena.mode })
    for (const eid of arena.fighters) {
      const e = this.ents.get(eid)
      if (!e || e.bot || !e.cid) continue
      // Duel stats travel with the reward card.
      this.sendTo(e.cid, 'duelStats', { ...e.stats })
      this.reward(e, { kind: 'duel', mode: arena.mode, win: winner === e, kills: e.kills, hits: e.stats.hits, bestCombo: e.stats.best })
    }
    this.track('duel_end', {
      mode: arena.mode,
      map: arena.mapId,
      rounds: arena.round,
      forfeit: Boolean(forfeit),
      bot: arena.fighters.some((eid) => this.ents.get(eid)?.bot),
      winnerBot: winner ? Boolean(winner.bot) : null,
      durationMs: this.now() - arena.startedAt,
    })
  }

  /** The duel is over: everyone still in it goes back to the lobby. */
  closeDuel(arena) {
    for (const eid of arena.fighters) {
      const e = this.ents.get(eid)
      if (!e) continue
      if (e.bot) {
        this.ents.delete(eid)
        continue
      }
      const m = this.members.get(e.cid)
      if (m?.duel === arena.key) {
        m.duel = null
        if (e.arena === arena.key) this.toLobby(e)
      }
    }
    this.arenas.delete(arena.key)
    this.rosterDirty = true
    this.phaseDirty = true
  }

  /**
   * `ent` walks out of whatever game it's in (back to the lobby, or gone): a duel not yet
   * decided is a forfeit; a Spirelands life is paid out.
   */
  leaveArena(ent, why) {
    const member = ent.cid ? this.members.get(ent.cid) : null
    const key = member?.duel || ent.arena
    const arena = this.arenas.get(key)
    // Out of a duel: no queue. Out of Spirelands: a duel search you started goes on.
    if (member && arena?.kind !== 'ffa') member.queue = null
    if (!arena) return
    if (arena.kind === 'duel') {
      if (member) member.duel = null
      const other = arena.fighters.map((eid) => this.ents.get(eid)).find((e) => e && e !== ent)
      if (arena.phase === 'vote') {
        // Not started yet: the other player goes back in the queue.
        if (other && !other.bot) {
          const om = this.members.get(other.cid)
          if (om) {
            om.duel = null
            om.queue = arena.mode
            om.queuedAt = this.now()
            this.sendTo(other.cid, 'toast', { text: 'Your opponent left - back in the queue', kind: 'error' })
          }
        }
        for (const eid of arena.fighters) if (this.ents.get(eid)?.bot) this.ents.delete(eid)
        this.arenas.delete(arena.key)
      } else if (arena.phase !== 'ended') {
        ent.alive = false
        this.endDuel(arena, other || null, true)
        if (other && !other.bot) this.sendTo(other.cid, 'toast', { text: `${ent.name} left - you win!`, kind: 'success' })
      }
      // Nobody real left in it: close it now.
      if (this.arenas.has(arena.key) && !arena.fighters.some((eid) => {
        const e = this.ents.get(eid)
        return e && !e.bot && e !== ent && this.members.get(e.cid)?.duel === arena.key
      })) this.closeDuel(arena)
    } else if (arena.kind === 'ffa') {
      if (ent.alive && ent.lifeKills > 0) this.reward(ent, { kind: 'ffa', mode: ent.kit, win: false, kills: ent.lifeKills, hits: ent.stats.hits, bestCombo: ent.stats.best, bounties: ent.bounties || 0 })
      ent.alive = false
      this.toArena(arena, 'feed', { k: '', v: ent.name, how: why === 'left' ? 'left' : why })
    }
    ent.arena = null
    this.rosterDirty = true
    this.phaseDirty = true
  }

  // --- Spirelands ---------------------------------------------------------------------------

  ffaArena() {
    let arena = this.arenas.get('ffa')
    if (arena) return arena
    const gen = generateSpirelands(FFA_SEED)
    arena = {
      key: 'ffa',
      kind: 'ffa',
      mode: 'ffa',
      mapId: 'spirelands',
      seed: FFA_SEED,
      world: gen.world,
      spawns: gen.spawns,
      center: gen.center,
      chests: gen.chests.map((c) => ({ ...c, refillAt: 0 })),
      edits: new Map(),
      pending: [],
      projs: [],
      fires: [],
      fireBy: new Map(),
      nextProj: 1,
      phase: 'fight',
      phaseEnds: 0,
      placed: new Set(),
      protect: false,
      orig: new Map(),
      restore: [],
      botLevel: 'easy',
    }
    this.arenas.set('ffa', arena)
    return arena
  }

  enterFfa(member, ent) {
    if (member.duel || ent.zone !== 'lobby') return
    // A duel search carries on in here: when an opponent turns up you're pulled out to it.
    const arena = this.ffaArena()
    ent.zone = 'spec'
    ent.arena = 'ffa'
    ent.alive = false
    ent.needKit = true
    ent.team = -1
    ent.kills = 0
    this.sendMatch(ent, arena)
    const c = arena.center
    this.teleport(ent, c.x, c.y + 18, c.z, 0)
    this.rosterDirty = true
    this.phaseDirty = true
  }

  pickKit(ent, mode) {
    const arena = this.arenas.get(ent.arena)
    if (!arena || arena.kind !== 'ffa' || ent.alive || !MODES[mode]) return
    this.spawnFfa(arena, ent, mode)
  }

  /** Into Spirelands with a kit, at the spawn farthest from anyone fighting. */
  spawnFfa(arena, ent, mode) {
    const others = [...this.ents.values()].filter((e) => e !== ent && e.arena === arena.key && e.alive)
    let best = arena.spawns[0]
    let bestD = -1
    for (const s of arena.spawns) {
      const d = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : this.random() * 10
      if (d > bestD) {
        best = s
        bestD = d
      }
    }
    this.equip(ent, mode)
    ent.stats = freshStats()
    ent.bounties = 0
    ent.zone = 'match'
    ent.arena = arena.key
    ent.alive = true
    ent.needKit = false
    const yaw = this.random() * Math.PI * 2
    if (ent.bot) {
      ent.body = createBody(best.x, best.y, best.z)
      ent.brain = createBrain(this.random, arena.botLevel)
    } else if (ent.cid && ent.lastWorld !== arena.key) this.sendMatch(ent, arena)
    this.teleport(ent, best.x, best.y, best.z, yaw)
    this.rosterDirty = true
    this.phaseDirty = true
  }

  tickFfa(arena, dt, now) {
    // A few people: keep the world lively with bots. Nobody, or enough real players
    // (FFA.population): no bots - they leave and it's people only.
    let humans = 0
    const bots = []
    for (const e of this.ents.values()) {
      if (e.arena !== arena.key) continue
      if (e.bot) bots.push(e)
      else humans += 1
    }
    const want = humans ? Math.max(0, FFA.population - humans) : 0
    if (bots.length > want) {
      // Retire the dead first, then whoever is furthest from everyone.
      bots.sort((a, b) => Number(a.alive) - Number(b.alive))
      for (const b of bots.slice(0, bots.length - want)) {
        if (b.alive) this.toArena(arena, 'feed', { k: '', v: b.name, how: 'left' })
        this.ents.delete(b.eid)
      }
      this.rosterDirty = true
    } else if (bots.length < want) {
      const bot = this.makeBot(BOT_KITS[Math.floor(this.random() * BOT_KITS.length)], -1)
      bot.arena = arena.key
      bot.team = -1
      this.spawnFfa(arena, bot, bot.kit)
    }
    for (const b of bots) {
      if (!b.alive && b.respawnAt && now >= b.respawnAt && this.ents.has(b.eid)) {
        b.respawnAt = 0
        this.spawnFfa(arena, b, BOT_KITS[Math.floor(this.random() * BOT_KITS.length)])
      }
    }
    if (!humans && !bots.length) return
    this.tickFighters(arena, dt, now)
    this.tickChests(arena, now)
    // The world mends itself: broken ground grows back, placed blocks crumble.
    while (arena.restore.length && arena.restore[0].at <= now) {
      const r = arena.restore.shift()
      const orig = arena.orig.get(r.key)
      if (orig === undefined) continue
      const [x, y, z] = unpackKey(r.key)
      if (orig !== B.AIR && [...this.ents.values()].some((e) => e.arena === arena.key && e.alive && cellOverlapsBody(x, y, z, e.x, e.y, e.z))) {
        arena.restore.push({ key: r.key, at: now + 5000 })
        continue
      }
      arena.orig.delete(r.key)
      arena.placed.delete(r.key)
      this.setBlock(arena, x, y, z, orig, true)
    }
  }

  // --- The fight ------------------------------------------------------------------------

  tick(dt) {
    const now = this.now()
    this.matchmake(now)
    for (const arena of [...this.arenas.values()]) {
      if (arena.kind === 'duel') this.tickDuel(arena, dt, now)
      else this.tickFfa(arena, dt, now)
    }
    this.flush(dt, now)
  }

  tickFighters(arena, dt, now) {
    for (const ent of this.ents.values()) {
      if (ent.arena !== arena.key || ent.zone !== 'match' || !ent.alive) continue
      if (ent.bot && ent.body) thinkBot(this, arena, ent, dt, now)
      this.tickStatus(arena, ent, now)
    }
    this.tickProjectiles(arena, dt, now)
    this.tickFires(arena, now)
    this.tickWater(arena, now)
  }

  // --- Water ---------------------------------------------------------------------------------

  /** Something changed at (x, y, z): water there or next to it settles again soon. */
  wakeWater(arena, x, y, z) {
    if (!arena.water) arena.water = new Set()
    const w = arena.world
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx
      const ny = y + dy
      const nz = z + dz
      if (w.inBounds(nx, ny, nz)) arena.water.add(blockKey(nx, ny, nz))
    }
    if (!arena.waterAt) arena.waterAt = this.now() + WATER.stepMs
  }

  /** Flowing water settles a step: falls, spreads, or dries up where nothing feeds it. */
  tickWater(arena, now) {
    if (!arena.water?.size || now < (arena.waterAt || 0)) return
    arena.waterAt = 0
    const keys = [...arena.water]
    arena.water.clear()
    let budget = WATER.perStep
    for (const key of keys) {
      if (budget <= 0) {
        arena.water.add(key)
        continue
      }
      const [x, y, z] = unpackKey(key)
      if (this.settleWater(arena, x, y, z)) budget -= 1
    }
    if (arena.water.size && !arena.waterAt) arena.waterAt = now + WATER.stepMs
  }

  /** One cell's water rules (Minecraft's): returns whether anything changed. */
  settleWater(arena, x, y, z) {
    const w = arena.world
    const open = (id) => id === B.AIR || id === B.FIRE || BLOCKS[id]?.render === 'cross'
    // Water spreads sideways only from on top of something: a solid block or still water
    // (not while falling).
    const canSpread = (bx, by, bz) => {
      const below = w.get(bx, by - 1, bz)
      return by > 0 && !open(below) && (!isWater(below) || below === B.WATER)
    }
    let changed = false
    let id = w.get(x, y, z)
    let level = waterLevel(id)
    if (level > 0) {
      // Flowing water stays only while something feeds it: water above, or water beside
      // that is closer to its source and spreading.
      let want = isWater(w.get(x, y + 1, z)) ? 1 : 99
      for (const [dx, , dz] of SIDES) {
        const l = waterLevel(w.get(x + dx, y, z + dz))
        if (l >= 0 && l < 7 && canSpread(x + dx, y, z + dz)) want = Math.min(want, l + 1)
      }
      if (want > 7) {
        this.setWater(arena, x, y, z, B.AIR)
        return true
      }
      if (want !== level) {
        this.setWater(arena, x, y, z, flowBlock(want))
        changed = true
        id = w.get(x, y, z)
        level = want
      }
    }
    if (level < 0) return changed
    // Down first; if it can't fall, outwards one level weaker.
    if (y > 1 && open(w.get(x, y - 1, z))) {
      this.setWater(arena, x, y - 1, z, flowBlock(1))
      return true
    }
    if (level < 7 && canSpread(x, y, z)) {
      for (const [dx, , dz] of SIDES) {
        if (!w.inBounds(x + dx, y, z + dz) || !open(w.get(x + dx, y, z + dz))) continue
        this.setWater(arena, x + dx, y, z + dz, flowBlock(level + 1))
        changed = true
      }
    }
    return changed
  }

  /** The water system's own change: not part of the world that grows back, and it wakes the cells round it. */
  setWater(arena, x, y, z, id) {
    this.setBlock(arena, x, y, z, id, true, true)
    this.wakeWater(arena, x, y, z)
  }

  // --- Fire -----------------------------------------------------------------------------------

  /** A fire arrow landed at (x, y, z): a small patch of the ground nearby catches. */
  igniteAt(arena, x, y, z, owner) {
    const w = arena.world
    if (isWater(w.get(x, y, z))) return
    if (!arena.fires) arena.fires = []
    if (!arena.fireBy) arena.fireBy = new Map()
    const cx = Math.floor(x)
    const cy = Math.floor(y + 0.25)
    const cz = Math.floor(z)
    const spots = []
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bx = cx + dx
          const by = cy + dy
          const bz = cz + dz
          const d = Math.hypot(bx + 0.5 - x, by + 0.2 - y, bz + 0.5 - z)
          if (d > FIRE.radius + 0.6) continue
          const here = w.get(bx, by, bz)
          if ((here !== B.AIR && BLOCKS[here]?.render !== 'cross') || here === B.FIRE) continue
          if (!w.isSolid(bx, by - 1, bz) || isWater(w.get(bx, by - 1, bz))) continue
          spots.push({ bx, by, bz, d })
        }
      }
    }
    spots.sort((a, b) => a.d - b.d)
    const now = this.now()
    let lit = 0
    for (const { bx, by, bz } of spots) {
      if (lit >= FIRE.cells || arena.fires.length >= FIRE.max) break
      this.setBlock(arena, bx, by, bz, B.FIRE, true)
      arena.fires.push({ x: bx, y: by, z: bz, at: now + FIRE.lifeMs + Math.floor(this.random() * 1500) })
      arena.fireBy.set(blockKey(bx, by, bz), owner)
      lit += 1
    }
    if (lit) this.toArena(arena, 'ignite', { x, y, z })
  }

  /** Flames burn out. */
  tickFires(arena, now) {
    const fires = arena.fires
    if (!fires?.length) return
    for (let i = fires.length - 1; i >= 0; i -= 1) {
      const f = fires[i]
      if (f.at > now && arena.world.get(f.x, f.y, f.z) === B.FIRE) continue
      fires.splice(i, 1)
      arena.fireBy?.delete(blockKey(f.x, f.y, f.z))
      if (arena.world.get(f.x, f.y, f.z) === B.FIRE) this.setBlock(arena, f.x, f.y, f.z, B.AIR, true)
    }
  }

  /** Water poured at (x, y, z): nearby flames go out, and so does anyone burning there. */
  douse(arena, x, y, z) {
    for (const f of arena.fires || []) {
      if (Math.hypot(f.x + 0.5 - x, f.y + 0.5 - y, f.z + 0.5 - z) <= FIRE.douse) f.at = 0
    }
    this.tickFires(arena, this.now())
    for (const e of this.ents.values()) {
      if (e.arena === arena.key && e.alive && Math.hypot(e.x - x, e.y + 0.9 - y, e.z - z) <= FIRE.douse) this.extinguish(e)
    }
    this.toArena(arena, 'douse', { x, y, z })
  }

  // --- Loot chests (Spirelands) ---------------------------------------------------------------

  /** Opens the chest at (x, y, z): random gear into the inventory; it comes back later. */
  openChest(ent, x, y, z) {
    const arena = this.actArena(ent)
    const chest = arena?.chests?.find((c) => c.x === x && c.y === y && c.z === z)
    if (!chest || arena.world.get(x, y, z) !== B.LOOT_CHEST || !this.inReach(ent, x, y, z)) return
    const total = LOOT.table.reduce((s, r) => s + r[2], 0)
    const got = []
    for (let i = 0; i < LOOT.rolls; i += 1) {
      let pick = this.random() * total
      const row = LOOT.table.find((r) => (pick -= r[2]) < 0) || LOOT.table[0]
      const n = this.give(ent, row[0], row[1])
      if (n) got.push([row[0], n])
    }
    chest.refillAt = this.now() + LOOT.refillMs
    this.setBlock(arena, x, y, z, B.AIR, true)
    if (ent.cid) this.sendTo(ent.cid, 'looted', { items: got })
    this.toArena(arena, 'chestOpen', { x: x + 0.5, y: y + 0.5, z: z + 0.5 })
  }

  /** Opened chests fill up again (when nobody stands in the way). */
  tickChests(arena, now) {
    for (const c of arena.chests || []) {
      if (!c.refillAt || now < c.refillAt) continue
      const here = arena.world.get(c.x, c.y, c.z)
      if (here !== B.AIR && BLOCKS[here]?.render !== 'cross') continue
      if ([...this.ents.values()].some((e) => e.arena === arena.key && e.alive && cellOverlapsBody(c.x, c.y, c.z, e.x, e.y, e.z))) continue
      c.refillAt = 0
      this.setBlock(arena, c.x, c.y, c.z, B.LOOT_CHEST, true)
    }
  }

  // --- Inventory: picking up, crafting ------------------------------------------------------

  /** Puts `n` of `id` in the inventory (topping up stacks, then empty slots). Returns how many fit. */
  give(ent, id, n) {
    const max = ITEMS[id]?.stack || 1
    const inv = ent.inv
    let left = n
    for (let i = 0; i <= OFFHAND && left > 0; i += 1) {
      const s = inv[i]
      if (s && s.id === id && s.n < max) {
        const k = Math.min(left, max - s.n)
        s.n += k
        left -= k
      }
    }
    for (let i = 0; i < OFFHAND && left > 0; i += 1) {
      if (inv[i]) continue
      const k = Math.min(left, max)
      inv[i] = { id, n: k }
      left -= k
    }
    if (left < n) ent.dirty = true
    return n - left
  }

  /** How many of `id` the inventory holds. */
  count(ent, id) {
    let n = 0
    for (const s of ent.inv) if (s?.id === id) n += s.n
    return n
  }

  /** Takes `n` of `id` from anywhere, the bag first so the hotbar stays as it is. */
  takeItem(ent, id, n) {
    let left = n
    for (let i = ent.inv.length - 1; i >= 0 && left > 0; i -= 1) {
      const s = ent.inv[i]
      if (s?.id !== id) continue
      const k = Math.min(left, s.n)
      this.take(ent, i, k)
      left -= k
    }
  }

  craft(ent, id) {
    if (ent.zone !== 'match' || !ent.alive) return
    const r = RECIPES.find((x) => x.id === id)
    if (!r || !r.need.every(([item, n]) => this.count(ent, item) >= n)) return
    for (const [item, n] of r.need) this.takeItem(ent, item, n)
    const got = this.give(ent, r.out[0], r.out[1])
    // No room for it after all: everything goes back.
    if (!got) {
      for (const [item, n] of r.need) this.give(ent, item, n)
      return
    }
    ent.dirty = true
    if (ent.cid) this.sendTo(ent.cid, 'crafted', { id: r.out[0], n: got })
  }

  tickStatus(arena, ent, now) {
    if (!ent.alive) return
    const w = arena.world
    if (ent.y < -12 || ent.x < -16 || ent.z < -16 || ent.x > w.sx + 16 || ent.z > w.sz + 16) {
      this.damage(ent, 999, ent.lastHitBy && now - ent.lastHitBy.at < 10000 ? ent.lastHitBy.eid : null, 'void', { pierce: true, iframes: false })
      return
    }
    const fx = ent.effects
    const kit = MODES[ent.kit]
    // Healing: the regeneration effect, or slowly on your own (kits that allow it).
    const regen = fx.regen > now
    const interval = regen ? 1000 : COMBAT.regenMs
    if (ent.hp < ent.maxHp && (regen || (kit?.regen && now - ent.lastHurtAt > COMBAT.regenDelayMs)) && now - ent.lastRegenAt >= interval) {
      ent.lastRegenAt = now
      ent.hp = Math.min(ent.maxHp, ent.hp + 1)
      ent.dirty = true
    }
    // Fire: standing in flames sets you alight; water puts you out; burning hurts.
    const fx0 = Math.floor(ent.x)
    const fz0 = Math.floor(ent.z)
    const burns = (id) => id === B.FIRE || id === B.CAMPFIRE
    const flame = burns(w.get(fx0, Math.floor(ent.y + 0.2), fz0)) || burns(w.get(fx0, Math.floor(ent.y + 1.1), fz0))
    // Beside (not in) a campfire: its warmth heals, slowly.
    if (!flame && arena.campfires?.size && ent.hp < ent.maxHp && now - (ent.lastWarmAt || 0) >= CAMPFIRE.everyMs) {
      for (const key of arena.campfires) {
        const [cx, cy, cz] = unpackKey(key)
        if (Math.hypot(cx + 0.5 - ent.x, cy - ent.y, cz + 0.5 - ent.z) > CAMPFIRE.radius) continue
        ent.lastWarmAt = now
        ent.hp = Math.min(ent.maxHp, ent.hp + CAMPFIRE.heal)
        ent.dirty = true
        break
      }
    }
    if (flame) {
      if (!(fx.burn > now)) ent.dirty = true
      fx.burn = now + FIRE.burnMs
      const by = arena.fireBy?.get(blockKey(fx0, Math.floor(ent.y + 0.2), fz0))
      if (by && by !== ent.eid) ent.burnBy = by
    }
    // Breath: head under water uses it up, then you drown; out of the water it comes back.
    const step = Math.min(250, now - (ent.airAt || now))
    ent.airAt = now
    if (ent.air === undefined) ent.air = AIR.ms
    if (isWater(w.get(fx0, Math.floor(ent.y + PLAYER.eye), fz0))) {
      ent.air = Math.max(0, ent.air - step)
      if (ent.air <= 0 && now - (ent.lastDrownAt || 0) >= AIR.tickMs) {
        ent.lastDrownAt = now
        const by = ent.lastHitBy && now - ent.lastHitBy.at < 10000 ? ent.lastHitBy.eid : null
        this.damage(ent, AIR.dmg, by, 'drown', { pierce: true, iframes: false })
        if (!ent.alive) return
      }
    } else if (ent.air < AIR.ms) ent.air = Math.min(AIR.ms, ent.air + step * AIR.refill)
    const bubbles = Math.ceil((ent.air / AIR.ms) * AIR.bubbles)
    if (bubbles !== ent.airBubbles) {
      ent.airBubbles = bubbles
      ent.dirty = true
    }
    if (fx.burn > now) {
      if (inWater(w, ent.x, ent.y, ent.z)) this.extinguish(ent)
      else if (now - (ent.lastBurnAt || 0) >= FIRE.tickMs) {
        ent.lastBurnAt = now
        this.damage(ent, FIRE.dmg, ent.burnBy || null, 'fire', { pierce: true, iframes: false })
        if (!ent.alive) return
      }
    }
    for (const k of Object.keys(fx)) {
      if (fx[k] && fx[k] <= now) {
        delete fx[k]
        ent.dirty = true
      }
    }
  }

  /** Not burning any more. */
  extinguish(ent) {
    if (!ent.effects.burn) return
    delete ent.effects.burn
    ent.burnBy = null
    ent.dirty = true
  }

  eye(ent) {
    return { x: ent.x, y: ent.y + PLAYER.eye, z: ent.z }
  }

  heldItem(ent) {
    return ent.inv[ent.sel]?.id || 'fist'
  }

  inReach(ent, x, y, z, reach = REACH + REACH_SLACK) {
    const e = this.eye(ent)
    return Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z) <= reach + 0.9
  }

  /** The arena `ent` fights in, if it can act there right now. */
  actArena(ent) {
    if (ent.zone !== 'match' || !ent.alive) return null
    const arena = this.arenas.get(ent.arena)
    return arena && arena.world && arena.phase === 'fight' ? arena : null
  }

  // --- Blocks -------------------------------------------------------------------------------

  onBreak(ent, x, y, z) {
    const arena = this.actArena(ent)
    if (!arena) return this.reject(ent, x, y, z)
    const id = arena.world.get(x, y, z)
    const def = BLOCKS[id]
    const key = blockKey(x, y, z)
    if (!def || id === B.AIR || !Number.isFinite(def.hard) || !this.inReach(ent, x, y, z)) return this.reject(ent, x, y, z)
    if (arena.protect && !arena.placed.has(key)) return this.reject(ent, x, y, z)
    const need = breakSeconds(def.hard) * 1000
    const dig = ent.dig
    if (need > 60 && (!dig || dig.key !== key || this.now() - dig.at < need * 0.7 - 150)) return this.reject(ent, x, y, z)
    ent.dig = null
    this.breakBlock(arena, ent, x, y, z)
  }

  /** Breaks a block for `ent` (already checked): crystals explode. */
  breakBlock(arena, ent, x, y, z) {
    const id = arena.world.get(x, y, z)
    // Flames just go out (and don't grow back with the world).
    this.setBlock(arena, x, y, z, B.AIR, id === B.FIRE)
    if (BLOCKS[arena.world.get(x, y + 1, z)]?.render === 'cross') this.setBlock(arena, x, y + 1, z, B.AIR, arena.world.get(x, y + 1, z) === B.FIRE)
    if (isCrystal(id)) {
      this.explode(arena, x + 0.5, y + 0.5, z + 0.5, ent.eid)
      return
    }
    // What you mine goes into your inventory.
    const drop = BLOCKS[id]?.drop
    if (ent && ITEMS[drop] && this.give(ent, drop, 1) && ent.cid) this.sendTo(ent.cid, 'pickup', { id: drop })
  }

  onPlace(ent, x, y, z, hand) {
    const arena = this.actArena(ent)
    if (!arena) return this.reject(ent, x, y, z)
    const index = hand === 'off' ? OFFHAND : ent.sel
    const slot = ent.inv[index]
    const item = slot && ITEMS[slot.id]
    const water = item?.kind === 'bucket' && item.fill === 'water'
    if (!item || (item.kind !== 'block' && item.kind !== 'crystal' && !water) || !this.inReach(ent, x, y, z)) return this.reject(ent, x, y, z)
    if (!(water ? this.pourWater(arena, ent, x, y, z, index) : this.placeBlock(arena, ent, x, y, z, index))) this.reject(ent, x, y, z)
  }

  /** A water bucket poured into cell (x, y, z) (it may be where you stand: that's the point). */
  pourWater(arena, ent, x, y, z, index) {
    if (!this.canPlaceAt(arena, x, y, z, false, true)) return false
    ent.inv[index] = { id: 'bucket', n: 1 }
    ent.dirty = true
    this.setBlock(arena, x, y, z, B.WATER)
    arena.placed.add(blockKey(x, y, z))
    this.douse(arena, x + 0.5, y + 0.5, z + 0.5)
    this.toWatchers(ent, 'swing', { eid: ent.eid })
    return true
  }

  /**
   * Right click with a bucket: an empty one fills from the water you point at (water you
   * poured is taken back; the sea and lakes never run dry); a full one with nowhere to
   * pour is tipped over yourself - out goes the fire.
   */
  useBucket(ent, index, p) {
    const arena = this.actArena(ent)
    const item = ITEMS[ent.inv[index]?.id]
    if (!arena || item?.kind !== 'bucket') return
    if (item.fill === 'water') {
      ent.inv[index] = { id: 'bucket', n: 1 }
      ent.dirty = true
      this.douse(arena, ent.x, ent.y + 0.9, ent.z)
      return
    }
    const x = Math.floor(num(p.x, NaN))
    const y = Math.floor(num(p.y, NaN))
    const z = Math.floor(num(p.z, NaN))
    if (!Number.isFinite(x + y + z) || arena.world.get(x, y, z) !== B.WATER || !this.inReach(ent, x, y, z)) return
    const key = blockKey(x, y, z)
    if (arena.placed.has(key)) this.setBlock(arena, x, y, z, B.AIR)
    ent.inv[index] = { id: 'water_bucket', n: 1 }
    ent.dirty = true
    this.toWatchers(ent, 'swing', { eid: ent.eid })
  }

  /**
   * Swaps two inventory slots (0-8 hotbar, 9-35 bag, 36 offhand): the inventory screen
   * and the swap-hands key. The same item in both stacks up instead.
   */
  swapSlots(ent, a, b) {
    if (ent.zone !== 'match' || !ent.alive || a === b) return
    if (!(a >= 0 && a < INV_SIZE && b >= 0 && b < INV_SIZE)) return
    const inv = ent.inv
    const A = inv[a]
    const B = inv[b]
    const max = A && ITEMS[A.id]?.stack
    if (A && B && A.id === B.id && max > 1 && B.n < max) {
      const move = Math.min(A.n, max - B.n)
      B.n += move
      A.n -= move
      if (A.n <= 0) inv[a] = null
    } else {
      inv[a] = B
      inv[b] = A
    }
    // The shield left your hands: it's down.
    if (ent.blocking && !hasShield(ent)) ent.blocking = false
    ent.dirty = true
  }

  /** Can a block go in cell (x, y, z) of `arena`? Crystals only sit on obsidian or corestone. */
  canPlaceAt(arena, x, y, z, crystal = false, liquid = false) {
    const w = arena.world
    if (x < 0 || z < 0 || y < 1 || x >= w.sx || z >= w.sz || y >= w.sy - 1) return false
    if (arena.kind === 'duel' && y > ARENA_FLOOR + ARENA_BUILD_HEIGHT) return false
    const here = w.get(x, y, z)
    if (here !== B.AIR && BLOCKS[here].render !== 'cross' && !isWater(here)) return false
    if (crystal) {
      const below = w.get(x, y - 1, z)
      if (below !== B.OBSIDIAN && below !== B.CORESTONE) return false
    }
    const touching =
      w.isSolid(x + 1, y, z) || w.isSolid(x - 1, y, z) || w.isSolid(x, y + 1, z) || w.isSolid(x, y - 1, z) || w.isSolid(x, y, z + 1) || w.isSolid(x, y, z - 1)
    if (!touching) return false
    if (liquid) return true
    for (const e of this.ents.values()) {
      if (e.arena === arena.key && e.zone === 'match' && e.alive && cellOverlapsBody(x, y, z, e.x, e.y, e.z, PLAYER.halfW - 0.05, PLAYER.height - 0.05)) return false
    }
    return true
  }

  placeBlock(arena, ent, x, y, z, index = ent.sel) {
    const slot = ent.inv[index]
    const item = slot && ITEMS[slot.id]
    if (!item) return false
    const crystal = item.kind === 'crystal'
    if (!this.canPlaceAt(arena, x, y, z, crystal)) return false
    this.take(ent, index, 1)
    this.setBlock(arena, x, y, z, crystal ? B.CRYSTAL : item.block)
    arena.placed.add(blockKey(x, y, z))
    this.toWatchers(ent, 'swing', { eid: ent.eid })
    return true
  }

  /** A blast: blocks broken (never the arena's own, nor obsidian), people hurt and thrown. */
  explode(arena, cx, cy, cz, owner, spec = CRYSTAL) {
    const r = spec.radius
    const R = Math.ceil(r)
    const w = arena.world
    for (let x = Math.floor(cx) - R; x <= Math.floor(cx) + R; x += 1) {
      for (let y = Math.floor(cy) - R; y <= Math.floor(cy) + R; y += 1) {
        for (let z = Math.floor(cz) - R; z <= Math.floor(cz) + R; z += 1) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz)
          if (d > r * 0.75 + (this.random() - 0.5) * 0.8) continue
          const id = w.get(x, y, z)
          if (id === B.AIR) continue
          const key = blockKey(x, y, z)
          if (arena.protect && !arena.placed.has(key)) continue
          if (isCrystal(id)) {
            // Chain: the crystal next door goes too, a moment later.
            this.setBlock(arena, x, y, z, B.AIR)
            arena.chain = arena.chain || []
            arena.chain.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, owner })
            continue
          }
          const def = BLOCKS[id]
          if (!Number.isFinite(def.hard) || def.hard >= 2.4 || isWater(id)) continue
          this.setBlock(arena, x, y, z, B.AIR)
        }
      }
    }
    this.toArena(arena, 'boom', { x: cx, y: cy, z: cz, r })
    for (const e of this.ents.values()) {
      if (e.arena !== arena.key || e.zone !== 'match' || !e.alive) continue
      const dx = e.x - cx
      const dy = e.y + 0.9 - cy
      const dz = e.z - cz
      const d = Math.hypot(dx, dy, dz)
      if (d > r + 1.5) continue
      // Cover between you and the blast takes most of it.
      const seen = !raycastVoxels(w, cx, cy, cz, dx, dy, dz, Math.max(0.1, d - 0.6), isSolidBlock)
      const f = (1 - d / (r + 1.5)) * (seen ? 1 : 0.25)
      const len = Math.hypot(dx, dz) || 1
      this.damage(e, Math.max(1, spec.damage * f), owner, 'boom', {
        kx: (dx / len) * spec.knock * f,
        kz: (dz / len) * spec.knock * f,
        ky: 5 + 6 * f,
        from: { x: cx, z: cz },
      })
    }
    const chain = arena.chain
    arena.chain = null
    if (chain) for (const c of chain.slice(0, 6)) this.explode(arena, c.x, c.y, c.z, c.owner, spec)
  }

  // --- Melee ----------------------------------------------------------------------------------

  onAttack(ent, targetEid) {
    const arena = this.actArena(ent)
    if (!arena) return
    const target = this.ents.get(targetEid)
    if (!target || target === ent || target.arena !== ent.arena || target.zone !== 'match' || !target.alive) return
    const item = ITEMS[this.heldItem(ent)] || ITEMS.fist
    const now = this.now()
    const cd = MELEE_KINDS.has(item.kind) ? item.cd : 250
    if (now - ent.lastAttackAt < Math.max(60, cd * 0.8)) return
    const e = this.eye(ent)
    const nx = clamp(e.x, target.x - PLAYER.halfW, target.x + PLAYER.halfW)
    const ny = clamp(e.y, target.y, target.y + PLAYER.height)
    const nz = clamp(e.z, target.z - PLAYER.halfW, target.z + PLAYER.halfW)
    if (Math.hypot(nx - e.x, ny - e.y, nz - e.z) > (item.reach || COMBAT.reach) + REACH_SLACK) return
    this.melee(arena, ent, target)
  }

  /** A melee hit from `ent` on `target`: crits, mace smashes, lunges, shields and all. */
  melee(arena, ent, target) {
    const now = this.now()
    ent.lastAttackAt = now
    const item = ITEMS[this.heldItem(ent)] || ITEMS.fist
    const kind = MELEE_KINDS.has(item.kind) ? item.kind : 'none'
    let dmg = kind === 'none' ? 1 : item.dmg
    if (ent.effects.strength > now) dmg += EFFECTS.strength.dmgAdd
    const falling = ent.bot ? ent.body && !ent.body.onGround && ent.body.vy < -0.5 : ent.anim === 4 && ent.falling
    const crit = falling && kind !== 'mace'
    if (crit) dmg *= COMBAT.critMul
    let smash = 0
    if (kind === 'mace') {
      const fall = Math.max(0, (ent.wasAir || (ent.bot && !ent.body?.onGround) ? ent.peakY : ent.y) - ent.y)
      if (fall > 1.5) {
        smash = Math.min(COMBAT.maceCap, Math.min(fall, 3) * COMBAT.maceFirst + Math.max(0, fall - 3) * COMBAT.maceAfter)
        dmg += smash
      }
    }
    if (kind === 'spear' && now < ent.lungeUntil) {
      dmg += COMBAT.lungeBonus
      ent.lungeUntil = 0
    }
    if (ent.bot) dmg = Math.max(1, dmg * (BOT_LEVELS[arena.botLevel]?.damage ?? 0.85))
    const dx = target.x - ent.x
    const dz = target.z - ent.z
    const len = Math.hypot(dx, dz) || 1
    const boost = ent.anim === 2 ? COMBAT.sprintKnock : 1
    const k = COMBAT.knock * boost * (smash ? 1.3 : 1)
    this.toWatchers(ent, 'swing', { eid: ent.eid })
    const dealt = this.damage(target, dmg, ent.eid, 'melee', {
      kx: (dx / len) * k,
      kz: (dz / len) * k,
      ky: COMBAT.knockUp + (smash ? 3 : 0),
      from: { x: ent.x, z: ent.z },
      axe: kind === 'axe',
      crit,
    })
    if (smash) {
      // The mace lands: you bounce (no fall damage), everyone near is thrown.
      ent.peakY = ent.y
      ent.wasAir = false
      ent.noFallUntil = now + 1500
      this.knock(ent, 0, 7, 0)
      this.toArena(arena, 'smash', { x: target.x, y: target.y, z: target.z, big: smash > 10 })
      for (const o of this.ents.values()) {
        if (o === ent || o === target || o.arena !== arena.key || !o.alive || o.zone !== 'match') continue
        const ox = o.x - target.x
        const oz = o.z - target.z
        const d = Math.hypot(ox, oz)
        if (d > 3.5) continue
        this.knock(o, (ox / (d || 1)) * 7, 5, (oz / (d || 1)) * 7)
      }
    }
    return dealt
  }

  /** Holding a shield up (right click with a shield in your hotbar). */
  setBlocking(ent, on) {
    const now = this.now()
    const can = on && ent.zone === 'match' && ent.alive && hasShield(ent) && now >= ent.shieldOffUntil
    if (can === ent.blocking) return
    ent.blocking = can
    ent.blockAt = now
  }

  // --- Using items ---------------------------------------------------------------------------

  onUse(ent, p) {
    if (!this.actArena(ent)) return
    const index = p.hand === 'off' ? OFFHAND : ent.sel
    if (!ent.inv[index]) return
    if (ITEMS[ent.inv[index].id]?.kind === 'bucket') return this.useBucket(ent, index, p)
    const dir = Array.isArray(p.dir) ? p.dir.slice(0, 3).map((v) => num(v)) : [-Math.sin(ent.yaw), 0, -Math.cos(ent.yaw)]
    this.useItem(ent, index, dir, clamp(num(p.charge, 1), 0, 1))
  }

  /** Uses the item in `slot`: eat, drink, shoot, throw, lunge. Returns true if something happened. */
  useItem(ent, slotIndex, dir, charge = 1) {
    const arena = this.actArena(ent)
    if (!arena) return false
    const now = this.now()
    const slot = ent.inv[slotIndex]
    const item = slot && ITEMS[slot.id]
    if (!item) return false
    if (item.kind === 'spear') return this.lunge(ent, item, dir)
    const gap = USE_GAP[item.kind] ?? 220
    if (now - ent.lastUseAt < gap) return false
    ent.lastUseAt = now
    switch (item.kind) {
      case 'food':
        ent.hp = Math.min(ent.maxHp, ent.hp + (item.heal || 0))
        if (item.absorb) ent.absorb = Math.max(ent.absorb, item.absorb)
        if (item.regen) ent.effects.regen = now + item.regen * 1000
        if (item.effect) {
          ent.effects[item.effect] = now + item.dur * 1000
          // Leaping: no fall damage until you've had time to land after it wears off.
          if (item.effect === 'leap') ent.noFallUntil = Math.max(ent.noFallUntil || 0, now + item.dur * 1000 + 4000)
        }
        break
      case 'potion':
        if (item.heal) ent.hp = Math.min(ent.maxHp, ent.hp + item.heal)
        if (item.effect) ent.effects[item.effect] = now + item.dur * 1000
        break
      case 'bow': {
        const c = Math.max(0.25, charge)
        this.shoot(arena, ent, 'arrow', dir, PROJECTILES.arrow.speed * (0.45 + 0.55 * c), Math.round(2 + (item.dmg - 2) * c), 3.5 * c, slot.id)
        break
      }
      case 'throw':
      case 'splash':
        this.shoot(arena, ent, item.proj, dir, PROJECTILES[item.proj].speed, item.dmg || 0, 0, slot.id)
        break
      default:
        return false
    }
    this.take(ent, slotIndex, 1)
    ent.dirty = true
    if (ent.cid) this.sendTo(ent.cid, 'used', { item: slot.id })
    this.toWatchers(ent, 'act', { eid: ent.eid, kind: item.kind, item: slot.id })
    return true
  }

  /** Spear lunge: a dash the way you look; the next hit soon after is boosted. */
  lunge(ent, item, dir) {
    const now = this.now()
    if (now - ent.lungeAt < item.lungeCd * 0.85) return false
    ent.lungeAt = now
    ent.lungeUntil = now + COMBAT.lungeHitMs
    const len = Math.hypot(dir[0], dir[2]) || 1
    const fx = (dir[0] / len) * COMBAT.lungeSpeed
    const fz = (dir[2] / len) * COMBAT.lungeSpeed
    if (ent.bot && ent.body) {
      ent.body.pushX += fx
      ent.body.pushZ += fz
      ent.body.vy = Math.max(ent.body.vy, COMBAT.lungeLift)
      ent.body.onGround = false
    } else {
      // The client already dashed: just let the move through.
      ent.tpGrace = Math.max(ent.tpGrace, now + 900)
      resetMoveState(ent.mv, ent.y, now)
    }
    this.toWatchers(ent, 'act', { eid: ent.eid, kind: 'lunge' })
    return true
  }

  /** Sends to everyone who can see `ent` in its arena (fighters and spectators), but not `ent`. */
  toWatchers(ent, type, payload) {
    const arena = this.arenas.get(ent.arena)
    if (arena) this.toArena(arena, type, payload, ent.cid)
  }

  // --- Projectiles ----------------------------------------------------------------------

  shoot(arena, ent, kind, dir, speed, dmg, knock, item = null) {
    if (arena.projs.length > 64) return
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const e = this.eye(ent)
    const p = {
      id: arena.nextProj++,
      kind,
      item,
      owner: ent.eid,
      x: e.x + (dir[0] / len) * 0.4,
      y: e.y - 0.1 + (dir[1] / len) * 0.4,
      z: e.z + (dir[2] / len) * 0.4,
      vx: (dir[0] / len) * speed,
      vy: (dir[1] / len) * speed,
      vz: (dir[2] / len) * speed,
      age: 0,
      dmg,
      knock,
      fire: Boolean(ITEMS[item]?.fire),
    }
    arena.projs.push(p)
    this.toArena(arena, 'proj', { id: p.id, kind, owner: p.owner, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, fire: p.fire ? 1 : 0 })
  }

  tickProjectiles(arena, dt) {
    const w = arena.world
    for (let i = arena.projs.length - 1; i >= 0; i -= 1) {
      const p = arena.projs[i]
      const spec = PROJECTILES[p.kind]
      p.age += dt
      p.vy -= spec.gravity * dt
      const sx = p.vx * dt
      const sy = p.vy * dt
      const sz = p.vz * dt
      const segLen = Math.hypot(sx, sy, sz) || 1e-6
      let best = null
      const hit = raycastVoxels(w, p.x, p.y, p.z, sx, sy, sz, segLen, isSolidBlock)
      if (hit) best = { t: hit.dist, block: hit }
      const s = spec.size / 2
      for (const e of this.ents.values()) {
        if (e.arena !== arena.key || e.zone !== 'match' || !e.alive || (e.eid === p.owner && p.age < 0.25)) continue
        const t = rayBox(
          p.x, p.y, p.z, sx / segLen, sy / segLen, sz / segLen,
          e.x - PLAYER.halfW - s, e.y - s, e.z - PLAYER.halfW - s,
          e.x + PLAYER.halfW + s, e.y + PLAYER.height + s, e.z + PLAYER.halfW + s,
        )
        if (t >= 0 && t <= segLen && (!best || t < best.t)) best = { t, ent: e }
      }
      if (best || p.age > spec.life || p.y < -10) {
        const t = best ? best.t : segLen
        const hx = p.x + (sx / segLen) * t
        const hy = p.y + (sy / segLen) * t
        const hz = p.z + (sz / segLen) * t
        arena.projs.splice(i, 1)
        this.toArena(arena, 'projEnd', { id: p.id, x: hx, y: hy, z: hz })
        this.projectileLands(arena, p, best, hx, hy, hz)
        continue
      }
      p.x += sx
      p.y += sy
      p.z += sz
    }
  }

  projectileLands(arena, p, best, hx, hy, hz) {
    const owner = this.ents.get(p.owner)
    if (p.kind === 'arrow') {
      if (best?.ent) {
        const len = Math.hypot(p.vx, p.vz) || 1
        const k = p.knock + 2.5
        const dealt = this.damage(best.ent, p.dmg, p.owner, 'arrow', { kx: (p.vx / len) * k, kz: (p.vz / len) * k, ky: 3.5, from: { x: hx - p.vx, z: hz - p.vz } })
        // A fire arrow sets whoever it hits alight (not through a raised shield).
        if (p.fire && dealt && best.ent.alive && !inWater(arena.world, best.ent.x, best.ent.y, best.ent.z)) {
          best.ent.effects.burn = this.now() + FIRE.burnMs
          best.ent.burnBy = p.owner
          best.ent.dirty = true
        }
      }
      if (p.fire) {
        // Where it stuck (just outside the block it hit), or at the feet of whoever it hit.
        const b = best?.block
        if (b) this.igniteAt(arena, b.x + 0.5 + b.nx * 0.6, b.y + (b.ny === 1 ? 1 : b.ny === -1 ? -1 : 0.1), b.z + 0.5 + b.nz * 0.6, p.owner)
        else if (best?.ent) this.igniteAt(arena, best.ent.x, best.ent.y, best.ent.z, p.owner)
      }
      return
    }
    if (p.kind === 'pearl') {
      if (!owner?.alive || owner.arena !== arena.key) return
      let tx = hx
      let ty = hy
      let tz = hz
      if (best?.block) {
        const b = best.block
        tx = b.x + 0.5 + b.nx * 0.8
        tz = b.z + 0.5 + b.nz * 0.8
        ty = b.ny === 1 ? b.y + 1 : b.ny === -1 ? b.y - 2 : b.y
      }
      if (best || ty > -5) {
        this.teleport(owner, clamp(tx, 0.5, arena.world.sx - 0.5), ty, clamp(tz, 0.5, arena.world.sz - 0.5))
        owner.peakY = ty
        this.damage(owner, 2, null, 'pearl', { pierce: true, iframes: false })
      }
      return
    }
    if (p.kind === 'gust') {
      if (best?.ent) this.damage(best.ent, 1, p.owner, 'gust', { from: { x: hx - p.vx, z: hz - p.vz } })
      this.gustBurst(arena, hx, hy, hz, p.owner)
      return
    }
    if (p.kind === 'splash') {
      const item = ITEMS[p.item] || ITEMS.splash_heal
      this.toArena(arena, 'splash', { x: hx, y: hy, z: hz, color: item.color || '#ff4f6d' })
      for (const e of this.ents.values()) {
        if (e.arena !== arena.key || e.zone !== 'match' || !e.alive) continue
        const d = Math.hypot(e.x - hx, e.y + 0.9 - hy, e.z - hz)
        if (d > SPLASH.radius + 0.6) continue
        const heal = Math.round((item.heal || 0) * (1 - (d / (SPLASH.radius + 0.6)) * 0.5))
        if (heal > 0) {
          e.hp = Math.min(e.maxHp, e.hp + heal)
          e.dirty = true
        }
      }
    }
  }

  /** A gust charge bursts: everyone near is thrown away and up; whoever threw it, way up. */
  gustBurst(arena, x, y, z, ownerEid) {
    const now = this.now()
    this.toArena(arena, 'gust', { x, y, z })
    for (const e of this.ents.values()) {
      if (e.arena !== arena.key || e.zone !== 'match' || !e.alive) continue
      const dx = e.x - x
      const dy = e.y + 0.9 - y
      const dz = e.z - z
      const d = Math.hypot(dx, dy, dz)
      if (d > GUST.radius + 0.9) continue
      const f = 1 - d / (GUST.radius + 0.9)
      const len = Math.hypot(dx, dz) || 1
      e.noFallUntil = now + 5000
      if (e.eid === ownerEid) this.knock(e, (dx / len) * 2 * f, GUST.selfLift * (0.6 + 0.4 * f), (dz / len) * 2 * f)
      else this.knock(e, (dx / len) * GUST.push * f, GUST.lift * (0.5 + 0.5 * f), (dz / len) * GUST.push * f)
    }
  }

  // --- Health ---------------------------------------------------------------------------

  /**
   * Hurts `target`. `o`: `{ kx, ky, kz }` knockback, `from: {x, z}` where it came from
   * (shields block from the front), `pierce` (ignores armour), `iframes` (false: ignores
   * and doesn't start the no-damage window), `axe` (knocks a shield down), `crit`.
   * Returns the damage dealt.
   */
  damage(target, amount, byEid, how, o = {}) {
    if (!target.alive) return 0
    const arena = this.arenas.get(target.arena)
    if (!arena || arena.phase !== 'fight') return 0
    const now = this.now()
    const useIframes = o.iframes !== false
    if (useIframes && now < target.hurtUntil) return 0
    const attacker = byEid ? this.ents.get(byEid) : null

    // The shield: from the front, it takes the whole hit.
    if (o.from && target.blocking && now - target.blockAt >= COMBAT.shieldWindupMs && now >= target.shieldOffUntil && hasShield(target)) {
      const fx = -Math.sin(target.yaw)
      const fz = -Math.cos(target.yaw)
      const sx = o.from.x - target.x
      const sz = o.from.z - target.z
      const sl = Math.hypot(sx, sz) || 1
      if ((fx * sx + fz * sz) / sl > 0.1) {
        if (o.axe) {
          target.shieldOffUntil = now + COMBAT.shieldOffMs
          target.blocking = false
          target.dirty = true
          this.toArena(arena, 'shieldOff', { eid: target.eid })
        } else this.toArena(arena, 'blocked', { eid: target.eid, by: byEid || 0 })
        if (o.kx || o.kz) this.knock(target, (o.kx || 0) * 0.35, 0, (o.kz || 0) * 0.35)
        if (useIframes) target.hurtUntil = now + 200
        return 0
      }
    }

    let dmg = amount
    if (!o.pierce) {
      const set = ARMOR[target.armor?.tier] || ARMOR.none
      let points = 0
      set.points.forEach((pt, i) => {
        if (target.armor.dura[i] > 0) points += pt
      })
      dmg = armorReduce(amount, points, set.tough)
      // Every piece wears down; a broken one stops protecting.
      const wear = Math.max(1, Math.floor(amount / 4))
      target.armor.dura = target.armor.dura.map((d, i) => {
        if (d <= 0) return 0
        const left = Math.max(0, d - wear)
        if (left === 0 && target.cid) this.sendTo(target.cid, 'toast', { text: `Your ${['helmet', 'chestplate', 'leggings', 'boots'][i]} broke!`, kind: 'error' })
        return left
      })
    }
    dmg = round1(dmg)
    const landed = dmg
    if (target.absorb > 0) {
      const soak = Math.min(target.absorb, dmg)
      target.absorb = round1(target.absorb - soak)
      dmg = round1(dmg - soak)
    }
    target.hp = round1(target.hp - dmg)
    target.lastHurtAt = now
    if (useIframes) target.hurtUntil = now + COMBAT.iframesMs
    target.dirty = true
    if (attacker && attacker !== target) {
      target.lastHitBy = { eid: byEid, at: now }
      const st = attacker.stats
      st.hits += 1
      st.dealt = round1(st.dealt + landed)
      st.combo += 1
      st.best = Math.max(st.best, st.combo)
      attacker.dirty = true
    }
    target.stats.taken += 1
    target.stats.dmgTaken = round1(target.stats.dmgTaken + landed)
    target.stats.combo = 0
    this.toArena(arena, 'hurt', { eid: target.eid, by: byEid || 0, how, dmg: landed, crit: Boolean(o.crit) })
    if (o.kx || o.kz || o.ky) {
      const res = (ARMOR[target.armor?.tier] || ARMOR.none).kbRes
      this.knock(target, (o.kx || 0) * (1 - res), o.ky || 0, (o.kz || 0) * (1 - res))
    }
    if (target.hp <= 0) {
      let charm = -1
      if (how !== 'void') {
        if (target.inv[OFFHAND]?.id === 'charm') charm = OFFHAND
        else charm = target.inv.findIndex((s, i) => i < HOTBAR && s?.id === 'charm')
      }
      if (charm >= 0) {
        // The revive charm: one heart, a shield of absorption, regeneration.
        this.take(target, charm, 1)
        target.hp = 2
        target.absorb = Math.max(target.absorb, 4)
        target.effects.regen = now + 8000
        target.dirty = true
        this.toArena(arena, 'charm', { eid: target.eid, x: target.x, y: target.y, z: target.z })
      } else {
        const killer = attacker && attacker !== target ? attacker : target.lastHitBy && now - target.lastHitBy.at < 10000 ? this.ents.get(target.lastHitBy.eid) : null
        this.kill(arena, target, killer, how)
      }
    }
    return dmg
  }

  knock(target, x, y, z) {
    if (target.bot && target.body) {
      target.body.pushX += x
      target.body.pushZ += z
      target.body.vy = Math.max(target.body.vy, y)
      target.body.onGround = false
    } else if (target.cid) {
      this.sendTo(target.cid, 'kb', { x, y, z })
      target.tpGrace = Math.max(target.tpGrace, this.now() + 900)
    }
  }

  kill(arena, target, killer, how) {
    if (!target.alive) return
    target.alive = false
    target.hp = 0
    target.blocking = false
    target.dirty = true
    // The killer's kill effect bursts where the victim stood.
    if (killer && killer !== target && killer.cape && killer.cape !== 'none') this.toArena(arena, 'kfx', { x: target.x, y: target.y, z: target.z, fx: killer.cape })
    if (killer && killer !== target && killer.arena === arena.key) {
      killer.kills += 1
      killer.lifeKills += 1
      killer.dirty = true
      if (arena.kind === 'ffa') {
        // Ending a streak claims the bounty on it; starting one puts a bounty up.
        if (target.lifeKills >= BOUNTY_STREAK) {
          killer.bounties = (killer.bounties || 0) + 1
          this.toArena(arena, 'toast', { text: `${killer.name} claimed ${target.name}'s bounty!`, kind: 'success' })
        }
        if (killer.lifeKills === BOUNTY_STREAK || killer.lifeKills === 5 || killer.lifeKills === 10) {
          this.toArena(arena, 'toast', { text: `${killer.name} is on a ${killer.lifeKills} kill streak - bounty is up!`, kind: 'error' })
        }
        this.rosterDirty = true
      }
      if (arena.kind === 'ffa' && killer.alive) {
        killer.hp = Math.min(killer.maxHp, killer.hp + FFA.killHeal)
        if (killer.cid) this.sendTo(killer.cid, 'killed', { name: target.name, cash: !killer.bot })
      } else if (killer.cid) this.sendTo(killer.cid, 'killed', { name: target.name, cash: false })
    }
    this.toArena(arena, 'feed', { k: killer?.name || '', v: target.name, how })
    this.rosterDirty = true
    this.phaseDirty = true
    if (arena.kind === 'duel') {
      if (target.cid) {
        target.zone = 'spec'
        this.sendTo(target.cid, 'dead', { by: killer?.name || '', how, kind: 'duel' })
      }
      const winner = arena.fighters.map((eid) => this.ents.get(eid)).find((e) => e && e !== target)
      this.roundOver(arena, winner || null, 'kill')
    } else {
      target.needKit = true
      if (target.cid) {
        target.zone = 'spec'
        this.sendTo(target.cid, 'dead', { by: killer?.name || '', how, kind: 'ffa' })
        this.reward(target, { kind: 'ffa', mode: target.kit, win: false, kills: target.lifeKills, hits: target.stats.hits, bestCombo: target.stats.best, bounties: target.bounties || 0 })
      } else if (target.bot) {
        target.respawnAt = this.now() + FFA.botRespawnMs
      }
      this.track('ffa_death', { how, byBot: Boolean(killer?.bot), kit: target.kit, bot: Boolean(target.bot) })
    }
  }

  /** A duel or a Spirelands life is over for `ent`: cash, XP, quest progress. */
  reward(ent, result) {
    if (!ent.cid) return
    this.onReward(ent.cid, result)
  }

  /** An analytics event; never lets a failing sink break the game. */
  track(type, data) {
    try {
      this.onAnalytics(type, data)
    } catch {
      // Analytics are best effort.
    }
  }

  // --- Inventory --------------------------------------------------------------------------

  take(ent, slotIndex, n) {
    const slot = ent.inv[slotIndex]
    if (!slot) return
    slot.n -= n
    if (slot.n <= 0) ent.inv[slotIndex] = null
    ent.dirty = true
  }

  // --- World ------------------------------------------------------------------------------

  setBlock(arena, x, y, z, id, restoring = false, fromWater = false) {
    const before = arena.world.get(x, y, z)
    if (!arena.world.set(x, y, z, id)) return
    // A change by water itself wakes its own neighbours; any other change next to water
    // (digging beside the sea, pouring a bucket, a block placed in a stream) lets it move.
    if (!fromWater) {
      const w = arena.world
      if (isWater(id) || isWater(before) || NEIGHBOURS.some(([dx, dy, dz]) => isWater(w.get(x + dx, y + dy, z + dz)))) this.wakeWater(arena, x, y, z)
    }
    const key = blockKey(x, y, z)
    if (id === B.AIR) arena.placed.delete(key)
    // Where the campfires are (for their warmth).
    if (id === B.CAMPFIRE) (arena.campfires ||= new Set()).add(key)
    else if (before === B.CAMPFIRE) arena.campfires?.delete(key)
    arena.edits.set(key, id)
    arena.pending.push(x, y, z, id)
    if (arena.kind === 'ffa' && !restoring && !arena.orig.has(key)) {
      arena.orig.set(key, before)
      arena.restore.push({ key, at: this.now() + FFA.restoreMs })
    }
  }

  /** The client guessed wrong: put its copy of the block back. */
  reject(ent, x, y, z) {
    const arena = this.arenas.get(ent.arena)
    if (!ent.cid || !arena?.world) return
    if (!arena.world.inBounds(x, y, z)) return
    this.sendTo(ent.cid, 'edits', { e: [x, y, z, arena.world.get(x, y, z)] })
    ent.dirty = true
  }

  /** A move that couldn't have happened: put them back where they last were. */
  correct(ent, why) {
    const now = this.now()
    const mv = ent.mv
    mv.strikes = now - mv.strikeAt < 60_000 ? mv.strikes + 1 : 1
    mv.strikeAt = now
    if (mv.strikes === 20) this.log(`movement: ${ent.name} corrected 20 times in a minute (${why})`)
    ent.posAt = now
    ent.awaitTp = { x: ent.x, y: ent.y, z: ent.z, until: now + CORRECTION_MS }
    resetMoveState(mv, ent.y, now)
    if (ent.cid) this.sendTo(ent.cid, 'tp', { x: ent.x, y: ent.y, z: ent.z, yaw: null, zone: ent.zone })
  }

  teleport(ent, x, y, z, yaw) {
    ent.x = x
    ent.y = y
    ent.z = z
    ent.peakY = y
    ent.wasAir = false
    if (yaw !== undefined) ent.yaw = yaw
    ent.posAt = this.now()
    ent.tpGrace = this.now() + 1200
    ent.awaitTp = null
    if (ent.mv) resetMoveState(ent.mv, y, this.now())
    if (ent.body) {
      ent.body.x = x
      ent.body.y = y
      ent.body.z = z
      ent.body.vx = ent.body.vy = ent.body.vz = 0
      ent.body.pushX = ent.body.pushZ = 0
    }
    if (ent.cid) this.sendTo(ent.cid, 'tp', { x, y, z, yaw: yaw ?? null, zone: ent.zone })
  }

  /** Tells a player about the world they're entering (and every change to it so far). */
  sendMatch(ent, arena) {
    if (!ent.cid || !arena.world) return
    ent.lastWorld = arena.key
    const edits = []
    for (const [key, id] of arena.edits) edits.push(key, id)
    this.sendTo(ent.cid, 'match', { kind: arena.kind, map: arena.mapId, seed: arena.seed, mode: arena.mode, edits })
  }

  toLobby(ent, announce = true) {
    ent.zone = 'lobby'
    ent.arena = null
    ent.alive = false
    ent.needKit = false
    ent.lastWorld = null
    ent.hp = HP
    ent.maxHp = HP
    ent.absorb = 0
    ent.inv = new Array(INV_SIZE).fill(null)
    ent.armor = { tier: 'none', dura: [0, 0, 0, 0] }
    ent.effects = {}
    ent.blocking = false
    ent.team = -1
    ent.dirty = true
    const s = this.lobby.spawn
    const a = this.random() * Math.PI * 2
    const r = this.random() * 5
    this.teleport(ent, s.x + Math.cos(a) * r, s.y, s.z + Math.sin(a) * r, 0)
    if (announce && ent.cid) this.sendTo(ent.cid, 'lobby', {})
  }

  // --- Sending ----------------------------------------------------------------------------

  /** To everyone in `zone` (and in `arenaKey`, unless null). */
  toZone(zone, arenaKey, type, payload, exceptCid = null) {
    for (const ent of this.ents.values()) {
      if (ent.cid && ent.zone === zone && (arenaKey === null || ent.arena === arenaKey) && ent.cid !== exceptCid) this.sendTo(ent.cid, type, payload)
    }
  }

  /** To everyone in an arena's world: fighters and spectators. */
  toArena(arena, type, payload, exceptCid = null) {
    if (!arena) return
    for (const ent of this.ents.values()) {
      if (ent.cid && ent.arena === arena.key && (ent.zone === 'match' || ent.zone === 'spec') && ent.cid !== exceptCid) this.sendTo(ent.cid, type, payload)
    }
  }

  phaseFor(member, ent, now, lobbyInfo) {
    const arena = this.arenas.get(member.duel || ent.arena)
    if (arena?.kind === 'duel') {
      const base = {
        kind: 'duel',
        phase: arena.phase,
        left: Math.max(0, arena.phaseEnds - now),
        mode: arena.mode,
        map: arena.mapId,
        round: arena.round,
        ft: MODES[arena.mode].ft,
        score: this.scoreList(arena),
        roundWinner: arena.roundWinner,
        winner: arena.winner ?? null,
      }
      if (arena.phase === 'vote') {
        const votes = Object.fromEntries(arena.mapOptions.map((id) => [id, 0]))
        for (const v of arena.votes.values()) votes[v] += 1
        return { ...base, mapOptions: arena.mapOptions, mapVotes: votes, myMapVote: arena.votes.get(ent.eid) || null }
      }
      return base
    }
    if (arena?.kind === 'ffa') {
      let alive = 0
      for (const e of this.ents.values()) if (e.arena === 'ffa' && e.alive) alive += 1
      return {
        kind: 'ffa',
        phase: 'fight',
        left: 0,
        mode: ent.kit,
        map: 'spirelands',
        alive,
        needKit: !ent.alive,
        queue: member.queue,
        queuedMs: member.queue ? now - member.queuedAt : 0,
        searching: lobbyInfo.searching,
      }
    }
    return { kind: 'lobby', phase: 'lobby', left: 0, queue: member.queue, queuedMs: member.queue ? now - member.queuedAt : 0, ...lobbyInfo }
  }

  flush(dt, now) {
    for (const arena of this.arenas.values()) {
      if (arena.pending.length) {
        this.toArena(arena, 'edits', { e: arena.pending })
        arena.pending = []
      }
    }
    if (this.phaseDirty || now - this.phaseSentAt > 1000) {
      this.phaseDirty = false
      this.phaseSentAt = now
      const searching = Object.fromEntries(MODE_IDS.map((id) => [id, 0]))
      const playing = Object.fromEntries(MODE_IDS.map((id) => [id, 0]))
      let ffa = 0
      for (const m of this.members.values()) {
        if (m.queue) searching[m.queue] += 1
        const a = this.arenas.get(m.duel)
        if (a) playing[a.mode] += 1
        const e = this.ents.get(m.eid)
        if (e?.arena === 'ffa') ffa += 1
      }
      const lobbyInfo = { searching, playing, ffa, online: this.members.size }
      for (const member of this.members.values()) {
        const ent = this.ents.get(member.eid)
        if (ent) this.sendTo(member.cid, 'phase', this.phaseFor(member, ent, now, lobbyInfo))
      }
    }
    // Who's here. Names and avatar looks go out only when they change (someone joins,
    // leaves, dresses up): with a full server that list is tens of KB. Kills, deaths and
    // respawns send just the small state below - and no more than five times a second.
    if (this.rosterDirty && now - (this.rosterAt || 0) >= ROSTER_GAP_MS) {
      this.rosterDirty = false
      this.rosterAt = now
      const list = []
      const state = []
      let sig = ''
      for (const e of this.ents.values()) {
        if (e.zone === 'limbo') continue
        const streak = e.alive && e.arena === 'ffa' ? e.lifeKills : 0
        const armor = e.zone === 'match' ? e.armor.tier : 'none'
        const team = e.team ?? -1
        list.push({
          eid: e.eid,
          name: e.name,
          bot: e.bot,
          cape: e.cape,
          sword: e.sword,
          level: e.level || 1,
          vip: Boolean(e.vip),
          look: e.look || '',
          team,
          zone: e.zone,
          arena: e.arena,
          alive: e.alive,
          kills: e.kills,
          streak,
          armor,
        })
        sig += `${e.eid}|${e.name}|${e.bot ? 1 : 0}|${e.cape}|${e.sword}|${e.level || 1}|${e.vip ? 1 : 0}|${e.look || ''}\n`
        state.push(e.eid, e.zone, e.arena || '', e.alive ? 1 : 0, e.kills || 0, streak || 0, armor, team)
      }
      if (sig !== this.rosterSig) {
        this.rosterSig = sig
        for (const member of this.members.values()) this.sendTo(member.cid, 'roster', { list })
      } else {
        for (const member of this.members.values()) this.sendTo(member.cid, 'rstate', { s: state })
      }
    }
    for (const ent of this.ents.values()) {
      if (!ent.dirty || !ent.cid) continue
      ent.dirty = false
      const effects = {}
      for (const [k, v] of Object.entries(ent.effects)) if (v > now) effects[k] = v - now
      this.sendTo(ent.cid, 'me', {
        hp: ent.hp,
        maxHp: ent.maxHp,
        absorb: ent.absorb,
        inv: ent.inv,
        sel: ent.sel,
        effects,
        alive: ent.alive,
        zone: ent.zone,
        kills: ent.kills,
        armor: ent.armor,
        kit: ent.kit,
        stats: ent.stats,
        shieldOff: Math.max(0, ent.shieldOffUntil - now),
        air: ent.airBubbles ?? AIR.bubbles,
      })
    }
    // Positions: 20 Hz in arenas, 10 Hz in the lobby.
    this.snapAcc += 1
    const lists = new Map()
    const lobbyTick = this.snapAcc % 2 === 0
    for (const e of this.ents.values()) {
      let key = null
      if (e.zone === 'lobby') key = lobbyTick ? 'lobby' : null
      else if (e.zone === 'match' && e.alive) key = e.arena
      if (!key) continue
      if (!lists.has(key)) lists.set(key, [])
      const held = ITEM_IDS.indexOf(e.zone === 'lobby' ? LOBBY_SWORD : e.inv[e.sel]?.id || 'fist')
      const off = e.zone === 'lobby' ? 0 : ITEM_IDS.indexOf(e.inv[OFFHAND]?.id || 'fist')
      // 16 = on fire (everyone sees the flames).
      const anim = (e.blocking ? 5 : e.anim) | (e.effects.burn > now ? 16 : 0)
      lists.get(key).push(e.eid, Math.round(e.x * 100), Math.round(e.y * 100), Math.round(e.z * 100), Math.round(e.yaw * 100), Math.round(e.pitch * 100), anim, held, off)
    }
    for (const e of this.ents.values()) {
      if (!e.cid) continue
      if (e.zone === 'lobby') {
        if (lobbyTick) this.sendTo(e.cid, 'snap', { z: 'lobby', e: lists.get('lobby') || [] })
      } else if (e.arena === 'ffa') {
        // Spirelands is big and holds everyone: only the players within sight of you
        // (past SNAP_RANGE they'd be specks anyway). Less to send, less to draw.
        this.sendTo(e.cid, 'snap', { z: 'match', e: nearOnly(lists.get('ffa') || [], e.x, e.z) })
      } else if (e.arena) {
        this.sendTo(e.cid, 'snap', { z: 'match', e: lists.get(e.arena) || [] })
      }
    }
  }

  static get SIM_HZ() {
    return SIM_HZ
  }
}

function freshStats() {
  return { hits: 0, taken: 0, dealt: 0, dmgTaken: 0, combo: 0, best: 0 }
}

/** A shield in a hand: the offhand, or the slot you hold. */
function hasShield(ent) {
  return ent.inv[OFFHAND]?.id === 'shield' || ent.inv[ent.sel]?.id === 'shield'
}
