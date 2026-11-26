import { GameHost } from '@shared/host'
import { normalizeProfile } from '@shared/logic'
import { PlayerSession } from '@shared/session'

/**
 * The offline game's authority, off the main thread: the same GameHost (rounds, bots,
 * rules) and PlayerSession (profile) the Colyseus room runs. Bots think, projectiles
 * fly and the lava rises here, so on a slow phone the frame rate only pays for drawing.
 *
 * Protocol (postMessage):
 *   in:  { init: { id, name, save } } once, then { type, payload } for every action
 *   out: { type, payload } for every host event, and { save: profile } now and then
 */

const CID = 'local'
const SAVE_MS = 5000
const SESSION_MESSAGES = new Set(['openCase', 'equip', 'claimDaily', 'welcomeGift', 'tutorialDone'])

let host = null
let session = null
let profile = null

const emit = (type, payload) => self.postMessage({ type, payload })
const save = () => {
  if (!profile) return
  profile.lastSeen = Date.now()
  self.postMessage({ save: profile })
}

function start({ id, name, save: stored }) {
  profile = normalizeProfile(stored, id, name)
  session = new PlayerSession(profile, { now: Date.now(), emit, onLook: (look) => host?.setLook(CID, look) })
  host = new GameHost({
    send: (_cid, type, payload) => emit(type, payload),
    onReward: (_cid, result) => {
      session.awardRound(result)
      save()
    },
  })
  session.sendProfile()
  host.join(CID, name, session.look())
  let last = performance.now()
  setInterval(() => {
    const t = performance.now()
    const dt = Math.min(0.25, (t - last) / 1000)
    last = t
    host.tick(dt)
    session.tick(dt)
  }, 1000 / GameHost.SIM_HZ)
  setInterval(save, SAVE_MS)
}

self.onmessage = (e) => {
  const msg = e.data
  if (msg.init) {
    start(msg.init)
    return
  }
  if (!host) return
  const { type, payload } = msg
  if (type === 'saveNow') return save()
  if (type === 'leave') {
    host.leave(CID)
    save()
    return
  }
  // Offline there is no server to check Boxity's word, so the two platform grants are
  // taken here (only bloxity/services.js sends them, after Boxity confirmed).
  if (type === 'adReward') {
    if (typeof payload?.placement === 'string') session.grantAdReward(payload.placement, Date.now())
    return save()
  }
  if (type === 'gemsLocal') {
    if (typeof payload?.sku === 'string') session.grantGemProduct(payload.sku)
    return save()
  }
  if (SESSION_MESSAGES.has(type)) {
    session.handle(type, payload || {}, Date.now())
    return save()
  }
  host.message(CID, type, payload || {})
}
