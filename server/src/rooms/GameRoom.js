import { Room } from '@colyseus/core'

import { AD_REWARDS } from '../../../shared/balance.js'
import { GameHost } from '../../../shared/host.js'
import { PlayerSession } from '../../../shared/session.js'
import { resolveIdentity, verifyAdReward } from '../bloxityApi.js'
import { reportLeaver } from '../bloxityLeaderboards.js'
import { carryOverGuest, loadProfile, recordEvent, saveProfile } from '../db.js'
import { applyGemsForSession } from '../gems.js'
import { getLeaderboards } from '../leaderboards.js'
import { activePlayers, liveRooms } from '../registry.js'
import { GameState, PlayerState } from './schema.js'

/** One server: a shared lobby, many duels at once, and Spirelands. */
const MAX_CLIENTS = 50
const RECONNECT_SECONDS = 20
const AUTOSAVE_MS = 30_000
/** The simulation: duels, Spirelands, bots, projectiles (GameHost). */
const SIM_HZ = GameHost.SIM_HZ
/** Close code used when the same player joins somewhere else (4000-4010 are Colyseus's own). */
const DUPLICATE_LOGIN = 4100
/** Names this server process in save ownership; Legion sets POD_NAME per pod. */
const POD = process.env.POD_NAME || `local-${process.pid}`
/** Least time between two 'gemsCheck's from one player (each is a database query). */
const GEMS_CHECK_MS = 2000

/** Game messages the host handles; everything else is a lobby/profile action. */
const HOST_MESSAGES = new Set(['pos', 'sel', 'dig', 'break', 'place', 'attack', 'use', 'block', 'swing', 'lobby', 'look', 'qc', 'queue', 'unqueue', 'voteMap', 'requeue', 'ffa', 'kit', 'parkour', 'swap', 'swapHands'])
/** Profile actions the session handles. */
const SESSION_MESSAGES = new Set(['openCase', 'equip', 'claimDaily', 'welcomeGift', 'tutorialDone'])

/** Unambiguous characters for lobby codes people read out to each other. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = (length = 5) =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

const cleanName = (name) =>
  String(name || 'Player')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 20) || 'Player'

/**
 * One server: up to 50 players sharing a lobby, the duel queues, every duel in progress
 * and Spirelands. The game itself runs in GameHost (shared with the offline game); this
 * room adds networking, identity, saves, Boxity rewards, and the small synced state the
 * platform reads (who's here).
 */
export class GameRoom extends Room {
  maxClients = MAX_CLIENTS
  autoDispose = true

  /**
   * sessionId -> { session, playerId, verified, owner, kicked?, reconnection?,
   *                adPending?, gemsCheckAt? }
   */
  members = new Map()

  onCreate(options = {}) {
    this.setState(new GameState())
    if (options.private) {
      this.roomId = makeCode()
      this.state.code = this.roomId
      this.state.isPrivate = true
      this.setPrivate(true)
    }
    this.host = new GameHost({
      send: (sid, type, payload) => this.sendTo(sid, type, payload),
      onAnalytics: (type, data) => recordEvent(type, data),
      onReward: (sid, result) => {
        const member = this.members.get(sid)
        if (!member || member.kicked) return
        member.session.awardRound(result)
        this.syncPlayer(sid)
      },
      onParkour: (sid, ms) => {
        const member = this.members.get(sid)
        if (member && !member.kicked) member.session.parkour(ms)
      },
    })
    this.setSimulationInterval((dt) => this.tick(dt / 1000), 1000 / SIM_HZ)
    this.updateListing()
    liveRooms.add(this)

    this.onMessage('*', (client, type, payload) => {
      type = String(type)
      if (HOST_MESSAGES.has(type)) return this.host.message(client.sessionId, type, payload || {})
      if (type === 'adReward') return this.handleAdReward(client, payload)
      if (type === 'gemsCheck') return this.handleGemsCheck(client)
      if (SESSION_MESSAGES.has(type)) {
        const member = this.members.get(client.sessionId)
        if (!member) return
        member.session.handle(type, payload || {}, Date.now())
        this.syncPlayer(client.sessionId)
      }
    })

    this.autosave = setInterval(() => this.saveAll(), AUTOSAVE_MS)
  }

  /** Sends to a player by session id (the current client object, after reconnects). */
  sendTo(sessionId, type, payload) {
    const client = this.clients.find((c) => c.sessionId === sessionId)
    if (client) client.send(type, payload)
  }

  async onAuth(_client, options) {
    const identity = await resolveIdentity(options)
    return { ...identity, name: cleanName(identity.name || options?.name) }
  }

  async onJoin(client, _options, auth) {
    const { playerId, name, verified = false, carriedFrom = [] } = client.auth || auth

    const existing = activePlayers.get(playerId)
    if (existing) await existing.room.evict(existing.client, 'You joined from another window.')

    const now = Date.now()
    const owner = `${POD}:${client.sessionId}`
    if (verified && carriedFrom.length) {
      const from = await carryOverGuest(playerId, carriedFrom, name)
      if (from) console.log(`[room] carried guest ${from} into ${playerId}`)
    }
    const profile = await loadProfile(playerId, name, owner)

    const player = new PlayerState()
    Object.assign(player, { name, uid: verified ? playerId : '' })
    this.state.players.set(client.sessionId, player)

    const sid = client.sessionId
    const session = new PlayerSession(profile, {
      now,
      emit: (type, payload) => this.sendTo(sid, type, payload),
      onLook: (look) => this.host.setLook(sid, look),
    })
    this.members.set(sid, { session, playerId, verified, owner })
    activePlayers.set(playerId, { room: this, client })

    session.sendProfile()
    this.host.join(sid, name, session.look())
    client.send('leaderboards', getLeaderboards())
    this.syncPlayer(sid)
    this.updateListing()
    applyGemsForSession(this, sid)
  }

  async onDrop(client) {
    const member = this.members.get(client.sessionId)
    if (!member || member.kicked) return
    member.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    try {
      await member.reconnection
    } catch {
      // Window expired or replaced; onLeave cleans up.
    } finally {
      member.reconnection = null
    }
  }

  onReconnect(client) {
    const member = this.members.get(client.sessionId)
    if (!member) return
    activePlayers.set(member.playerId, { room: this, client })
    member.session.sendProfile()
  }

  async onLeave(client) {
    const member = this.members.get(client.sessionId)
    // The host first: leaving mid-duel is a forfeit, a Spirelands life is paid out.
    this.host.leave(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member) {
      if (activePlayers.get(member.playerId)?.client === client) activePlayers.delete(member.playerId)
      this.members.delete(client.sessionId)
      if (!member.kicked) {
        if (member.verified) reportLeaver(member.playerId, member.session.profile)
        await saveProfile(member.session.profile, member.owner)
      }
    }
    this.updateListing()
  }

  async onBeforeShutdown() {
    await this.saveAll()
    super.onBeforeShutdown()
  }

  async onDispose() {
    clearInterval(this.autosave)
    liveRooms.delete(this)
    await this.saveAll()
  }

  async evict(client, reason) {
    const member = this.members.get(client.sessionId)
    this.host.leave(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member && !member.kicked) {
      member.kicked = true
      await saveProfile(member.session.profile, member.owner)
      member.reconnection?.reject(new Error('replaced by a new session'))
    }
    try {
      client.send('kicked', { reason })
      client.leave(DUPLICATE_LOGIN)
    } catch {
      // Already disconnected.
    }
  }

  saveAll() {
    return Promise.all([...this.members.values()].map((m) => (m.kicked ? null : saveProfile(m.session.profile, m.owner))))
  }

  updateListing() {
    this.setMetadata({
      players: this.clients.length,
      isPrivate: Boolean(this.state.isPrivate),
      region: process.env.REGION || 'default',
    })
  }

  /** Copies the public bits of a profile into the synced state. */
  syncPlayer(sessionId) {
    const member = this.members.get(sessionId)
    const player = this.state.players.get(sessionId)
    if (!member || !player) return
    const p = member.session.profile
    if (player.wins !== p.wins) player.wins = p.wins
    if (player.kills !== p.kills) player.kills = p.kills
  }

  async handleAdReward(client, msg) {
    const member = this.members.get(client.sessionId)
    const placement = String(msg?.placement || '')
    const rewardToken = msg?.rewardToken
    if (!member || member.adPending || !AD_REWARDS[placement]) return
    if (typeof rewardToken !== 'string' || !rewardToken || rewardToken.length > 4096) return
    member.adPending = true
    try {
      if (!(await verifyAdReward(rewardToken))) return
      if (this.members.get(client.sessionId) !== member || member.kicked) return
      member.session.grantAdReward(placement, Date.now())
    } finally {
      member.adPending = false
    }
  }

  handleGemsCheck(client) {
    const member = this.members.get(client.sessionId)
    const now = Date.now()
    if (!member || now - (member.gemsCheckAt || 0) < GEMS_CHECK_MS) return
    member.gemsCheckAt = now
    applyGemsForSession(this, client.sessionId)
  }

  tick(dt) {
    this.host.tick(dt)
    for (const member of this.members.values()) member.session.tick(dt)
  }
}
