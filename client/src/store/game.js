import { create } from 'zustand'

import { createProfile, createSession } from '@shared/logic'

/**
 * Everything the UI renders from. Written by the network layer and a few slow timers -
 * never from a frame loop. Components select narrowly (`useGame((s) => s.me.hp)`).
 */

const SETTINGS_KEY = 'strafex.settings'
const DEFAULT_SETTINGS = { sensitivity: 1, fov: 75, invertY: false, camera: 'first', showFps: false }

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let toastId = 0

export const useGame = create((set, get) => ({
  profile: createProfile('local', 'Player'),
  session: createSession(Date.now()),
  profileLoaded: false,
  playable: false,

  net: { mode: 'connecting', lobbyId: null, code: null, isPrivate: false, players: 1, maxPlayers: 30, message: null, ping: 0 },
  leaderboards: null,

  /**
   * Where you are in the flow, from the host: `kind` 'lobby' (with your queue and who's
   * searching), 'duel' (vote / countdown / fight / between / ended, round, score) or
   * 'ffa'; `endsAt` is when the current step ends (performance.now() time).
   */
  phase: { kind: 'lobby', phase: 'lobby', endsAt: 0, queue: null, queuedMs: 0, searching: {}, playing: {}, ffa: 0, online: 1 },
  /** 'lobby' | 'match' | 'spec' */
  zone: 'lobby',
  /** Our health, armour, hotbar, effects and combat stats in a fight. */
  me: { hp: 20, maxHp: 20, absorb: 0, inv: [], sel: 0, effects: {}, alive: false, kills: 0, armor: { tier: 'none', dura: [0, 0, 0, 0] }, kit: null, stats: { hits: 0, taken: 0, dealt: 0, dmgTaken: 0, combo: 0, best: 0 }, shieldOff: 0 },
  /** eid -> { eid, name, bot, cape, sword, zone, alive, kills } */
  roster: {},
  /** Kill feed, newest first: { id, k, v, how }. */
  feed: [],
  toasts: [],
  /** Your last elimination: { name, streak, cash, id }. */
  killBanner: null,
  /** The quick chat picker is open. */
  quickChat: false,
  /** Touch controls are showing (the HUD uses the compact touch layout). */
  touchUI: false,
  /** `{ ups: [{ level, cash, case? }], id }` right after levelling up. */
  levelUp: null,
  /** Big text in the middle of the screen: `{ text, sub, color, id }` (ROUND 2, FIGHT, round won). */
  banner: null,
  /** Knocked out: `{ kind: 'dead', by, how, mode: 'duel' | 'ffa' }`. */
  result: null,
  /** A duel is over: `{ win, winner, score, forfeit, mode }`. */
  duelOver: null,
  /** Your stats from the last duel (hits, combo...), shown on its result card. */
  duelStats: null,
  /** Cash and XP just earned, shown on the result card. */
  roundReward: null,
  /** A case being opened: { caseId, id, kind, duplicate, refund, gift }. */
  caseOpen: null,
  /** The lobby station in reach: 'duels' | 'ffa' | 'case:cape' | 'case:sword' | null. */
  prompt: null,
  pointerLocked: false,
  panel: null,
  panelData: null,
  settings: readSettings(),
  /** Spectating whom (name), for the bar. */
  spectating: null,

  setProfile: (profile, session) => set((s) => ({ profile, session: session || s.session, profileLoaded: true })),
  setNet: (patch) => set((s) => ({ net: { ...s.net, ...patch } })),
  setPlayable: () => set({ playable: true }),
  setLeaderboards: (leaderboards) => set({ leaderboards }),
  setPhase: (phase) => set({ phase }),
  setZone: (zone) => set({ zone }),
  setMe: (me) => set({ me }),
  setRoster: (roster) => set({ roster }),
  setPrompt: (prompt) => {
    if (get().prompt !== prompt) set({ prompt })
  },
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setSpectating: (spectating) => {
    if (get().spectating !== spectating) set({ spectating })
  },
  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Not persisted.
    }
    set({ settings })
  },

  addFeed: (entry) => set((s) => ({ feed: [{ ...entry, id: ++toastId, at: Date.now() }, ...s.feed].slice(0, 5) })),
  pruneFeed: () => {
    const now = Date.now()
    const feed = get().feed.filter((f) => now - f.at < 7000)
    if (feed.length !== get().feed.length) set({ feed })
  },
  /** kind: 'info' | 'success' | 'error' | 'kill' */
  showToast: (text, kind = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  },
  setKillBanner: (killBanner) => set({ killBanner: killBanner ? { ...killBanner, id: ++toastId } : null }),
  setBanner: (banner) => set({ banner: banner ? { ...banner, id: ++toastId } : null }),
  setResult: (result) => set({ result }),
  setDuelOver: (duelOver) => set({ duelOver }),
  setDuelStats: (duelStats) => set({ duelStats }),
  setRoundReward: (roundReward) => set({ roundReward }),
  setQuickChat: (quickChat) => set({ quickChat }),
  setTouchUI: (touchUI) => {
    if (get().touchUI !== touchUI) set({ touchUI })
  },
  setLevelUp: (levelUp) => set({ levelUp: levelUp ? { ...levelUp, id: ++toastId } : null }),
  setCaseOpen: (caseOpen) => set({ caseOpen }),

  openPanel: (panel, panelData = null) => set({ panel, panelData }),
  closePanel: () => set({ panel: null, panelData: null }),
  togglePanel: (panel) => set((s) => (s.panel === panel ? { panel: null, panelData: null } : { panel, panelData: null })),
}))

/** Non-reactive snapshot for timers and non-React code. */
export const getGame = () => useGame.getState()
