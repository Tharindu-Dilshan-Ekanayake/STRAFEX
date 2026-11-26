import { B } from '@shared/voxel'

import { createMusic } from './music'

/**
 * Sound effects and the background music, synthesised with WebAudio: no audio files to
 * download.
 *
 * Browsers only allow audio after a user gesture. The engine (AudioContext, echo, noise,
 * music) is built while the game loads (prepareAudio) and starts suspended; the first
 * tap/click/key resumes it and starts the music. Every sound before that is skipped.
 */

const MUTE_KEY = 'pp.muted'
const BASE_GAIN = 0.5

let ctx = null
let master = null
let echo = null
let noiseBuffer = null
let music = null
let muted = readMuted()
/** Muted for a Boxity ad break; kept apart from `muted` so the break restores your choice. */
let adMuted = false
let masterVolume = 1
let musicVolume = 1
const lastPlayed = new Map()
const muteListeners = new Set()

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

const silent = () => muted || adMuted

function applyMaster() {
  if (master) master.gain.value = silent() ? 0 : BASE_GAIN * masterVolume
}

/** Builds the audio engine, suspended. Safe to call again. */
export function prepareAudio() {
  if (ctx) return
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return
  ctx = new Ctor()
  if (ctx.state === 'running') ctx.suspend()
  master = ctx.createGain()
  applyMaster()
  master.connect(ctx.destination)
  echo = createEcho()
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  music = createMusic(ctx, master, noiseBuffer)
  music.setVolume(musicVolume)
}

let musicStarted = false
function unlock() {
  prepareAudio()
  if (!ctx) return
  if (!musicStarted) {
    musicStarted = true
    music.start()
  }
  if (adMuted) ctx.suspend()
  else if (ctx.state === 'suspended') ctx.resume()
}

function createEcho() {
  const input = ctx.createGain()
  input.gain.value = 0.22
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.12
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 3000
  const feedback = ctx.createGain()
  feedback.gain.value = 0.3
  input.connect(delay)
  delay.connect(damp).connect(feedback).connect(delay)
  damp.connect(master)
  return input
}

/** Installs the first-gesture unlock. Call once at startup. */
export function installAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchend']
  const handler = () => {
    unlock()
    for (const e of events) window.removeEventListener(e, handler, true)
  }
  for (const e of events) window.addEventListener(e, handler, true)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended' && !adMuted && musicStarted) ctx.resume()
  })
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // Not persisted.
  }
  applyMaster()
  for (const listener of muteListeners) listener(muted)
}

const clampVolume = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

export function setMasterVolume(volume) {
  masterVolume = clampVolume(volume)
  applyMaster()
}

export function setMusicVolume(volume) {
  musicVolume = clampVolume(volume)
  music?.setVolume(musicVolume)
}

export function setAdBreakMuted(on) {
  adMuted = Boolean(on)
  applyMaster()
  if (!ctx) return
  if (adMuted) ctx.suspend()
  else if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume()
}

/** 'lobby' | 'match' | 'tense': the music changes on its next bar. */
export function setMusicMood(mood) {
  music?.setMood(mood)
}

// --- Ambience: wind over the lobby, the lava's rumble and bubbles in a round ---------------

let amb = null
let bubbleTimer = null
let ambLevel = 0
let ambKind = 'none'

function ensureAmbience() {
  if (amb || !ctx) return amb
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400
  filter.Q.value = 0.7
  const gain = ctx.createGain()
  gain.gain.value = 0
  // A slow swell, so it breathes instead of hissing.
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.13
  const depth = ctx.createGain()
  depth.gain.value = 0
  lfo.connect(depth).connect(gain.gain)
  src.connect(filter).connect(gain).connect(master)
  src.start()
  lfo.start()
  amb = { filter, gain, depth }
  return amb
}

/**
 * `kind`: 'wind' (the lobby, high up in the open), 'lava' (a round: the closer the lava,
 * the louder its rumble and the more it bubbles), 'none'. `level` 0..1. Called ~10 Hz.
 */
export function setAmbience(kind, level) {
  if (!ctx || ctx.state !== 'running') return
  const a = ensureAmbience()
  if (!a) return
  const l = Math.max(0, Math.min(1, level))
  const t = ctx.currentTime
  if (kind !== ambKind) {
    ambKind = kind
    a.filter.type = kind === 'wind' ? 'bandpass' : 'lowpass'
    a.filter.frequency.setTargetAtTime(kind === 'wind' ? 520 : 170, t, 0.5)
  }
  const target = kind === 'none' ? 0 : kind === 'wind' ? 0.02 * l : 0.06 * l
  a.gain.gain.setTargetAtTime(target, t, 0.6)
  a.depth.gain.setTargetAtTime(target * 0.6, t, 0.6)
  ambLevel = kind === 'lava' ? l : 0
  if (!bubbleTimer) {
    bubbleTimer = setInterval(() => {
      if (ambLevel > 0.25 && !silent() && ctx.state === 'running' && Math.random() < ambLevel * 0.7) {
        const f = 90 + Math.random() * 120
        tone(f, { type: 'sine', duration: 0.12, volume: 0.05 * ambLevel, slideTo: f * 2.6 })
      }
    }, 450)
  }
}

/** What a block sounds like: 'soft' | 'stone' | 'wood' | 'cloth' | 'glass' | 'lucky'. */
const MATERIAL = new Map()
for (const id of [B.GRASS, B.DIRT, B.LEAVES, B.SAND, B.SNOW_GRASS, B.SNOW, B.PATH, B.FROSTING, B.CANDY_PINK, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.CACTUS]) MATERIAL.set(id, 'soft')
for (const id of [B.PLANKS, B.LOG, B.TNT]) MATERIAL.set(id, 'wood')
for (const id of [B.WOOL_WHITE, B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW]) MATERIAL.set(id, 'cloth')
for (const id of [B.GLASS, B.ICE, B.CAGE, B.CRYSTAL]) MATERIAL.set(id, 'glass')
for (const id of [B.LUCKY, B.LUCKY_RARE]) MATERIAL.set(id, 'lucky')
export const materialOf = (id) => MATERIAL.get(id) || 'stone'

export function onMutedChange(listener) {
  muteListeners.add(listener)
  return () => muteListeners.delete(listener)
}

// --- Building blocks ----------------------------------------------------------------------

function ready(name, minGapMs = 0) {
  if (!ctx || silent() || ctx.state !== 'running') return false
  const now = performance.now()
  if (minGapMs && now - (lastPlayed.get(name) || 0) < minGapMs) return false
  lastPlayed.set(name, now)
  return true
}

const LEAD = 0.06
/** Runs `build(t)` for a sound due `at` s from now: at once if soon, else just before. */
function whenDue(at, build) {
  const due = ctx.currentTime + at
  if (at <= LEAD) {
    build(due)
    return
  }
  setTimeout(() => {
    if (ctx) build(Math.max(ctx.currentTime, due))
  }, (at - LEAD) * 1000)
}

function tone(freq, opts = {}) {
  whenDue(opts.at ?? 0, (t) => toneAt(freq, t, opts))
}

function toneAt(freq, t, { type = 'square', duration = 0.12, volume = 0.2, slideTo = null, attack = 0.005, echo: wet = false } = {}) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(master)
  if (wet) gain.connect(echo)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

function noise(opts = {}) {
  whenDue(opts.at ?? 0, (t) => noiseAt(t, opts))
}

function noiseAt(t, { duration = 0.2, volume = 0.2, from = 800, to = 300, q = 1, type = 'bandpass' } = {}) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(Math.max(0.0002, volume), t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(gain).connect(master)
  src.loop = true
  src.start(t, Math.random() * 0.5)
  src.stop(t + duration + 0.02)
}

/** An arpeggio of chiptune notes (semitones above `base`), `step` s apart. */
function arp(base, semis, { step = 0.06, type = 'square', volume = 0.08, duration = 0.12, echo: wet = true } = {}) {
  semis.forEach((s, i) => tone(base * 2 ** (s / 12), { at: i * step, type, volume, duration, echo: wet }))
}

// --- The sounds -----------------------------------------------------------------------

export const sfx = {
  click() {
    if (!ready('click', 40)) return
    tone(740, { type: 'triangle', duration: 0.05, volume: 0.08 })
    tone(1480, { at: 0.03, type: 'sine', duration: 0.06, volume: 0.04 })
  },
  select() {
    if (ready('select', 30)) tone(1200, { type: 'triangle', duration: 0.03, volume: 0.06 })
  },
  step(soft = 1, material = 'soft') {
    if (!ready('step', 120)) return
    const k = { soft: [700, 250, 0.06], stone: [2200, 900, 0.05], wood: [900, 400, 0.06], cloth: [500, 200, 0.04], glass: [3000, 1500, 0.04], lucky: [1500, 700, 0.05] }[material] || [900, 300, 0.05]
    noise({ duration: 0.05, volume: k[2] * soft, from: k[0], to: k[1], q: 1.4 })
  },
  hover() {
    if (ready('hover', 60)) tone(1320, { type: 'sine', duration: 0.03, volume: 0.025 })
  },
  go() {
    if (!ready('go', 800)) return
    tone(784, { type: 'square', duration: 0.1, volume: 0.06 })
    tone(1175, { at: 0.09, type: 'square', duration: 0.12, volume: 0.06 })
    tone(1568, { at: 0.18, type: 'triangle', duration: 0.35, volume: 0.07, echo: true })
  },
  countdown(n) {
    if (ready('countdown', 300)) tone(n <= 1 ? 1175 : 880, { type: 'square', duration: 0.09, volume: 0.07, echo: true })
  },
  land() {
    if (ready('land', 150)) noise({ duration: 0.1, volume: 0.12, from: 500, to: 120 })
  },
  dig() {
    if (ready('dig', 160)) noise({ duration: 0.07, volume: 0.09, from: 1400, to: 500, q: 2 })
  },
  breakBlock(level = 1, material = 'stone') {
    if (!ready('break', 50)) return
    if (material === 'glass') {
      for (let i = 0; i < 4; i += 1) tone(2200 + Math.random() * 1800, { at: i * 0.03, type: 'triangle', duration: 0.12, volume: 0.05 * level, echo: true })
      noise({ duration: 0.25, volume: 0.15 * level, from: 6000, to: 2500, q: 1 })
      return
    }
    const k = { soft: [900, 150, 0.2, 110], stone: [2600, 400, 0.22, 180], wood: [1200, 250, 0.22, 150], cloth: [600, 150, 0.16, 90], lucky: [2000, 600, 0.2, 240] }[material] || [1600, 200, 0.22, 140]
    noise({ duration: 0.18, volume: k[2] * level, from: k[0], to: k[1], q: 1.4 })
    tone(k[3], { type: 'triangle', duration: 0.08, volume: 0.08 * level, slideTo: k[3] / 2 })
  },
  place(material = 'stone') {
    if (!ready('place', 60)) return
    const k = { soft: [600, 200, 150], stone: [1500, 600, 260], wood: [900, 350, 200], cloth: [450, 180, 140], glass: [2500, 1200, 520] }[material] || [700, 250, 220]
    noise({ duration: 0.08, volume: 0.16, from: k[0], to: k[1], q: 2 })
    tone(k[2], { type: 'triangle', duration: 0.05, volume: 0.06, slideTo: k[2] * 0.7 })
  },
  swing() {
    if (ready('swing', 90)) noise({ duration: 0.12, volume: 0.06, from: 2500, to: 700, q: 3 })
  },
  hit(level = 1) {
    if (!ready('hit', 60) || level <= 0.02) return
    noise({ duration: 0.09, volume: 0.25 * level, from: 1800, to: 400, q: 1.5 })
    tone(180, { type: 'square', duration: 0.07, volume: 0.1 * level, slideTo: 90 })
  },
  hurt() {
    if (!ready('hurt', 120)) return
    tone(420, { type: 'square', duration: 0.12, volume: 0.14, slideTo: 200 })
    noise({ duration: 0.1, volume: 0.18, from: 1200, to: 300 })
  },
  lucky(rare = false) {
    if (!ready('lucky', 100)) return
    noise({ duration: 0.25, volume: 0.18, from: 3000, to: 600, q: 0.8 })
    arp(rare ? 659 : 523, rare ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12, 16], { step: 0.055, volume: 0.07 })
  },
  unlucky() {
    if (!ready('unlucky', 150)) return
    arp(392, [0, -1, -5, -12], { step: 0.1, volume: 0.08, type: 'sawtooth' })
  },
  pop(level = 1) {
    if (ready('pop', 80)) tone(900, { type: 'square', duration: 0.08, volume: 0.06 * level, slideTo: 1600 })
  },
  fuse(level = 1) {
    if (ready('fuse', 200)) noise({ duration: 0.8, volume: 0.07 * level, from: 4000, to: 3000, q: 4, type: 'highpass' })
  },
  boom(level = 1) {
    if (!ready('boom', 60)) return
    noise({ duration: 0.9, volume: 0.5 * level, from: 900, to: 40, q: 0.7, type: 'lowpass' })
    tone(80, { type: 'sine', duration: 0.6, volume: 0.3 * level, slideTo: 30 })
  },
  zap(level = 1) {
    if (!ready('zap', 100)) return
    noise({ duration: 0.5, volume: 0.35 * level, from: 6000, to: 200, q: 0.5 })
    tone(1600, { type: 'sawtooth', duration: 0.2, volume: 0.06 * level, slideTo: 60 })
  },
  bow() {
    if (!ready('bow', 80)) return
    tone(300, { type: 'triangle', duration: 0.12, volume: 0.12, slideTo: 900 })
    noise({ duration: 0.15, volume: 0.08, from: 3000, to: 1200, q: 2 })
  },
  throw(level = 1) {
    if (ready('throw', 80)) noise({ duration: 0.15, volume: 0.1 * level, from: 1200, to: 3000, q: 2 })
  },
  eat() {
    if (!ready('eat', 120)) return
    for (let i = 0; i < 3; i += 1) noise({ at: i * 0.1, duration: 0.06, volume: 0.14, from: 1100, to: 500, q: 3 })
  },
  drink() {
    if (!ready('drink', 120)) return
    for (let i = 0; i < 4; i += 1) tone(500 + i * 60, { at: i * 0.07, type: 'sine', duration: 0.06, volume: 0.08, slideTo: 300 })
  },
  kill() {
    if (!ready('kill', 200)) return
    arp(523, [0, 7, 12, 19], { step: 0.07, volume: 0.09 })
  },
  death() {
    if (!ready('death', 500)) return
    arp(392, [0, -3, -7, -12], { step: 0.16, volume: 0.1, type: 'triangle', duration: 0.25 })
  },
  win() {
    if (!ready('win', 1000)) return
    arp(523, [0, 4, 7, 12, 7, 12, 16, 19, 24], { step: 0.11, volume: 0.1, duration: 0.2 })
  },
  tick() {
    if (ready('tick', 400)) tone(1046, { type: 'square', duration: 0.05, volume: 0.07 })
  },
  cagesOpen() {
    if (!ready('cages', 500)) return
    noise({ duration: 0.4, volume: 0.25, from: 5000, to: 800, q: 0.6 })
    arp(392, [0, 7, 12, 19], { step: 0.05, volume: 0.09 })
  },
  lavaWarn() {
    if (!ready('lava', 4000)) return
    tone(110, { type: 'sawtooth', duration: 0.6, volume: 0.08, slideTo: 90 })
  },
  reward() {
    if (ready('reward', 200)) arp(784, [0, 4, 7, 12], { step: 0.06, volume: 0.07 })
  },
  levelUp() {
    if (!ready('levelUp', 1000)) return
    arp(523, [0, 4, 7, 12, 16, 19, 24], { step: 0.07, volume: 0.08 })
    tone(1047, { at: 0.5, type: 'triangle', duration: 0.6, volume: 0.06, echo: true })
  },
  buy() {
    if (ready('buy', 100)) arp(659, [0, 7, 12], { step: 0.05, volume: 0.08 })
  },
  error() {
    if (ready('error', 150)) tone(160, { type: 'square', duration: 0.18, volume: 0.1, slideTo: 110 })
  },
  caseTick(pitch = 1) {
    if (ready('caseTick', 25)) tone(1400 * pitch, { type: 'square', duration: 0.025, volume: 0.05 })
  },
  /** A hit stopped by a raised shield: a wooden thunk. */
  block(level = 1) {
    if (!ready('block', 80)) return
    noise({ duration: 0.08, volume: 0.22 * level, from: 700, to: 200, q: 2 })
    tone(140, { type: 'triangle', duration: 0.08, volume: 0.12 * level, slideTo: 90 })
  },
  /** An axe knocks a shield down. */
  shieldBreak() {
    if (!ready('shieldBreak', 200)) return
    noise({ duration: 0.25, volume: 0.25, from: 1600, to: 200, q: 1 })
    tone(220, { type: 'square', duration: 0.18, volume: 0.1, slideTo: 70 })
  },
  crit(level = 1) {
    if (!ready('crit', 60)) return
    tone(1900, { type: 'square', duration: 0.05, volume: 0.06 * level, slideTo: 2600 })
    noise({ duration: 0.08, volume: 0.18 * level, from: 4000, to: 1500, q: 1.5 })
  },
  smash(level = 1) {
    if (!ready('smash', 120)) return
    noise({ duration: 0.45, volume: 0.42 * level, from: 1200, to: 60, q: 0.7, type: 'lowpass' })
    tone(95, { type: 'sine', duration: 0.35, volume: 0.28 * level, slideTo: 40 })
  },
  gust(level = 1) {
    if (!ready('gust', 80)) return
    noise({ duration: 0.4, volume: 0.22 * level, from: 400, to: 2600, q: 1.2 })
    tone(260, { type: 'sine', duration: 0.3, volume: 0.06 * level, slideTo: 620 })
  },
  splash(level = 1) {
    if (!ready('splash', 100)) return
    for (let i = 0; i < 3; i += 1) tone(2400 + Math.random() * 1500, { at: i * 0.03, type: 'triangle', duration: 0.1, volume: 0.05 * level })
    noise({ duration: 0.3, volume: 0.16 * level, from: 3000, to: 900, q: 0.8 })
  },
  charm() {
    if (!ready('charm', 400)) return
    noise({ duration: 0.5, volume: 0.2, from: 5000, to: 900, q: 0.6 })
    arp(659, [0, 4, 7, 12, 16, 24], { step: 0.05, volume: 0.08 })
  },
  /** A jump pad throws you up: a springy boing. */
  pad() {
    if (!ready('pad', 150)) return
    tone(220, { type: 'square', duration: 0.18, volume: 0.07, slideTo: 880 })
    tone(330, { at: 0.04, type: 'triangle', duration: 0.2, volume: 0.05, slideTo: 1200 })
  },
  lunge() {
    if (ready('lunge', 120)) noise({ duration: 0.22, volume: 0.14, from: 900, to: 3200, q: 2.5 })
  },
  reveal(rarityIndex = 0) {
    if (!ready('reveal', 300)) return
    const notes = [[0, 7], [0, 4, 7], [0, 4, 7, 12], [0, 4, 7, 12, 16], [0, 4, 7, 12, 16, 19], [0, 4, 7, 12, 16, 19, 24]][Math.min(5, rarityIndex)]
    arp(523, notes, { step: 0.07, volume: 0.09, duration: 0.18 })
    if (rarityIndex >= 3) noise({ at: 0.3, duration: 0.6, volume: 0.15, from: 6000, to: 1500, q: 0.6 })
  },
}
