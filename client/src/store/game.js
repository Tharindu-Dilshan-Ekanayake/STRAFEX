import { create } from 'zustand'

import { createProfile, createSession } from '@shared/logic'

/**
 * Everything the UI renders from. Written by the network layer and a few slow timers -
 * never from a frame loop. Components select narrowly (`useGame((s) => s.me.hp)`).
 */

const SETTINGS_KEY = 'lsb.settings'
const DEFAULT_SETTINGS = { sensitivity: 1, fov: 75, invertY: false, camera: 'first', showFps: false }

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let toastId = 0

/** The mode or map vote is on screen (in the lobby, waiting for players or voting). */
export function voteOnScreen(phase, zone) {
  if (zone !== 'lobby' || phase.afk) return false
  return phase.phase === 'waiting' || (phase.phase === 'intermission' && phase.voteStage !== 'wait')
}

export const useGame = create((set, get) => ({
  profile: createProfile('local', 'Player'),
  session: createSession(Date.now()),
  profileLoaded: false,
  playable: false,

  net: { mode: 'connecting', lobbyId: null, code: null, isPrivate: false, players: 1, maxPlayers: 8, message: null },
  leaderboards: null,

  /** The round: phase, when it ends (performance.now() time), mode, votes. */
  phase: { phase: 'waiting', endsAt: 0, mode: null, map: null, alive: 0, fighters: 0, votes: {}, myVote: null, afk: false, waitingFor: 0 },
  /** 'lobby' | 'match' | 'spec' */
  zone: 'lobby',
  /** Our health, hotbar and effects in a round. */
  me: { hp: 20, maxHp: 20, inv: [], sel: 0, effects: {}, alive: false, kills: 0 },
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
  /** The last lucky block result: { text, items, rare, bad, id }. */
  loot: null,
  /** End of your round: { kind: 'dead' | 'win' | 'lost', by, placement, reward }. */
  result: null,
  /** Round cash just earned, shown on the result card. */
  roundReward: null,
  /** A case being opened: { caseId, id, kind, duplicate, refund, gift }. */
  caseOpen: null,
  /** The lobby station in reach: 'case:cape' | 'case:sword' | null. */
  prompt: null,
  /** First-round tutorial step: 0 break a lucky block, 1 select blocks, 2 bridge to the middle, 3 done. */
  tutorial: 0,
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
  setTutorial: (tutorial) => {
    if (tutorial > get().tutorial) set({ tutorial })
  },
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
  setLoot: (loot) => set({ loot: loot ? { ...loot, id: ++toastId } : null }),
  setResult: (result) => set({ result }),
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
