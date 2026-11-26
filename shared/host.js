import {
  ATTACK_COOLDOWN_MS,
  BOT_LEVEL_IDS,
  BOT_LEVELS,
  BOT_NAMES,
  breakSeconds,
  EFFECTS,
  QUICK_CHAT,
  QUICK_CHAT_MS,
  HOTBAR,
  ITEMS,
  LAVA,
  lavaHeight,
  LOBBY_SWORD,
  MAP_CHOICES,
  LUCKY_BONUS_BLOCKS,
  MELEE_REACH,
  MODE_IDS,
  MODES,
  PROJECTILES,
  TEAMS,
  REACH,
  ROUND,
  rollLucky,
  TNT,
} from './balance.js'
import { createBrain, thinkBot } from './bots.js'
import { generateLobby, generateMatch, ISLAND_TOP, MAP_IDS, MATCH_SIZE } from './maps.js'
import { checkMove, createMoveState, resetMoveState } from './movecheck.js'
import { cellOverlapsBody, createBody, PLAYER } from './physics.js'
import { B, BLOCKS, blockKey, isLucky, isSolidBlock, raycastVoxels, rayBox } from './voxel.js'

/**
 * The game's authority for one room: the lobby, the vote, and each round from the cages
 * to the winner. Runs inside the Colyseus room on the server, and inside the offline
 * stand-in in the browser, so the game plays the same either way.
 *
 * Players report where they are (movement is theirs, checked for speed); everything
 * else - breaking and placing blocks, what lucky blocks give, hits, health, the lava,
 * bots - is decided here and sent out as small messages:
 *
 * - `snap`   ~20 Hz: everyone's position in your zone
 * - `roster` who is here (names, capes, alive, kills)
 * - `phase`  round phase, time left, votes, lava
 * - `match`  the round's map and seed (+ edits so far), when you enter it
 * - `edits`  block changes `[x, y, z, id, ...]`
 * - `me`     your health, hotbar and effects
 * - one-off events: `hurt`, `kb`, `tp`, `loot`, `pop`, `feed`, `proj`, `projEnd`,
 *   `boom`, `tnt`, `bolt`, `swing`, `dead`, `win`, `toast`
 */

import { ANIMS, ITEM_IDS } from './protocol.js'

export { ANIMS, ITEM_IDS }
const SIM_HZ = 20
/** Right after knockback or a teleport: a loose cap only (blocks/s, plus slack). */
const MAX_SPEED = 16
const MOVE_SLACK = 3
/** A rejected move: positions are ignored until the client takes the correction. */
const CORRECTION_MS = 1500
/** Allowance on reach checks for network lag. */
const REACH_SLACK = 1.6
const NATURAL_REGEN_MS = 2500
const REGEN_DELAY_MS = 6000

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export class GameHost {
  /**
   * @param {object} o
   * @param {(cid: string, type: string, payload?: object) => void} o.send
   * @param {(cid: string, result: object) => void} [o.onReward] a player's round is over
   * @param {() => number} [o.now]
   * @param {() => number} [o.random]
   */
  constructor({ send, onReward = () => {}, onAnalytics = () => {}, now = () => Date.now(), random = Math.random, log = (msg) => console.warn(msg) }) {
    this.sendTo = send
    /** Anonymous gameplay events (no names or ids): 'round', 'player_round', 'leave', 'tutorial'. */
    this.onAnalytics = onAnalytics
    this.log = log
    this.onReward = onReward
    this.now = now
    this.random = random
    this.lobby = generateLobby()
    /** cid -> { cid, eid, name, afk, vote } */
    this.members = new Map()
    /** eid -> entity (players and bots) */
    this.ents = new Map()
    this.nextEid = 1
    this.phase = 'waiting'
    this.phaseEnds = 0
    /** The lobby vote's step: 'mode' first (and bots), then 'map' - and then the round. */
    this.voteStage = 'mode'
    this.stageEnds = 0
    this.lockedMode = null
    this.lockedBots = null
    this.match = null
    this.lastMap = null
    /** The maps on offer this round (MAP_CHOICES of them, never the last one played). */
    this.mapOptions = MAP_IDS.slice(0, MAP_CHOICES)
    this.rosterDirty = true
    this.phaseDirty = true
    this.phaseSentAt = 0
    this.snapAcc = 0
  }

  // --- Members ------------------------------------------------------------------------

  join(cid, name, look = {}) {
    const eid = this.nextEid++
    const member = { cid, eid, name, afk: false, vote: null, mapVote: null, botVote: null, joinedAt: this.now(), rounds: 0, tutorial: 0 }
    this.members.set(cid, member)
    const ent = this.makeEnt(eid, name, { cid, cape: look.cape, sword: look.sword, level: look.level || 1, vip: Boolean(look.vip) })
    this.toLobby(ent, false)
    this.ents.set(eid, ent)
    this.sendTo(cid, 'hello', { eid })
    this.rosterDirty = true
    this.phaseDirty = true
    if (this.phase === 'waiting') this.maybeStartIntermission()
    return eid
  }

  leave(cid) {
    const member = this.members.get(cid)
    if (!member) return
    const ent = this.ents.get(member.eid)
    const zone = ent?.zone || 'lobby'
    const phase = this.phase
    if (ent?.zone === 'match' && ent.alive && this.match) {
      this.kill(ent, null, 'left')
    }
    // Where people quit, and after how long (the round they walked out of counts).
    this.track('leave', {
      zone,
      phase,
      sessionMs: this.now() - member.joinedAt,
      rounds: member.rounds,
      tutorial: member.tutorial,
    })
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
      cape: 'none',
      sword: 'classic',
      zone: 'lobby',
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      anim: 0,
      alive: false,
      hp: ROUND.hp,
      maxHp: ROUND.hp,
      inv: new Array(HOTBAR).fill(null),
      sel: 0,
      effects: {},
      kills: 0,
      lastHurtAt: 0,
      lastAttackAt: 0,
      lastUseAt: 0,
      lastLavaAt: 0,
      lastBurnAt: 0,
      lastRegenAt: 0,
      lastHitBy: null,
      dig: null,
      posAt: 0,
      tpGrace: 0,
      mv: createMoveState(),
      awaitTp: null,
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
        // Others see which block you're mining (chips fly off it while you swing).
        if (ent.zone === 'match') this.toWatchers(ent, 'act', { eid: ent.eid, kind: 'dig', x, y, z })
        return
      }
      case 'break':
        return this.onBreak(ent, Math.floor(num(p.x)), Math.floor(num(p.y)), Math.floor(num(p.z)))
      case 'place':
        return this.onPlace(ent, Math.floor(num(p.x)), Math.floor(num(p.y)), Math.floor(num(p.z)))
      case 'attack':
        return this.onAttack(ent, Math.floor(num(p.eid)))
      case 'use':
        return this.onUse(ent, p)
      case 'swing':
        return this.toZone(ent.zone, 'swing', { eid: ent.eid }, ent.cid)
      case 'look':
        return this.onLook(ent, p)
      case 'joinRound':
        return this.joinRound(ent)
      case 'voteBots':
        if (BOT_LEVELS[p.level] && (this.phase === 'waiting' || (this.phase === 'intermission' && this.voteStage !== 'map'))) {
          member.botVote = p.level
          this.phaseDirty = true
        }
        return
      case 'tut': {
        // How far through the tutorial people get (each step counted once per visit).
        const step = Math.floor(num(p.step, 0))
        if (step > member.tutorial && step <= 5) {
          member.tutorial = step
          this.track('tutorial', { step })
        }
        return
      }
      case 'qc': {
        // Quick chat: one of the fixed lines, rate limited, to everyone who can see you.
        const ent = this.entOf(cid)
        const i = Math.floor(num(p.i, -1))
        const now = this.now()
        if (!ent || i < 0 || i >= QUICK_CHAT.length || now - (ent.qcAt || 0) < QUICK_CHAT_MS) return
        ent.qcAt = now
        const msg = { eid: ent.eid, name: ent.name, i, team: ent.team ?? -1 }
        if (ent.zone === 'lobby') this.toZone('lobby', 'qc', msg)
        else this.toMatchViewers('qc', msg)
        return
      }
      case 'voteMap':
        if (this.mapOptions.includes(p.map) && this.phase === 'intermission' && this.voteStage === 'map') {
          member.mapVote = p.map
          this.phaseDirty = true
        }
        return
      case 'vote':
        if (MODES[p.mode] && (this.phase === 'waiting' || (this.phase === 'intermission' && this.voteStage !== 'map'))) {
          member.vote = p.mode
          this.phaseDirty = true
        }
        return
      case 'afk':
        member.afk = Boolean(p.on)
        this.phaseDirty = true
        this.rosterDirty = true
        if (!member.afk) this.maybeStartIntermission()
        return
      case 'spectate':
        if (ent.zone === 'lobby' && this.match && (this.phase === 'cages' || this.phase === 'fight')) {
          ent.zone = 'spec'
          ent.alive = false
          this.sendMatch(ent)
          this.teleport(ent, this.match.middle.x, this.match.middle.y + 14, this.match.middle.z)
          this.rosterDirty = true
        }
        return
      case 'lobby':
        if (ent.zone === 'spec') {
          this.toLobby(ent)
          this.rosterDirty = true
        }
        return
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
      // Boxity's ranges: legOffsetX -0.7 to 5, armLength from 0.05, the rest 0.3 to 2.6.
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
    ent.anim = clamp(Math.floor(num(p.a)), 0, ANIMS.length - 1)
    if (ent.zone === 'match' && ent.alive) {
      // Waiting for the client to take a correction: its stale reports don't count.
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
        // Knockback or a teleport in flight: only a loose cap, and start over from here.
        if (Math.hypot(x - ent.x, z - ent.z) > MAX_SPEED * dt + MOVE_SLACK) bad = 'speed'
        else resetMoveState(ent.mv, y, now)
      } else {
        const fx = ent.effects
        bad = checkMove(this.match.world, ent.mv, ent, { x, y, z }, dt, now, {
          speedMul: fx.speed > now ? EFFECTS.speed.speedMul : 1,
          jumpMul: fx.jump > now ? EFFECTS.jump.jumpMul : 1,
        })
      }
      if (bad) {
        this.correct(ent, bad)
        return
      }
    }
    ent.x = x
    ent.y = y
    ent.z = z
    ent.posAt = now
  }

  // --- Phases ---------------------------------------------------------------------------

  eligibleMembers() {
    return [...this.members.values()].filter((m) => !m.afk && this.ents.get(m.eid)?.zone === 'lobby')
  }

  maybeStartIntermission(ms = ROUND.intermissionMs) {
    if (this.phase !== 'waiting') return
    if (!this.eligibleMembers().length) return
    // The countdown first (shorter if `ms` asks for less), then the two votes.
    const wait = Math.max(0, ms - ROUND.modeVoteMs - ROUND.mapVoteMs)
    this.setPhase('intermission', wait)
    this.voteStage = wait > 0 ? 'wait' : 'mode'
    this.stageEnds = wait > 0 ? this.phaseEnds : this.now() + ROUND.modeVoteMs
    this.phaseEnds = this.stageEnds
    this.lockedMode = null
    this.lockedBots = null
  }

  /** The countdown is over: the mode (and bots) vote opens. */
  openModeVote() {
    this.voteStage = 'mode'
    this.stageEnds = this.now() + ROUND.modeVoteMs
    this.phaseEnds = this.stageEnds
    this.phaseDirty = true
  }

  /** Step one is over: the mode (and bots) are decided, the map vote opens. */
  lockMode() {
    this.lockedMode = this.pickMode()
    this.lockedBots = this.pickBotLevel()
    this.voteStage = 'map'
    this.rollMapOptions()
    for (const m of this.members.values()) m.mapVote = null
    this.stageEnds = this.now() + ROUND.mapVoteMs
    this.phaseEnds = this.stageEnds
    this.phaseDirty = true
  }

  setPhase(phase, ms) {
    this.phase = phase
    this.phaseEnds = this.now() + ms
    this.phaseDirty = true
  }

  tick(dt) {
    const now = this.now()
    if (this.phase === 'intermission') {
      const voters = this.eligibleMembers()
      if (!voters.length) this.setPhase('waiting', 0)
      else {
        // Each step ends when its time is up - or as soon as everyone has voted. Once the
        // map is decided, the round starts.
        if (this.voteStage === 'wait' && now >= this.stageEnds) this.openModeVote()
        else if (this.voteStage === 'mode' && (now >= this.stageEnds || voters.every((m) => m.vote))) this.lockMode()
        else if (this.voteStage === 'map' && (now >= this.stageEnds || voters.every((m) => m.mapVote))) this.startMatch()
      }
    } else if (this.phase === 'cages') {
      if (now >= this.phaseEnds) this.openCages()
    } else if (this.phase === 'fight') {
      this.tickFight(dt, now)
      if (this.phase === 'fight' && now >= this.phaseEnds) this.timeUp()
    } else if (this.phase === 'ended') {
      if (now >= this.phaseEnds) this.backToLobby()
    } else if (this.phase === 'waiting') {
      this.maybeStartIntermission()
    }

    this.flush(dt, now)
  }

  /** The most-voted map on offer (ties broken at random); with no votes, any of them. */
  pickMap() {
    const counts = this.mapVoteCounts()
    const best = Math.max(0, ...Object.values(counts))
    const pool = best ? this.mapOptions.filter((id) => counts[id] === best) : this.mapOptions
    return pool[Math.floor(this.random() * pool.length)]
  }

  /** MAP_CHOICES different maps for the vote, leaving out the one just played. */
  rollMapOptions() {
    const pool = MAP_IDS.filter((id) => id !== this.lastMap)
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    this.mapOptions = pool.slice(0, MAP_CHOICES)
  }

  mapVoteCounts() {
    const counts = Object.fromEntries(this.mapOptions.map((id) => [id, 0]))
    for (const m of this.members.values()) if (m.mapVote && counts[m.mapVote] !== undefined) counts[m.mapVote] += 1
    return counts
  }

  pickMode() {
    const counts = {}
    for (const m of this.members.values()) if (m.vote) counts[m.vote] = (counts[m.vote] || 0) + 1
    const best = Math.max(0, ...Object.values(counts))
    if (!best) return 'classic'
    const top = MODE_IDS.filter((id) => counts[id] === best)
    return top[Math.floor(this.random() * top.length)]
  }

  voteCounts() {
    const counts = Object.fromEntries(MODE_IDS.map((id) => [id, 0]))
    for (const m of this.members.values()) if (m.vote && counts[m.vote] !== undefined) counts[m.vote] += 1
    return counts
  }

  startMatch() {
    const humans = this.eligibleMembers()
    if (!humans.length) {
      this.setPhase('waiting', 0)
      return
    }
    const mode = this.lockedMode || this.pickMode()
    const mapId = this.pickMap()
    let botLevel = this.lockedBots || this.pickBotLevel()
    this.lockedMode = null
    this.lockedBots = null
    this.voteStage = 'mode'
    // A no-bots round needs two people; alone, (Medium) bots join in.
    if (botLevel === 'off' && humans.length < 2) {
      botLevel = 'normal'
      // Only worth saying if someone actually asked for no bots.
      if ([...this.members.values()].some((m) => m.botVote === 'off')) this.toZone('lobby', 'toast', { text: 'No-bots rounds need 2 players - bots join in!' })
    }
    this.lastMap = mapId
    const seed = Math.floor(this.random() * 2 ** 31)
    const gen = generateMatch(mapId, seed, mode)
    let teamCount = MODES[mode].teams || 0
    this.match = {
      mapId,
      seed,
      mode,
      world: gen.world,
      spawns: gen.spawns,
      lucky: gen.lucky,
      middle: gen.middle,
      edits: new Map(),
      pending: [],
      tnts: [],
      projs: [],
      nextProj: 1,
      fightStart: 0,
      fighters: 0,
      lavaY: LAVA.startY,
      humans: humans.length,
      stats: { deaths: {}, byPlayer: 0, firstKillMs: 0, lucky: 0, placed: 0 },
    }
    this.match.botLevel = botLevel
    for (const m of this.members.values()) {
      m.vote = null
      m.mapVote = null
    }

    const fighters = []
    for (const m of humans.slice(0, ROUND.maxFighters)) fighters.push(this.ents.get(m.eid))
    const botCount = botLevel === 'off' ? 0 : clamp(ROUND.minFighters - fighters.length, 0, ROUND.maxFighters - fighters.length)
    const names = [...BOT_NAMES].sort(() => this.random() - 0.5)
    for (let i = 0; i < botCount; i += 1) {
      const eid = this.nextEid++
      const capes = ['none', 'none', 'crimson', 'ocean', 'leaf', 'checker', 'pixel', 'lucky']
      const bot = this.makeEnt(eid, names[i % names.length], {
        bot: true,
        cape: capes[Math.floor(this.random() * capes.length)],
        // A believable level for the nameplate (from the eid, so the rng sequence is untouched).
        level: 2 + ((eid * 7) % 19),
      })
      this.ents.set(eid, bot)
      fighters.push(bot)
    }
    const hpBonus = MODES[mode].hpBonus
    // Fewer fighters than teams (a small no-bots round): fewer teams; one team is solo.
    teamCount = Math.min(teamCount, fighters.length)
    if (teamCount < 2) teamCount = 0
    const seats = this.seatFighters(fighters, teamCount)
    this.match.teamSize = teamCount ? Math.max(...seats.sizes) : 1
    this.match.teams = teamCount
    for (const { ent, island, team, bonus } of seats.list) {
      // In solo everyone is their own team, so "same team" never matches.
      ent.team = team
      ent.rewarded = null
      ent.pendingReward = false
      ent.playedRound = this.match
      const s = gen.spawns[island]
      ent.zone = 'match'
      ent.alive = true
      ent.maxHp = ROUND.hp + hpBonus + bonus
      ent.hp = ent.maxHp
      ent.inv = new Array(HOTBAR).fill(null)
      ent.inv[0] = { id: 'wood_sword', n: 1 }
      ent.sel = 0
      ent.effects = {}
      ent.kills = 0
      ent.lucky = 0
      ent.placed = 0
      ent.diedHow = null
      ent.diedAt = 0
      ent.lastHitBy = null
      ent.lastHurtAt = 0
      ent.dirty = true
      ent.island = island
      ent.yaw = Math.atan2(-(gen.middle.x - s.x), -(gen.middle.z - s.z))
      if (ent.bot) {
        ent.body = createBody(s.x, s.y, s.z)
        ent.brain = createBrain(this.random, this.match.botLevel)
        ent.x = s.x
        ent.y = s.y
        ent.z = s.z
      } else {
        this.sendMatch(ent)
        this.teleport(ent, s.x, s.y, s.z, ent.yaw)
      }
    }
    this.match.fighters = fighters.length
    this.setPhase('cages', ROUND.cagesMs)
    this.rosterDirty = true
  }

  /**
   * Can `ent` (in the lobby, or watching) still join the round in progress? Not if they
   * already played in it, nor late in a fight; there must be a bot to take over or a free
   * island. Returns a reason when not.
   */
  joinBlocked(ent) {
    const m = this.match
    if (!m || (this.phase !== 'cages' && this.phase !== 'fight')) return 'No round to join'
    if (ent.zone === 'match' || ent.playedRound === m) return 'You already played this round'
    if (this.phase === 'fight' && (this.phaseEnds - this.now() < 40_000 || m.lavaY > ISLAND_TOP - 6)) return 'Too late to join this round'
    const bot = [...this.ents.values()].some((e) => e.bot && e.alive && e.zone === 'match')
    if (!bot && this.freeIslands().length === 0) return 'This round is full'
    return null
  }

  /** Islands nobody has fought from this round. */
  freeIslands() {
    const used = new Set()
    for (const e of this.ents.values()) if (e.playedRound === this.match && e.island !== undefined) used.add(e.island)
    return [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !used.has(i))
  }

  /**
   * Joins a round in progress: takes over a bot (their island, health and hotbar, on the
   * team with the fewest people) or, with no bots, starts on a free island.
   */
  joinRound(ent) {
    const why = this.joinBlocked(ent)
    if (why) {
      if (ent.cid) this.sendTo(ent.cid, 'toast', { text: why, kind: 'error' })
      return
    }
    const m = this.match
    const peopleOn = (team) => [...this.ents.values()].filter((e) => !e.bot && e.alive && e.zone === 'match' && e.team === team).length
    const bots = [...this.ents.values()].filter((e) => e.bot && e.alive && e.zone === 'match').sort((a, b) => peopleOn(a.team) - peopleOn(b.team))
    const bot = bots[0]
    if (ent.zone === 'spec') ent.zone = 'lobby'
    ent.alive = true
    ent.zone = 'match'
    ent.playedRound = m
    ent.rewarded = null
    ent.pendingReward = false
    ent.kills = 0
    ent.lucky = 0
    ent.placed = 0
    ent.diedHow = null
    ent.diedAt = 0
    ent.effects = {}
    ent.lastHitBy = null
    ent.lastHurtAt = 0
    ent.dirty = true
    let x
    let y
    let z
    if (bot) {
      Object.assign(ent, { team: bot.team, island: bot.island, hp: bot.hp, maxHp: bot.maxHp, inv: bot.inv.map((s) => (s ? { ...s } : null)), sel: bot.sel, yaw: bot.yaw })
      x = bot.x
      y = bot.y
      z = bot.z
      this.ents.delete(bot.eid)
      this.toMatchViewers('toast', { text: `${ent.name} joined the round (took over ${bot.name})` })
    } else {
      const island = this.freeIslands()[0]
      const teams = m.teams || 0
      if (teams) {
        const alive = Array.from({ length: teams }, (_, t) => this.aliveFighters().filter((e) => e.team === t).length)
        ent.team = alive.indexOf(Math.min(...alive))
      } else {
        ent.team = Math.max(-1, ...[...this.ents.values()].map((e) => (e.playedRound === m ? e.team : -1))) + 1
      }
      ent.island = island
      ent.maxHp = ROUND.hp + (MODES[m.mode].hpBonus || 0)
      ent.hp = ent.maxHp
      ent.inv = new Array(HOTBAR).fill(null)
      ent.inv[0] = { id: 'wood_sword', n: 1 }
      ent.sel = 0
      const s = m.spawns[island]
      x = s.x
      z = s.z
      // In a fight the cages are gone: straight onto the island.
      y = this.phase === 'fight' ? ISLAND_TOP + 1 : s.y
      m.fighters += 1
      this.toMatchViewers('toast', { text: `${ent.name} joined the round!` })
    }
    this.sendMatch(ent)
    this.teleport(ent, x, y, z, ent.yaw)
    this.rosterDirty = true
    this.phaseDirty = true
  }

  /**
   * Who sits where. Solo: islands at random, everyone their own team. Teams: the ring is
   * cut into `teamCount` runs of neighbouring islands (as even as 8 allows: 4+4,
   * 3+3+2, 2+2+2+2); the real players are dealt round the teams first so no team is all
   * bots while another is all people, then bots fill the empty seats. A team short of a
   * member gets extra hearts each. Returns `{ list: [{ ent, island, team, bonus }], sizes }`.
   */
  seatFighters(fighters, teamCount) {
    const n = fighters.length
    if (!teamCount) {
      const islands = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => this.random() - 0.5)
      return { list: fighters.map((ent, i) => ({ ent, island: islands[i % 8], team: i, bonus: 0 })), sizes: [1] }
    }
    const sizes = Array.from({ length: teamCount }, (_, t) => Math.floor(n / teamCount) + (t < n % teamCount ? 1 : 0))
    const biggest = Math.max(...sizes)
    // Each team's islands: a run round the ring from a random start.
    const start = Math.floor(this.random() * 8)
    const runs = []
    let at = 0
    for (const size of sizes) {
      runs.push(Array.from({ length: size }, (_, k) => (start + at + k) % 8))
      at += size
    }
    const teams = sizes.map(() => [])
    const order = sizes.map((_, t) => t).sort(() => this.random() - 0.5)
    const humans = fighters.filter((e) => !e.bot).sort(() => this.random() - 0.5)
    const bots = fighters.filter((e) => e.bot)
    let k = 0
    for (const ent of humans) {
      // The next team in turn that still has a seat.
      for (let tries = 0; tries < teamCount; tries += 1) {
        const t = order[k % teamCount]
        k += 1
        if (teams[t].length < sizes[t]) {
          teams[t].push(ent)
          break
        }
      }
    }
    for (const ent of bots) {
      const t = teams.findIndex((list, i) => list.length < sizes[i])
      teams[t].push(ent)
    }
    const list = []
    teams.forEach((members, t) => {
      members.forEach((ent, i) => list.push({ ent, island: runs[t][i], team: t, bonus: (biggest - sizes[t]) * 4 }))
    })
    return { list, sizes }
  }

  /**
   * The bots the room voted for; with no votes, none. Alone in the room there are always
   * bots: the level voted for, else Medium.
   */
  pickBotLevel() {
    if (this.eligibleMembers().length < 2) {
      const mine = [...this.members.values()].map((m) => m.botVote).find((v) => v && v !== 'off')
      return mine || 'normal'
    }
    const counts = this.botVoteCounts()
    const best = Math.max(0, ...Object.values(counts))
    if (!best) return 'off'
    const top = BOT_LEVEL_IDS.filter((id) => counts[id] === best)
    return top[Math.floor(this.random() * top.length)]
  }

  botVoteCounts() {
    const counts = Object.fromEntries(BOT_LEVEL_IDS.map((id) => [id, 0]))
    for (const m of this.members.values()) if (m.botVote && counts[m.botVote] !== undefined) counts[m.botVote] += 1
    return counts
  }

  /** Tells a player about the round's world (and every change to it so far). */
  sendMatch(ent) {
    const m = this.match
    if (!m || !ent.cid) return
    const edits = []
    for (const [key, id] of m.edits) edits.push(key, id)
    this.sendTo(ent.cid, 'match', { map: m.mapId, seed: m.seed, mode: m.mode, edits })
  }

  openCages() {
    const m = this.match
    for (const s of m.spawns) {
      for (let y = Math.floor(s.y) - 1; y <= Math.floor(s.y) + 3; y += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const x = Math.floor(s.x) + dx
            const z = Math.floor(s.z) + dz
            if (m.world.get(x, y, z) === B.CAGE) this.setBlock(x, y, z, B.AIR)
          }
        }
      }
    }
    m.fightStart = this.now()
    this.setPhase('fight', ROUND.fightMs)
  }

  timeUp() {
    this.match.timeUp = true
    const alive = this.aliveFighters()
    alive.sort((a, b) => b.hp - a.hp || b.kills - a.kills)
    this.endMatch(alive[0] || null)
  }

  /** Teams with someone still standing. */
  aliveTeams() {
    const teams = new Set()
    for (const e of this.ents.values()) if (e.zone === 'match' && e.alive) teams.add(e.team)
    return teams
  }

  aliveFighters() {
    return [...this.ents.values()].filter((e) => e.zone === 'match' && e.alive)
  }

  checkWin(lastDead = null) {
    if (this.phase !== 'fight' && this.phase !== 'cages') return
    const alive = this.aliveFighters()
    // One team (or one player) left - or everyone gone at once in the lava, when the
    // last one to fall wins.
    if (this.aliveTeams().size <= 1) this.endMatch(alive[0] || lastDead)
    else if (!alive.some((e) => !e.bot)) {
      // Every real player is out: the bots don't play on by themselves. The healthiest
      // bot takes the round and everyone heads back for the next one.
      alive.sort((a, b) => b.hp - a.hp || b.kills - a.kills)
      this.endMatch(alive[0])
    }
  }

  endMatch(winner) {
    if (this.phase === 'ended') return
    const m = this.match
    if (m.fightStart) {
      this.track('round', {
        mode: m.mode,
        map: m.mapId,
        botLevel: m.botLevel,
        fighters: m.fighters,
        humans: m.humans,
        durationMs: this.now() - m.fightStart,
        reason: m.timeUp ? 'time' : 'last-standing',
        winnerBot: winner ? Boolean(winner.bot) : null,
        deaths: m.stats.deaths,
        byPlayer: m.stats.byPlayer,
        firstKillMs: m.stats.firstKillMs,
        lucky: m.stats.lucky,
        placed: m.stats.placed,
        lavaY: Math.round(m.lavaY * 10) / 10,
      })
    }
    this.setPhase('ended', ROUND.endMs)
    const teamSize = this.match.teamSize || 1
    const winTeam = winner ? winner.team : null
    // The whole winning team wins, fallen teammates included.
    for (const e of this.ents.values()) {
      if (winner && (e === winner || (teamSize > 1 && e.team === winTeam && (e.zone === 'match' || e.zone === 'spec')))) this.reward(e, 1)
    }
    // Anyone else still standing when time ran out: placed by health.
    const rest = this.aliveFighters()
      .filter((e) => e.team !== winTeam)
      .sort((a, b) => b.hp - a.hp)
    rest.forEach((e, i) => this.reward(e, i + 2))
    const label = teamSize > 1 && winner ? `${TEAMS[winTeam % TEAMS.length].name} Team` : winner?.name || 'Nobody'
    const msg = { eid: winner?.eid ?? 0, name: label, team: teamSize > 1 ? winTeam : -1 }
    this.toZone('match', 'win', msg)
    this.toZone('spec', 'win', msg)
    // Players in the lobby hear about it too.
    this.toZone('lobby', 'toast', { text: `${label} won the round!` })
  }

  backToLobby() {
    for (const ent of [...this.ents.values()]) {
      if (ent.bot) {
        this.ents.delete(ent.eid)
        continue
      }
      if (ent.zone === 'match' || ent.zone === 'spec') this.toLobby(ent)
    }
    this.match = null
    this.rosterDirty = true
    this.phase = 'waiting'
    this.maybeStartIntermission(ROUND.intermissionAfterMs)
    this.phaseDirty = true
  }

  toLobby(ent, announce = true) {
    ent.zone = 'lobby'
    ent.alive = false
    ent.hp = ROUND.hp
    ent.maxHp = ROUND.hp
    ent.inv = new Array(HOTBAR).fill(null)
    ent.effects = {}
    ent.dirty = true
    const s = this.lobby.spawn
    const a = this.random() * Math.PI * 2
    const r = this.random() * 3
    // Facing the plaza (yaw 0 looks toward -z).
    this.teleport(ent, s.x + Math.cos(a) * r, s.y, s.z + Math.sin(a) * r, 0)
    if (announce && ent.cid) this.sendTo(ent.cid, 'lobby', {})
  }

  /** An analytics event; never lets a failing sink break the game. */
  track(type, data) {
    try {
      this.onAnalytics(type, data)
    } catch {
      // Analytics are best effort.
    }
  }

  /** A player's round is over: their cash, kills and (maybe) the win. */
  reward(ent, placement) {
    if (!ent.cid || ent.rewarded === this.match) return
    ent.rewarded = this.match
    const member = this.members.get(ent.cid)
    if (member) member.rounds += 1
    const m = this.match
    this.track('player_round', {
      mode: m.mode,
      map: m.mapId,
      placement,
      win: placement === 1,
      died: ent.diedHow || null,
      byPlayer: Boolean(ent.diedByPlayer),
      survivedMs: m.fightStart ? (ent.diedAt || this.now()) - m.fightStart : 0,
      kills: ent.kills,
      lucky: ent.lucky || 0,
      placed: ent.placed || 0,
      level: ent.level || 1,
    })
    this.onReward(ent.cid, {
      kills: ent.kills,
      lucky: ent.lucky || 0,
      placed: ent.placed || 0,
      placement,
      fighters: this.match.fighters,
      win: placement === 1,
      mode: this.match.mode,
    })
  }

  // --- The fight ------------------------------------------------------------------------

  tickFight(dt, now) {
    const m = this.match
    m.lavaY = lavaHeight(now - m.fightStart, m.mode)
    // Real players can also leave a round without dying (back to the lobby, closing the
    // page): once none are left in it, it's over.
    if (!this.aliveFighters().some((e) => !e.bot)) {
      this.checkWin()
      if (this.phase !== 'fight') return
    }
    for (const ent of this.ents.values()) {
      if (ent.zone !== 'match' || !ent.alive) continue
      if (ent.bot) thinkBot(this, ent, dt, now)
      this.tickStatus(ent, now)
    }
    this.tickProjectiles(dt, now)
    for (let i = m.tnts.length - 1; i >= 0; i -= 1) {
      if (now >= m.tnts[i].at) {
        const t = m.tnts.splice(i, 1)[0]
        this.explode(t.x, t.y, t.z, t.owner)
      }
    }
  }

  tickStatus(ent, now) {
    const m = this.match
    if (!ent.alive) return
    // Lava and the void.
    if (ent.y < -12 || ent.x < -8 || ent.z < -8 || ent.x > MATCH_SIZE.x + 8 || ent.z > MATCH_SIZE.z + 8) {
      this.damage(ent, 999, ent.lastHitBy && now - ent.lastHitBy.at < 10000 ? ent.lastHitBy.eid : null, 'void')
      return
    }
    if (ent.y < m.lavaY - 0.1) {
      if (now - ent.lastLavaAt >= LAVA.tickMs) {
        ent.lastLavaAt = now
        ent.effects.burn = now + 3000
        const by = ent.lastHitBy && now - ent.lastHitBy.at < 10000 ? ent.lastHitBy.eid : null
        this.damage(ent, LAVA.damage, by, 'lava', 0, 0, 7)
        if (!ent.alive) return
      }
    }
    const fx = ent.effects
    if (fx.burn > now && now - ent.lastBurnAt >= 1000) {
      ent.lastBurnAt = now
      this.damage(ent, 1, fx.burnBy || null, 'burn')
      if (!ent.alive) return
    }
    // Healing: a regen effect, or slowly on your own once you've been out of a fight.
    const regen = fx.regen > now
    const interval = regen ? 600 : NATURAL_REGEN_MS
    if (ent.hp < ent.maxHp && (regen || now - ent.lastHurtAt > REGEN_DELAY_MS) && now - ent.lastRegenAt >= interval) {
      ent.lastRegenAt = now
      ent.hp = Math.min(ent.maxHp, ent.hp + 1)
      ent.dirty = true
    }
    for (const k of Object.keys(fx)) {
      if (k !== 'burnBy' && fx[k] && fx[k] <= now) {
        delete fx[k]
        ent.dirty = true
      }
    }
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

  canAct(ent) {
    return this.match && ent.zone === 'match' && ent.alive && this.phase === 'fight'
  }

  onBreak(ent, x, y, z) {
    const m = this.match
    if (!this.canAct(ent)) return this.reject(ent, x, y, z)
    const id = m.world.get(x, y, z)
    const def = BLOCKS[id]
    if (!def || id === B.AIR || !Number.isFinite(def.hard) || !this.inReach(ent, x, y, z)) return this.reject(ent, x, y, z)
    const need = breakSeconds(def.hard, this.heldItem(ent)) * 1000
    const dig = ent.dig
    if (need > 60 && (!dig || dig.key !== blockKey(x, y, z) || this.now() - dig.at < need * 0.7 - 150)) return this.reject(ent, x, y, z)
    ent.dig = null
    this.breakBlock(ent, x, y, z)
  }

  /** Breaks a block for `ent` (already checked) and hands out what it gives. */
  breakBlock(ent, x, y, z) {
    const m = this.match
    const id = m.world.get(x, y, z)
    const def = BLOCKS[id]
    this.setBlock(x, y, z, B.AIR)
    // A flower on top goes with it.
    if (BLOCKS[m.world.get(x, y + 1, z)]?.render === 'cross') this.setBlock(x, y + 1, z, B.AIR)
    if (isLucky(id)) {
      this.openLucky(ent, x, y, z, def.lucky === 2)
      return
    }
    if (id === B.TNT) {
      this.primeTnt(x, y, z, ent.eid, 600)
      return
    }
    if (def.drop) {
      this.give(ent, def.drop, 1)
      ent.dirty = true
    }
  }

  openLucky(ent, x, y, z, rare) {
    const mode = MODES[this.match.mode]
    ent.lucky = (ent.lucky || 0) + 1
    this.match.stats.lucky += 1
    const got = []
    let text = ''
    let bad = null
    for (let r = 0; r < mode.rolls; r += 1) {
      const entry = rollLucky(this.random, rare)
      if (!text) text = entry.text
      if (entry.bad) {
        bad = entry.bad
        this.unlucky(ent, entry.bad, x, y, z)
      } else {
        for (const [item, n] of entry.give) {
          this.give(ent, item, n)
          got.push([item, n])
        }
      }
    }
    this.give(ent, 'wool', LUCKY_BONUS_BLOCKS)
    got.push(['wool', LUCKY_BONUS_BLOCKS])
    ent.dirty = true
    if (ent.cid) this.sendTo(ent.cid, 'loot', { x, y, z, text, items: got, rare, bad })
    this.toMatchViewers('pop', { x, y, z, rare, bad: Boolean(bad) })
  }

  unlucky(ent, kind, x, y, z) {
    if (kind === 'tnt') {
      this.toMatchViewers('tnt', { x, y, z, fuse: 1700 })
      this.match.tnts.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, at: this.now() + 1700, owner: null })
    } else if (kind === 'lightning') {
      this.toMatchViewers('bolt', { x: ent.x, y: ent.y, z: ent.z })
      this.damage(ent, 5, null, 'lightning')
      if (ent.alive) {
        ent.effects.burn = this.now() + 2000
      }
    } else if (kind === 'launch') {
      const a = this.random() * Math.PI * 2
      this.knock(ent, Math.cos(a) * 3, 15, Math.sin(a) * 3)
    }
  }

  onPlace(ent, x, y, z) {
    if (!this.canAct(ent)) return this.reject(ent, x, y, z)
    const slot = ent.inv[ent.sel]
    const item = slot && ITEMS[slot.id]
    if (!item || (item.kind !== 'block' && item.kind !== 'tnt') || !this.inReach(ent, x, y, z)) return this.reject(ent, x, y, z)
    if (!this.placeBlock(ent, x, y, z)) this.reject(ent, x, y, z)
  }

  /** Can a block go in cell (x, y, z)? */
  canPlaceAt(x, y, z) {
    const w = this.match.world
    if (x < 0 || z < 0 || y < 1 || x >= w.sx || z >= w.sz || y >= w.sy - 1) return false
    const here = w.get(x, y, z)
    if (here !== B.AIR && BLOCKS[here].render !== 'cross') return false
    const touching =
      w.isSolid(x + 1, y, z) || w.isSolid(x - 1, y, z) || w.isSolid(x, y + 1, z) || w.isSolid(x, y - 1, z) || w.isSolid(x, y, z + 1) || w.isSolid(x, y, z - 1)
    if (!touching) return false
    for (const e of this.ents.values()) {
      if (e.zone === 'match' && e.alive && cellOverlapsBody(x, y, z, e.x, e.y, e.z, PLAYER.halfW - 0.05, PLAYER.height - 0.05)) return false
    }
    return true
  }

  placeBlock(ent, x, y, z) {
    const slot = ent.inv[ent.sel]
    const item = slot && ITEMS[slot.id]
    if (!item || !this.canPlaceAt(x, y, z)) return false
    this.take(ent, ent.sel, 1)
    if (item.kind === 'tnt') {
      this.setBlock(x, y, z, B.TNT)
      this.primeTnt(x, y, z, ent.eid, TNT.fuseMs)
    } else {
      this.setBlock(x, y, z, item.block)
    }
    ent.placed = (ent.placed || 0) + 1
    this.match.stats.placed += 1
    // Others see your arm swing as you build.
    this.toWatchers(ent, 'swing', { eid: ent.eid })
    return true
  }

  primeTnt(x, y, z, owner, fuse) {
    const m = this.match
    if (m.tnts.some((t) => Math.floor(t.x) === x && Math.floor(t.y) === y && Math.floor(t.z) === z)) return
    m.tnts.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, at: this.now() + fuse, owner })
    this.toMatchViewers('tnt', { x, y, z, fuse })
  }

  explode(cx, cy, cz, owner) {
    const m = this.match
    const r = TNT.radius
    const R = Math.ceil(r)
    for (let x = Math.floor(cx) - R; x <= Math.floor(cx) + R; x += 1) {
      for (let y = Math.floor(cy) - R; y <= Math.floor(cy) + R; y += 1) {
        for (let z = Math.floor(cz) - R; z <= Math.floor(cz) + R; z += 1) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz)
          if (d > r + (this.random() - 0.5) * 0.8) continue
          const id = m.world.get(x, y, z)
          if (id === B.AIR) continue
          const def = BLOCKS[id]
          if (!Number.isFinite(def.hard) || def.hard >= 2.4) continue
          if (id === B.TNT && !(Math.floor(cx) === x && Math.floor(cy) === y && Math.floor(cz) === z)) {
            this.primeTnt(x, y, z, owner, 350 + this.random() * 300)
            continue
          }
          this.setBlock(x, y, z, B.AIR)
        }
      }
    }
    this.toMatchViewers('boom', { x: cx, y: cy, z: cz, r })
    for (const e of this.ents.values()) {
      if (e.zone !== 'match' || !e.alive) continue
      const dx = e.x - cx
      const dy = e.y + 0.9 - cy
      const dz = e.z - cz
      const d = Math.hypot(dx, dy, dz)
      if (d > r + 1.5) continue
      const f = 1 - d / (r + 1.5)
      const len = Math.hypot(dx, dz) || 1
      this.damage(e, Math.max(1, Math.round(TNT.damage * f)), owner, 'tnt', (dx / len) * TNT.knock * f, (dz / len) * TNT.knock * f, 6 + 6 * f)
    }
  }

  onAttack(ent, targetEid) {
    if (!this.canAct(ent)) return
    const target = this.ents.get(targetEid)
    if (!target || target === ent || target.zone !== 'match' || !target.alive || target.team === ent.team) return
    const now = this.now()
    if (now - ent.lastAttackAt < ATTACK_COOLDOWN_MS * 0.8) return
    const e = this.eye(ent)
    // Distance from your eye to the nearest point of their box.
    const nx = clamp(e.x, target.x - PLAYER.halfW, target.x + PLAYER.halfW)
    const ny = clamp(e.y, target.y, target.y + PLAYER.height)
    const nz = clamp(e.z, target.z - PLAYER.halfW, target.z + PLAYER.halfW)
    if (Math.hypot(nx - e.x, ny - e.y, nz - e.z) > MELEE_REACH + REACH_SLACK) return
    this.melee(ent, target)
  }

  melee(ent, target) {
    const now = this.now()
    ent.lastAttackAt = now
    const item = ITEMS[this.heldItem(ent)] || ITEMS.fist
    let dmg = item.kind === 'sword' || item.kind === 'tool' ? item.dmg : 1
    if (ent.effects.strength > now) dmg += EFFECTS.strength.dmgAdd
    if (ent.bot) dmg = Math.max(1, Math.round(dmg * (BOT_LEVELS[this.match.botLevel]?.damage ?? 0.8)))
    const dx = target.x - ent.x
    const dz = target.z - ent.z
    const len = Math.hypot(dx, dz) || 1
    const sprintBonus = ent.anim === 2 ? 1.4 : 1
    if (item.burn) {
      target.effects.burn = now + item.burn * 1000
      target.effects.burnBy = ent.eid
    }
    this.toZone('match', 'swing', { eid: ent.eid }, ent.cid)
    this.damage(target, dmg, ent.eid, 'melee', (dx / len) * 6.5 * sprintBonus, (dz / len) * 6.5 * sprintBonus, 6.2)
  }

  onUse(ent, p) {
    if (!this.canAct(ent)) return
    const slot = ent.inv[ent.sel]
    if (!slot) return
    const dir = Array.isArray(p.dir) ? p.dir.map((v) => num(v)) : [-Math.sin(ent.yaw), 0, -Math.cos(ent.yaw)]
    this.useItem(ent, ent.sel, dir, clamp(num(p.charge, 1), 0, 1))
  }

  /** Uses the item in `slot`: eat, drink, shoot, throw. Returns true if something happened. */
  useItem(ent, slotIndex, dir, charge = 1) {
    const now = this.now()
    const slot = ent.inv[slotIndex]
    const item = slot && ITEMS[slot.id]
    if (!item) return false
    const gap = item.kind === 'bow' ? 320 : 220
    if (now - ent.lastUseAt < gap) return false
    ent.lastUseAt = now
    switch (item.kind) {
      case 'food':
        ent.hp = Math.min(ent.maxHp, ent.hp + item.heal)
        if (item.regen) ent.effects.regen = now + item.regen * 1000
        break
      case 'potion':
        if (item.heal) ent.hp = Math.min(ent.maxHp, ent.hp + item.heal)
        if (item.effect) ent.effects[item.effect] = now + item.dur * 1000
        break
      case 'heart':
        ent.maxHp = Math.min(40, ent.maxHp + item.maxHp)
        ent.hp = Math.min(ent.maxHp, ent.hp + item.maxHp)
        break
      case 'bow': {
        const c = Math.max(0.25, charge)
        this.shoot(ent, 'arrow', dir, PROJECTILES.arrow.speed * (0.45 + 0.55 * c), Math.round(2 + (item.dmg - 2) * c), 4 * c)
        break
      }
      case 'throw':
        this.shoot(ent, slot.id === 'pearl' ? 'pearl' : 'snowball', dir, PROJECTILES[slot.id === 'pearl' ? 'pearl' : 'snowball'].speed, item.dmg, item.knock || 0)
        break
      default:
        return false
    }
    this.take(ent, slotIndex, 1)
    ent.dirty = true
    if (ent.cid) this.sendTo(ent.cid, 'used', { item: slot.id })
    // Others see you eat, drink or throw.
    this.toWatchers(ent, 'act', { eid: ent.eid, kind: item.kind, item: slot.id })
    return true
  }

  /** Sends to everyone who can see `ent` in the round (players and spectators), but not `ent`. */
  toWatchers(ent, type, payload) {
    this.toZone('match', type, payload, ent.cid)
    this.toZone('spec', type, payload, ent.cid)
  }

  // --- Projectiles ----------------------------------------------------------------------

  shoot(ent, kind, dir, speed, dmg, knock) {
    const m = this.match
    if (m.projs.length > 64) return
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const e = this.eye(ent)
    const p = {
      id: m.nextProj++,
      kind,
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
    }
    m.projs.push(p)
    this.toMatchViewers('proj', { id: p.id, kind, owner: p.owner, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz })
  }

  tickProjectiles(dt) {
    const m = this.match
    for (let i = m.projs.length - 1; i >= 0; i -= 1) {
      const p = m.projs[i]
      const spec = PROJECTILES[p.kind]
      p.age += dt
      p.vy -= spec.gravity * dt
      const sx = p.vx * dt
      const sy = p.vy * dt
      const sz = p.vz * dt
      const segLen = Math.hypot(sx, sy, sz)
      let best = null
      const hit = raycastVoxels(m.world, p.x, p.y, p.z, sx, sy, sz, segLen, isSolidBlock)
      if (hit) best = { t: hit.dist, block: hit }
      const s = spec.size / 2
      for (const e of this.ents.values()) {
        if (e.zone !== 'match' || !e.alive || e.eid === p.owner) continue
        const t = rayBox(
          p.x, p.y, p.z, sx / segLen, sy / segLen, sz / segLen,
          e.x - PLAYER.halfW - s, e.y - s, e.z - PLAYER.halfW - s,
          e.x + PLAYER.halfW + s, e.y + PLAYER.height + s, e.z + PLAYER.halfW + s,
        )
        if (t >= 0 && t <= segLen && (!best || t < best.t)) best = { t, ent: e }
      }
      if (best || p.age > spec.life || p.y < -10) {
        const t = best ? best.t : segLen
        const hx = p.x + (sx / (segLen || 1)) * t
        const hy = p.y + (sy / (segLen || 1)) * t
        const hz = p.z + (sz / (segLen || 1)) * t
        m.projs.splice(i, 1)
        this.toMatchViewers('projEnd', { id: p.id, x: hx, y: hy, z: hz })
        const owner = this.ents.get(p.owner)
        if (best?.ent) {
          const len = Math.hypot(p.vx, p.vz) || 1
          const k = p.knock + 2.5
          this.damage(best.ent, p.dmg, p.owner, p.kind, (p.vx / len) * k, (p.vz / len) * k, p.knock ? 5.5 : 3)
        }
        if (p.kind === 'pearl' && owner?.alive && owner.zone === 'match' && (best || p.age > spec.life)) {
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
            this.teleport(owner, clamp(tx, 0.5, MATCH_SIZE.x - 0.5), ty, clamp(tz, 0.5, MATCH_SIZE.z - 0.5))
            this.damage(owner, 2, null, 'pearl')
          }
        }
        continue
      }
      p.x += sx
      p.y += sy
      p.z += sz
    }
  }

  // --- Health ---------------------------------------------------------------------------

  damage(target, amount, byEid, how, kx = 0, kz = 0, ky = 0) {
    if (!target.alive || this.phase !== 'fight') return
    // No friendly fire: teammates' swords, arrows and TNT don't hurt (or push) you.
    const attacker = byEid ? this.ents.get(byEid) : null
    if (attacker && attacker !== target && attacker.zone === 'match' && attacker.team === target.team) return
    const now = this.now()
    target.hp -= amount
    target.lastHurtAt = now
    target.dirty = true
    if (byEid && byEid !== target.eid) target.lastHitBy = { eid: byEid, at: now }
    this.toZone('match', 'hurt', { eid: target.eid, by: byEid || 0, how, dmg: amount })
    this.toZone('spec', 'hurt', { eid: target.eid, by: byEid || 0, how, dmg: amount })
    if (kx || kz || ky) this.knock(target, kx, ky, kz)
    if (target.hp <= 0) {
      const killer = byEid || (target.lastHitBy && now - target.lastHitBy.at < 10000 ? target.lastHitBy.eid : null)
      this.kill(target, killer, how)
    }
  }

  knock(target, x, y, z) {
    if (target.bot && target.body) {
      target.body.pushX += x
      target.body.pushZ += z
      target.body.vy = Math.max(target.body.vy, y)
      target.body.onGround = false
    } else if (target.cid) {
      this.sendTo(target.cid, 'kb', { x, y, z })
      target.tpGrace = Math.max(target.tpGrace, this.now() + 700)
    }
  }

  kill(target, killerEid, how) {
    if (!target.alive) return
    target.alive = false
    target.hp = 0
    target.dirty = true
    const placement = this.aliveFighters().length + 1
    const killer = killerEid && killerEid !== target.eid ? this.ents.get(killerEid) : null
    const st = this.match?.stats
    if (st && how !== 'left') {
      // Falling into the lava sea isn't the lava catching you: told apart for balance.
      const cause = how === 'lava' && this.match.lavaY < ISLAND_TOP - 2 ? 'fell' : how
      st.deaths[cause] = (st.deaths[cause] || 0) + 1
      if (killer) {
        st.byPlayer += 1
        if (!st.firstKillMs && this.match.fightStart) st.firstKillMs = this.now() - this.match.fightStart
      }
    }
    target.diedHow = how === 'lava' && this.match && this.match.lavaY < ISLAND_TOP - 2 ? 'fell' : how
    target.diedByPlayer = Boolean(killer)
    target.diedAt = this.now()
    if (killer && killer.zone === 'match') {
      killer.kills += 1
      killer.dirty = true
      if (killer.cid) this.sendTo(killer.cid, 'killed', { name: target.name })
    }
    this.toZone('match', 'feed', { k: killer?.name || '', v: target.name, how })
    this.toZone('spec', 'feed', { k: killer?.name || '', v: target.name, how })
    this.rosterDirty = true
    this.phaseDirty = true
    // Teams: you place when your whole team is out (and win if they win).
    const teamSize = this.match?.teamSize || 1
    const teamAlive = teamSize > 1 && this.aliveFighters().some((e) => e.team === target.team)
    const teamPlace = this.aliveTeams().size + 1
    if (target.cid) {
      if (how !== 'left') {
        target.zone = 'spec'
        this.sendTo(target.cid, 'dead', { by: killer?.name || '', how, placement: teamSize > 1 ? (teamAlive ? 0 : teamPlace) : placement })
      }
      if (teamAlive) target.pendingReward = true
      else this.reward(target, teamSize > 1 ? teamPlace : placement)
    } else if (target.bot) {
      target.zone = 'match'
    }
    if (teamSize > 1 && !teamAlive) {
      for (const e of this.ents.values()) {
        if (e.pendingReward && e.team === target.team) {
          e.pendingReward = false
          this.reward(e, teamPlace)
        }
      }
    }
    this.checkWin(target)
  }

  // --- Inventory --------------------------------------------------------------------------

  /** Adds `n` of `id` to the hotbar (stacking first). Returns how many didn't fit. */
  give(ent, id, n) {
    const item = ITEMS[id]
    if (!item) return n
    const max = item.stack || 1
    for (const slot of ent.inv) {
      if (n <= 0) break
      if (slot && slot.id === id && slot.n < max) {
        const add = Math.min(max - slot.n, n)
        slot.n += add
        n -= add
      }
    }
    for (let i = 0; i < ent.inv.length && n > 0; i += 1) {
      if (!ent.inv[i]) {
        const add = Math.min(max, n)
        ent.inv[i] = { id, n: add }
        n -= add
      }
    }
    // Swap a worse sword for a better one when the hotbar is full.
    if (n > 0 && item.kind === 'sword') {
      const worst = ent.inv.findIndex((s) => s && ITEMS[s.id].kind === 'sword' && ITEMS[s.id].dmg < item.dmg)
      if (worst >= 0) {
        ent.inv[worst] = { id, n: 1 }
        n = 0
      }
    }
    ent.dirty = true
    return n
  }

  take(ent, slotIndex, n) {
    const slot = ent.inv[slotIndex]
    if (!slot) return
    slot.n -= n
    if (slot.n <= 0) ent.inv[slotIndex] = null
    ent.dirty = true
  }

  // --- World ------------------------------------------------------------------------------

  setBlock(x, y, z, id) {
    const m = this.match
    if (!m.world.set(x, y, z, id)) return
    m.edits.set(blockKey(x, y, z), id)
    m.pending.push(x, y, z, id)
  }

  /** The client guessed wrong: put its copy of the block back. */
  reject(ent, x, y, z) {
    if (!ent.cid || !this.match) return
    const w = this.match.world
    if (!w.inBounds(x, y, z)) return
    this.sendTo(ent.cid, 'edits', { e: [x, y, z, w.get(x, y, z)] })
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

  // --- Sending ----------------------------------------------------------------------------

  toZone(zone, type, payload, exceptCid = null) {
    for (const ent of this.ents.values()) {
      if (ent.cid && ent.zone === zone && ent.cid !== exceptCid) this.sendTo(ent.cid, type, payload)
    }
  }

  toMatchViewers(type, payload) {
    this.toZone('match', type, payload)
    this.toZone('spec', type, payload)
  }

  phasePayload() {
    const now = this.now()
    const m = this.match
    return {
      phase: this.phase,
      left: Math.max(0, this.phaseEnds - now),
      mode: m?.mode || null,
      map: m?.mapId || null,
      alive: m ? this.aliveFighters().length : 0,
      teamsLeft: m ? this.aliveTeams().size : 0,
      teamSize: m?.teamSize || 1,
      fighters: m?.fighters || 0,
      votes: this.voteCounts(),
      mapVotes: this.mapVoteCounts(),
      mapOptions: this.mapOptions,
      voteStage: this.phase === 'intermission' ? this.voteStage : 'mode',
      stageLeft: this.phase === 'intermission' ? Math.max(0, this.stageEnds - now) : 0,
      chosenMode: this.lockedMode,
      chosenBots: this.lockedBots,
      botVotes: this.botVoteCounts(),
      botLevel: m?.botLevel || null,
      elapsed: m && m.fightStart ? now - m.fightStart : 0,
      waitingFor: this.eligibleMembers().length,
    }
  }

  flush(dt, now) {
    const m = this.match
    if (m && m.pending.length) {
      this.toMatchViewers('edits', { e: m.pending })
      m.pending = []
    }
    if (this.phaseDirty || now - this.phaseSentAt > 2000) {
      this.phaseDirty = false
      this.phaseSentAt = now
      const payload = this.phasePayload()
      for (const member of this.members.values()) {
        const ent = this.ents.get(member.eid)
        const canJoin = Boolean(ent && ent.zone !== 'match' && this.match && !this.joinBlocked(ent))
        this.sendTo(member.cid, 'phase', { ...payload, myVote: member.vote, myMapVote: member.mapVote, myBotVote: member.botVote, afk: member.afk, canJoin })
      }
    }
    if (this.rosterDirty) {
      this.rosterDirty = false
      const list = [...this.ents.values()].map((e) => ({
        eid: e.eid,
        name: e.name,
        bot: e.bot,
        cape: e.cape,
        sword: e.sword,
        level: e.level || 1,
        vip: Boolean(e.vip),
        look: e.look || '',
        team: e.zone === 'lobby' ? -1 : e.team ?? -1,
        zone: e.zone,
        alive: e.alive,
        kills: e.kills,
      }))
      for (const member of this.members.values()) this.sendTo(member.cid, 'roster', { list })
    }
    for (const ent of this.ents.values()) {
      if (!ent.dirty || !ent.cid) continue
      ent.dirty = false
      const effects = {}
      for (const [k, v] of Object.entries(ent.effects)) if (k !== 'burnBy' && v > now) effects[k] = v - now
      this.sendTo(ent.cid, 'me', { hp: ent.hp, maxHp: ent.maxHp, inv: ent.inv, sel: ent.sel, effects, alive: ent.alive, zone: ent.zone, kills: ent.kills })
    }
    // Positions, every other tick (~10 Hz is plenty with interpolation; 20 Hz in a fight).
    this.snapAcc += 1
    if (this.phase !== 'fight' && this.snapAcc % 2) return
    const lists = { lobby: [], match: [] }
    for (const e of this.ents.values()) {
      const list = e.zone === 'lobby' ? lists.lobby : e.zone === 'match' && e.alive ? lists.match : null
      if (!list) continue
      // In the lobby everyone carries a sword, to show off their sword skin.
      const held = ITEM_IDS.indexOf(e.zone === 'lobby' ? LOBBY_SWORD : e.inv[e.sel]?.id || 'fist')
      list.push(e.eid, Math.round(e.x * 100), Math.round(e.y * 100), Math.round(e.z * 100), Math.round(e.yaw * 100), Math.round(e.pitch * 100), e.anim, held)
    }
    for (const e of this.ents.values()) {
      if (!e.cid) continue
      const zone = e.zone === 'lobby' ? 'lobby' : 'match'
      this.sendTo(e.cid, 'snap', { z: zone, e: lists[zone] })
    }
  }

  static get SIM_HZ() {
    return SIM_HZ
  }
}
