
const SAVE_KEY = 'lsb.save.v1'
const SAVE_MS = 5000
const CID = 'local'

function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')
  } catch {
    return null
  }
}

function store(profile) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(profile))
  } catch {
    // Storage full or blocked: progress just won't persist this session.
  }
}

/**
 * Offline stand-in for the game server: the same GameHost (rounds, bots, rules) and
 * PlayerSession (profile) the Colyseus room runs, with the save in localStorage. Used
 * when no server is configured or reachable, so the game always plays - bots fill the
 * islands.
 *
 * It runs in a Web Worker (hostWorker.js), so the bots' thinking never costs a frame;
 * where workers aren't available, in this thread instead.
 *
 * @param {{ id: string, name: string, onEvent: (type: string, payload: object) => void }} options
 * @returns {{ send: (type: string, payload?: object) => void, close: () => void }}
 */
export function createLocalServer(options) {
  if (typeof Worker !== 'undefined') {
    try {
      return createWorkerServer(options)
    } catch (err) {
      console.warn('[offline] worker unavailable, running the host in this thread', err)
    }
  }
  return createInlineServer(options)
}

/**
 * The in-thread fallback, its host loaded on demand (it's a big module, and almost
 * every browser has workers): messages sent before it's ready are queued.
 */
function createInlineServer(options) {
  const queue = []
  let real = null
  let closed = false
  Promise.all([import('@shared/host'), import('@shared/logic'), import('@shared/session')]).then(([{ GameHost }, { normalizeProfile }, { PlayerSession }]) => {
    if (closed) return
    real = startInline(options, { GameHost, normalizeProfile, PlayerSession })
    for (const [type, payload] of queue) real.send(type, payload)
    queue.length = 0
  })
  return {
    send(type, payload) {
      if (real) real.send(type, payload)
      else queue.push([type, payload])
    },
    close() {
      closed = true
      real?.close()
    },
  }
}

function createWorkerServer({ id, name, onEvent }) {
  const worker = new Worker(new URL('./hostWorker.js', import.meta.url), { type: 'module' })
  let lastSave = null
  worker.onmessage = (e) => {
    const msg = e.data
    if (msg.save) {
      lastSave = msg.save
      store(msg.save)
      return
    }
    onEvent(msg.type, msg.payload)
  }
  worker.postMessage({ init: { id, name, save: loadSave() } })
  // Leaving the page: write the last save we have (the worker can't touch storage).
  const onHide = () => {
    if (document.visibilityState === 'hidden') worker.postMessage({ type: 'saveNow' })
  }
  const onUnload = () => lastSave && store(lastSave)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('beforeunload', onUnload)
  return {
    send: (type, payload) => worker.postMessage({ type, payload }),
    close() {
      worker.postMessage({ type: 'leave' })
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
      // Give the worker a moment to send its final save.
      setTimeout(() => worker.terminate(), 300)
    },
  }
}

/** Host messages that carry live objects the host keeps mutating: the UI gets a copy. */
const COPY = new Set(['me', 'roster', 'phase', 'profile', 'loot', 'match', 'caseResult', 'roundReward'])

function startInline({ id, name, onEvent }, { GameHost, normalizeProfile, PlayerSession }) {
  const profile = normalizeProfile(loadSave(), id, name)
  const emit = (type, payload) => onEvent(type, payload && COPY.has(type) ? structuredClone(payload) : payload)

  let host = null
  const session = new PlayerSession(profile, {
    now: Date.now(),
    emit,
    onLook: (look) => host?.setLook(CID, look),
  })
  const save = () => {
    profile.lastSeen = Date.now()
    store(profile)
  }
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
  const tickId = setInterval(() => {
    const t = performance.now()
    const dt = Math.min(0.25, (t - last) / 1000)
    last = t
    host.tick(dt)
    session.tick(dt)
  }, 1000 / GameHost.SIM_HZ)
  const saveId = setInterval(save, SAVE_MS)
  const onHide = () => {
    if (document.visibilityState === 'hidden') save()
  }
  window.addEventListener('beforeunload', save)
  document.addEventListener('visibilitychange', onHide)

  return {
    send(type, payload) {
      if (type === 'adReward') {
        if (typeof payload?.placement === 'string') session.grantAdReward(payload.placement, Date.now())
        save()
        return
      }
      if (type === 'gemsLocal') {
        if (typeof payload?.sku === 'string') session.grantGemProduct(payload.sku)
        save()
        return
      }
      if (['openCase', 'equip', 'claimDaily', 'welcomeGift', 'tutorialDone'].includes(type)) {
        session.handle(type, payload || {}, Date.now())
        save()
        return
      }
      host.message(CID, type, payload || {})
    },
    close() {
      clearInterval(tickId)
      clearInterval(saveId)
      window.removeEventListener('beforeunload', save)
      document.removeEventListener('visibilitychange', onHide)
      host.leave(CID)
      save()
    },
  }
}
