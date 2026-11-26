import { environment } from '../bloxity/env'
import { GAME_SLUG, joinToken } from '../bloxity/identity'
import { getSDK, safeCall, waitForSDK } from '../bloxity/sdk'

import { runtime } from '../game/runtime'
import { getGame } from '../store/game'
import { send, setTransport } from './actions'
import { handleServerEvent } from './events'
import { createLocalServer } from './localServer'
import { clearRemotes } from './remotes'

/** Position reports per second (the host checks each against the last). */
const POSITION_HZ = 15
const JOIN_RETRIES = 4
const RETRY_DELAY_MS = 4000
/** Server code for "you joined from another window". */
const DUPLICATE_LOGIN = 4100
/** Matchmaker: give up and play offline after this long (it holds a cold start ~45 s). */
const MATCHMAKER_GIVE_UP_MS = 60_000
const MATCHMAKER_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000]

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')

/**
 * `?roomId=<id>`: Boxity opened the game to join a particular room (a friend's invite,
 * "join" on a friend's presence). Only the first connection goes there; cleared once
 * that attempt has run.
 */
let launchRoomId = params.get('roomId') || null

/**
 * Where to play. `?offline` forces offline play, and in development `?server=` points
 * straight at a server. A build with VITE_LEGION_GAME_ID (the hosted game on Bloxity
 * Legion) goes through Legion's matchmaker, which picks a pod with room or starts one.
 * Otherwise VITE_SERVER_URL; in development, this game's server on the same host
 * (see findDevServer). A production build with neither plays offline.
 *
 * @returns {{ kind: 'matchmaker', gameId: string } | { kind: 'direct', url: string } | { kind: 'dev' } | null}
 */
function serverTarget() {
  if (params.has('offline')) return null
  if (import.meta.env.DEV && params.get('server')) return { kind: 'direct', url: params.get('server') }
  if (import.meta.env.VITE_LEGION_GAME_ID) return { kind: 'matchmaker', gameId: import.meta.env.VITE_LEGION_GAME_ID }
  if (import.meta.env.VITE_SERVER_URL) return { kind: 'direct', url: import.meta.env.VITE_SERVER_URL }
  return import.meta.env.DEV ? { kind: 'dev' } : null
}

/**
 * Local development: this game's own server. With a local Boxity stack
 * (`BLOXITY_ENV.env === 'local'`) its playUrl comes first; then the server's usual port
 * and 3000 (where older server .env files put it) on the host the page was opened
 * from, so a phone on the LAN finds the dev machine's server too. This locates the dev
 * game server only - it never decides which Boxity environment is in use (env.js does).
 * Only a server that says it's this game counts, so another project's server on one of
 * those ports is skipped.
 */
const DEV_PORTS = [2567, 3000]
async function findDevServer() {
  const env = environment()
  const candidates = env.env === 'local' ? [env.playUrl] : []
  for (const port of DEV_PORTS) candidates.push(`${window.location.protocol}//${window.location.hostname}:${port}`)
  for (const url of new Set(candidates)) {
    const health = await healthOf(url)
    if (health?.ok && health.game === 'lucky-sky-brawl') return url
  }
  return null
}

let active = null
let generation = 0
/** What our Bloxity avatar wears, as last shared; sent again on every (re)join. */
let localLook = null

/** Tells the authority what our avatar wears, so other players see us dressed the same. */
export function shareLook(equipped, proportions) {
  localLook = { equipped: equipped || {}, proportions: proportions || {} }
  send('look', localLook)
}
const resendLook = () => {
  if (localLook) send('look', localLook)
}
let lastIdentity = null
/**
 * The room we are in (or were last in): `{ endpoint, roomId }`. Signing in mid-game
 * rejoins exactly this room instead of matchmaking somewhere else.
 */
let lastRoom = null
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Calls `Legion.SDK.game[method](...args)` if the SDK is there; never throws. */
function sdkGame(method, ...args) {
  const game = getSDK()?.game
  return safeCall(game?.[method]?.bind(game), ...args)
}

/**
 * Join options, read fresh for every join: the Boxity token can change (sign-in) and
 * the server verifies it. `token` is null for guests.
 */
function joinOptions(identity) {
  return { playerId: identity.id, name: identity.name, token: joinToken(), gameSlug: GAME_SLUG }
}

/** The server's /api/health answer, or null if it can't be reached. */
async function healthOf(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2500) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/**
 * ~15 Hz position reports to whichever authority we have, skipped while standing still
 * (but at least once a second). Returns the stop function.
 */
function startPositionReports() {
  let last = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, a: -1 }
  let lastSentAt = 0
  const id = setInterval(() => {
    const p = runtime.player
    const b = p.body
    const now = performance.now()
    const moved =
      Math.abs(b.x - last.x) + Math.abs(b.y - last.y) + Math.abs(b.z - last.z) > 0.02 ||
      Math.abs(p.yaw - last.yaw) + Math.abs(p.pitch - last.pitch) > 0.02 ||
      p.anim !== last.a
    if (!moved && now - lastSentAt < 1000) return
    last = { x: b.x, y: b.y, z: b.z, yaw: p.yaw, pitch: p.pitch, a: p.anim }
    lastSentAt = now
    send('pos', { x: +b.x.toFixed(3), y: +b.y.toFixed(3), z: +b.z.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), a: p.anim })
  }, 1000 / POSITION_HZ)
  return () => clearInterval(id)
}

function startLocal(identity, message) {
  const local = createLocalServer({ ...identity, onEvent: handleServerEvent })
  setTransport(local)
  resendLook()
  const stopReports = startPositionReports()
  active = {
    kind: 'local',
    close: () => {
      stopReports()
      local.close()
    },
  }
  // Not in a joinable room: friends can't be sent here.
  sdkGame('updateRoom', '')
  getGame().setNet({ mode: 'offline', players: 1, lobbyId: null, code: null, isPrivate: false, message })
}

function join(client, options, lobby) {
  if (lobby.mode === 'private') return client.create('game', { ...options, private: true })
  if (lobby.mode === 'join') return client.joinById(String(lobby.code).trim().toUpperCase(), options)
  return client.joinOrCreate('game', options)
}

/**
 * A Legion endpoint (`<play>/v1/ws/<relayRoomId>`) rebuilt on the current environment's
 * playUrl; any other endpoint (a direct server) as it is.
 */
function rejoinEndpoint(endpoint) {
  const match = /\/v1\/ws\/([^/?#]+)/.exec(endpoint || '')
  if (!match) return endpoint
  return `${environment().playUrl.replace(/^http/i, 'ws')}/v1/ws/${match[1]}`
}

/** `new Client(endpoint).joinById(roomId, options)`, or null if that fails. */
async function tryJoinById(Client, endpoint, roomId, options) {
  if (!endpoint || !roomId) return null
  try {
    return await new Client(endpoint).joinById(roomId, options)
  } catch (err) {
    console.warn(`[net] could not join room ${roomId}`, err)
    return null
  }
}

/**
 * The join URL of room `roomId` from Legion's room directory
 * (`{playUrl}/v1/dir/<hostingId>/list`), or null if it's gone or full.
 */
async function findListedRoom(hostingId, roomId) {
  try {
    const res = await fetch(`${environment().playUrl}/v1/dir/${encodeURIComponent(hostingId)}/list`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = await res.json()
    const rooms = Array.isArray(body) ? body : body?.rooms || body?.list || []
    const room = rooms.find((r) => r && (r.roomId === roomId || r.id === roomId || r.colyseusRoomId === roomId))
    if (!room?.joinUrl) return null
    const clients = Number(room.clients ?? room.players)
    const max = Number(room.maxClients ?? room.maxPlayers)
    if (Number.isFinite(clients) && Number.isFinite(max) && max > 0 && clients >= max) return null
    return room.joinUrl
  } catch (err) {
    console.warn('[net] room directory unavailable', err)
    return null
  }
}

/** Wires a joined room into the game: events, other players, position reports. */
function attachRoom(room, identity, Callbacks, endpoint, gen) {
  const callbacks = Callbacks.get(room)
  let leaving = false
  /** Set when the same account joined from another window and took over. */
  let replaced = false
  /**
   * False until the first state patch has been applied: players added before then were
   * already in the room when we joined; anyone after joined us.
   */
  let stateSeen = false

  lastRoom = { endpoint, roomId: room.roomId }
  // Tells Boxity which room friends can join us in (invites, presence).
  sdkGame('updateRoom', room.roomId)

  // Closing or refreshing the page leaves properly, so the server lets go of us at
  // once instead of holding our seat (and a frozen copy of us) for a reconnect.
  const onPageHide = () => {
    leaving = true
    room.leave(true)
  }
  window.addEventListener('pagehide', onPageHide)

  const syncLobby = () => {
    const players = room.state.players?.size ?? 1
    const isPrivate = Boolean(room.state.isPrivate)
    getGame().setNet({
      mode: 'online',
      lobbyId: room.roomId,
      code: isPrivate ? room.state.code : null,
      isPrivate,
      players,
      message: null,
    })
  }

  room.onMessage('*', (type, payload) => {
    switch (type) {
      case 'kicked':
        leaving = true
        replaced = true
        break
      default:
        handleServerEvent(type, payload)
    }
  })

  callbacks.onAdd('players', (player, sessionId) => {
    // Boxity toasts these only when that player is one of your friends.
    if (sessionId !== room.sessionId && player.name) sdkGame(stateSeen ? 'playerJoined' : 'playerInRoom', player.name)
    syncLobby()
  })
  callbacks.onRemove('players', () => syncLobby())
  callbacks.listen('isPrivate', syncLobby)
  room.onStateChange(() => {
    stateSeen = true
  })

  const stopReports = startPositionReports()

  room.onDrop(() => getGame().setNet({ mode: 'connecting', message: 'Reconnecting…' }))
  room.onReconnect(syncLobby)
  room.onLeave((code) => {
    window.removeEventListener('pagehide', onPageHide)
    stopReports()
    // The leave can land after a newer connection has started (a rejoin after signing
    // in, a lobby switch): that one owns the game's state now.
    if (gen !== generation) return
    clearRemotes()
    sdkGame('updateRoom', '')
    if (replaced || code === DUPLICATE_LOGIN) {
      getGame().setNet({ mode: 'replaced', message: 'Playing in another window' })
      return
    }
    if (leaving) {
      getGame().setNet({ mode: 'offline', message: 'Disconnected' })
      return
    }
    // Lost the room (server restart, reconnect window missed): back into the same room
    // if it still exists, else a new one.
    if (active?.room === room) {
      getGame().setNet({ mode: 'connecting', message: 'Reconnecting…' })
      setTimeout(() => startConnection(identity, { mode: 'rejoin' }), 1500)
    }
  })

  active = {
    kind: 'online',
    room,
    close: () => {
      leaving = true
      stopReports()
      clearRemotes()
      room.leave(true)
    },
  }
  setTransport({ send: (type, payload) => room.send(type, payload) })
  resendLook()
  syncLobby()
}

/**
 * Joins one specific room by id, if asked to: `lobby.mode === 'rejoin'` (signed in or
 * out mid-game: the room we were just in) or the launch `?roomId=` (first connection
 * only). Returns true once attached; false means "carry on with normal matchmaking".
 */
async function joinSpecificRoom(gen, identity, target, lobby, Client, Callbacks) {
  let endpoint = null
  let roomId = null
  if (lobby.mode === 'rejoin' && lastRoom) {
    endpoint = rejoinEndpoint(lastRoom.endpoint)
    roomId = lastRoom.roomId
  } else if (launchRoomId && (lobby.mode === 'public' || lobby.mode === 'rejoin')) {
    roomId = launchRoomId
    if (target.kind === 'matchmaker') {
      // The SDK has run before any request to the matchmaker (it's loaded before the
      // game's code anyway; this is the belt to that braces).
      await waitForSDK().catch(() => null)
      if (gen !== generation) return true
      endpoint = await findListedRoom(target.gameId, roomId)
    }
    else endpoint = target.kind === 'dev' ? await findDevServer() : target.url
    if (gen !== generation) return true
    // Tried (or found gone/full): later connections matchmake normally.
    launchRoomId = null
  }
  if (!endpoint || !roomId) return false

  const room = await tryJoinById(Client, endpoint, roomId, joinOptions(identity))
  if (gen !== generation) {
    room?.leave(true)
    return true
  }
  if (!room) return false
  attachRoom(room, identity, Callbacks, endpoint, gen)
  return true
}

/**
 * Connects `identity` ({ id, name }) to a lobby. `lobby.mode` is 'public' (matchmade,
 * the default), 'private' (a new private lobby), 'join' (with `lobby.code`) or
 * 'rejoin' (the identity changed mid-game: back into the same room by id, else
 * matchmade). A launch `?roomId=` is tried first on the first connection. Falls back to
 * offline play when no server is reachable.
 */
export async function startConnection(identity, lobby = { mode: 'public' }) {
  const gen = ++generation
  lastIdentity = identity
  stopConnection()
  const target = serverTarget()
  if (!target) {
    startLocal(identity, null)
    return
  }

  getGame().setNet({ mode: 'connecting', message: 'Connecting…' })
  // Loaded on demand: offline play never downloads the networking code, and online play
  // fetches it in parallel with the lobby rather than in front of it.
  const { Client, Callbacks } = await import('@colyseus/sdk')
  if (gen !== generation) return

  if (await joinSpecificRoom(gen, identity, target, lobby, Client, Callbacks)) return
  if (gen !== generation) return
  const fallback = lobby.mode === 'rejoin' ? { mode: 'public' } : lobby

  if (target.kind === 'matchmaker') {
    await joinThroughMatchmaker(gen, identity, target.gameId, fallback, Client, Callbacks)
    return
  }
  const url = target.kind === 'dev' ? await findDevServer() : (await healthOf(target.url)) && target.url
  if (gen !== generation) return
  if (!url) {
    startLocal(identity, 'Server unreachable - playing offline')
    return
  }

  const client = new Client(url)
  for (let attempt = 0; attempt <= JOIN_RETRIES; attempt += 1) {
    try {
      // After a failed private/join attempt, fall back to a public lobby.
      const room = await join(client, joinOptions(identity), attempt === 0 ? fallback : { mode: 'public' })
      if (gen !== generation) {
        room.leave(true)
        return
      }
      attachRoom(room, identity, Callbacks, url, gen)
      return
    } catch (err) {
      if (gen !== generation) return
      console.warn('[net] join failed', err)
      if (attempt >= 1) getGame().setNet({ mode: 'connecting', message: 'Server full, retrying…' })
      await wait(attempt === 0 ? 300 : RETRY_DELAY_MS)
      if (gen !== generation) return
    }
  }
  startLocal(identity, 'Could not join a lobby - playing offline')
}

/**
 * Hosted on Bloxity Legion: every attempt asks the matchmaker for a seat (it picks a
 * pod with room, or cold-starts one), then joins the endpoint it returns with a NEW
 * Client - each endpoint is pinned to one pod. Retries with backoff for up to a
 * minute, then plays offline.
 *
 * The SDK script is loaded (synchronously, in index.html) before this runs: it tags
 * matchmaker requests with the player's Boxity party, so friends land together.
 */
async function joinThroughMatchmaker(gen, identity, gameId, lobby, Client, Callbacks) {
  const started = performance.now()
  const sdk = await waitForSDK().catch(() => null)
  if (gen !== generation) return
  if (!sdk?.net?.resolveEndpoint) {
    startLocal(identity, 'Server unreachable - playing offline')
    return
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { endpoint } = await sdk.net.resolveEndpoint(gameId)
      if (gen !== generation) return
      const room = await join(new Client(endpoint), joinOptions(identity), attempt === 0 ? lobby : { mode: 'public' })
      if (gen !== generation) {
        room.leave(true)
        return
      }
      attachRoom(room, identity, Callbacks, endpoint, gen)
      return
    } catch (err) {
      if (gen !== generation) return
      console.warn('[net] matchmaker join failed', err)
      if (performance.now() - started > MATCHMAKER_GIVE_UP_MS) break
      getGame().setNet({ mode: 'connecting', message: attempt === 0 ? 'Starting a server…' : 'Still connecting…' })
      await wait(MATCHMAKER_BACKOFF_MS[Math.min(attempt, MATCHMAKER_BACKOFF_MS.length - 1)])
      if (gen !== generation) return
    }
  }
  startLocal(identity, 'Could not reach the game server - playing offline')
}

/** Takes the game back after another window of the same account replaced this one. */
export function playHere() {
  if (lastIdentity) startConnection(lastIdentity)
}

/** Moves to another lobby with the same identity (from the lobby panel). */
export function switchLobby(lobby) {
  if (lastIdentity) startConnection(lastIdentity, lobby)
}

export function isOnline() {
  return active?.kind === 'online'
}

/** The Colyseus id of the room we're playing in, or null (offline / connecting). */
export function currentRoomId() {
  return active?.kind === 'online' ? active.room.roomId : null
}

export function stopConnection() {
  if (!active) return
  setTransport(null)
  active.close()
  active = null
  sdkGame('updateRoom', '')
}
