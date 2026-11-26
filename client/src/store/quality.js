import { create } from 'zustand'

/**
 * Graphics quality presets. Every visual feature reads its settings from here rather
 * than deciding for itself, so dropping a preset reliably sheds load everywhere.
 *
 * LOW is the mobile / weak-PC baseline: no particles or sparkles, no post-processing,
 * a short view distance and textures capped at 512px. No preset uses realtime shadows:
 * the blocks' shading is baked into their vertices.
 */
export const QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH']

export const PRESETS = {
  LOW: {
    dpr: 1,
    antialias: false,
    /** No realtime shadows on any preset: terrain shading is baked into the blocks. */
    shadows: 'none',
    particles: false,
    /** Sparkles over lucky blocks. */
    sparkles: false,
    viewDistance: 130,
    fogNear: 45,
    cloudCount: 10,
    /** Max side of any generated texture. */
    maxTexture: 512,
    /** Other players drawn this far; names shown this far. */
    remoteDrawDistance: 110,
    /**
     * Characters drawn as their Bloxity avatar (you included; real players first, then
     * the nearest); the rest blocky. A round has at most 8 fighters, so even on LOW
     * everyone you can see is their avatar, near or far.
     */
    avatarCount: 8,
    botAvatars: true,
    /** No avatar beyond this (blocks): as far as other players are drawn at all. */
    avatarDistance: 110,
    /** Avatars are posed every frame within this, every other frame within the next, then every third. */
    avatarPoseFull: 12,
    avatarPoseHalf: 30,
    remoteNameDistance: 30,
    labelDistance: 50,
  },
  MEDIUM: {
    dpr: 1.25,
    antialias: true,
    shadows: 'none',
    particles: true,
    sparkles: true,
    viewDistance: 180,
    fogNear: 70,
    cloudCount: 18,
    maxTexture: 1024,
    remoteDrawDistance: 150,
    avatarCount: 10,
    botAvatars: true,
    avatarDistance: 150,
    avatarPoseFull: 22,
    avatarPoseHalf: 60,
    remoteNameDistance: 45,
    labelDistance: 70,
  },
  HIGH: {
    dpr: 1.5,
    antialias: true,
    shadows: 'none',
    particles: true,
    sparkles: true,
    viewDistance: 240,
    fogNear: 100,
    cloudCount: 26,
    maxTexture: 1024,
    remoteDrawDistance: 200,
    avatarCount: 12,
    botAvatars: true,
    avatarDistance: 200,
    avatarPoseFull: 30,
    avatarPoseHalf: 80,
    remoteNameDistance: 60,
    labelDistance: 90,
  },
}

const STORAGE_KEY = 'pp.quality'

/**
 * Resolution steps, as a fraction of the preset's pixel ratio. Below LOW, a weak PC or
 * phone still under 45 FPS renders fewer pixels: the scene is the same, only softer.
 * Shading every pixel is what an integrated GPU runs out of first, so this is the
 * biggest single saving there is.
 */
export const RENDER_SCALES = [1, 0.85, 0.7, 0.6]

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true
  // iPadOS reports itself as a Mac; touch points give it away.
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)
}

function readSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return QUALITY_LEVELS.includes(saved) ? saved : null
  } catch {
    return null
  }
}

/**
 * Phones and small CPUs (4 cores or fewer) start on LOW, the safe choice; anything bigger
 * starts on MEDIUM, and the performance monitor drops it to LOW by itself if FPS stays
 * under 45 (`degrade`, auto-picked levels only). A level picked in Settings is
 * remembered on this device and wins over both.
 */
export const DEFAULT_LEVEL = 'LOW'

function detectLevel() {
  if (typeof navigator === 'undefined') return DEFAULT_LEVEL
  const cores = navigator.hardwareConcurrency || 0
  return isMobileDevice() || cores <= 4 ? 'LOW' : 'MEDIUM'
}

const initialLevel = readSaved() || detectLevel()

export const useQuality = create((set, get) => ({
  level: initialLevel,
  /** True when the player picked the level by hand; auto-drop then stays out of it. */
  manual: readSaved() !== null,
  isMobile: isMobileDevice(),
  /** Antialiasing can't change without recreating the WebGL context (see `rebuild`). */
  antialias: PRESETS[initialLevel].antialias,
  settings: PRESETS[initialLevel],
  /**
   * Bumped when the player picks a new level by hand: the 3D view is rebuilt from
   * scratch, so things set when it's made (antialiasing)
   * take the new level at once.
   */
  rebuild: 0,
  /** Index into RENDER_SCALES: how far resolution has been dropped to keep FPS up. */
  renderStep: 0,

  setLevel: (level, manual = true) => {
    if (!QUALITY_LEVELS.includes(level)) return
    if (manual) {
      try {
        localStorage.setItem(STORAGE_KEY, level)
      } catch {
        // Private mode: the choice just won't persist.
      }
    }
    const changed = level !== get().level
    set((s) => ({
      level,
      manual,
      settings: PRESETS[level],
      ...(manual && changed ? { antialias: PRESETS[level].antialias, rebuild: s.rebuild + 1 } : {}),
    }))
  },

  /**
   * Called by the performance monitor when FPS stays under budget: drops a preset if it
   * can (not one the player picked by hand), and once on LOW (or a hand-picked level),
   * renders at a lower resolution instead, a step at a time.
   */
  degrade: () => {
    const { level, manual, renderStep } = get()
    const index = QUALITY_LEVELS.indexOf(level)
    if (!manual && index > 0) {
      const next = QUALITY_LEVELS[index - 1]
      console.info(`[quality] FPS under budget, dropping ${level} -> ${next}`)
      set({ level: next, settings: PRESETS[next] })
      return
    }
    if (renderStep + 1 < RENDER_SCALES.length) {
      console.info(`[quality] FPS under budget, rendering at ${RENDER_SCALES[renderStep + 1] * 100}%`)
      set({ renderStep: renderStep + 1 })
    }
  },

  /** Called when FPS has plenty of headroom again: resolution comes back a step. */
  recover: () => {
    const { renderStep } = get()
    if (renderStep > 0) set({ renderStep: renderStep - 1 })
  },
}))

/** Non-reactive read, safe inside useFrame. */
export const getQuality = () => useQuality.getState().settings
