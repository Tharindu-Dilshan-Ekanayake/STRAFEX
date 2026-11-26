/**
 * Background music, made live with WebAudio (no files): three moods that share one
 * look-ahead scheduler and change on a bar line.
 *
 * - lobby: a relaxed, warm groove - soft pad chords, a plucked melody, light drums
 * - match: driving and bright - four-on-the-floor kick, pulsing bass, an arpeggio
 * - tense: the match theme pushed harder for the lava's climb - faster arpeggio,
 *          open filter, extra percussion
 *
 * Notes are scheduled a little ahead on the audio clock by a timer, never from the
 * render loop.
 */

const LOOKAHEAD_S = 0.35
const TICK_MS = 100

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12)

/** Per mood: tempo, the 4-bar progression (bass root + chord), melody, feel. */
const MOODS = {
  lobby: {
    bpm: 96,
    bars: [
      { root: 41, chord: [65, 69, 72] }, // F
      { root: 38, chord: [62, 65, 69] }, // Dm
      { root: 46, chord: [65, 70, 74] }, // Bb
      { root: 48, chord: [64, 67, 72] }, // C
    ],
    // [sixteenth within the 64, midi, sixteenths long]
    melody: [
      [0, 77, 3], [4, 76, 2], [6, 74, 2], [8, 72, 6], [16, 74, 3], [20, 72, 2], [22, 69, 2], [24, 72, 6],
      [32, 70, 3], [36, 69, 2], [38, 67, 2], [40, 70, 6], [48, 72, 3], [52, 74, 2], [54, 76, 2], [56, 77, 7],
    ],
    // A second phrase, answering the first.
    melodyB: [
      [0, 72, 2], [2, 74, 2], [4, 77, 4], [8, 81, 4], [12, 79, 4], [16, 77, 2], [18, 74, 2], [20, 74, 8],
      [32, 74, 2], [34, 77, 2], [36, 79, 4], [40, 77, 4], [44, 74, 4], [48, 76, 4], [52, 72, 4], [56, 72, 8],
    ],
    drums: 'soft',
    filter: 2600,
  },
  match: {
    bpm: 124,
    bars: [
      { root: 33, chord: [57, 60, 64] }, // Am
      { root: 41, chord: [57, 60, 65] }, // F
      { root: 36, chord: [55, 60, 64] }, // C
      { root: 43, chord: [55, 59, 62] }, // G
    ],
    melody: [
      [0, 76, 2], [2, 76, 2], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 72, 4], [16, 72, 2], [18, 74, 2], [20, 76, 4], [24, 69, 8],
      [32, 76, 2], [34, 76, 2], [36, 79, 2], [38, 81, 2], [40, 79, 4], [44, 76, 4], [48, 74, 4], [52, 76, 4], [56, 71, 8],
    ],
    melodyB: [
      [0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 77, 4], [12, 76, 4], [16, 72, 3], [19, 74, 3], [22, 76, 2], [24, 72, 8],
      [32, 79, 2], [34, 81, 2], [36, 83, 4], [40, 81, 2], [42, 79, 2], [44, 76, 4], [48, 74, 2], [50, 76, 2], [52, 79, 4], [56, 79, 8],
    ],
    drums: 'drive',
    filter: 3400,
  },
  tense: {
    bpm: 136,
    bars: [
      { root: 33, chord: [57, 60, 64] },
      { root: 34, chord: [58, 62, 65] }, // Bb
      { root: 33, chord: [57, 60, 64] },
      { root: 40, chord: [56, 59, 64] }, // E
    ],
    melody: [],
    melodyB: [
      [0, 69, 8], [8, 70, 8], [16, 69, 8], [24, 72, 8], [32, 69, 8], [40, 70, 8], [48, 69, 8], [56, 76, 8],
    ],
    drums: 'tense',
    filter: 5200,
  },
}

export function createMusic(ctx, destination, noiseBuffer) {
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(destination)
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 3000
  tone.connect(out)
  // A soft echo for the melody and pad.
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.28
  const fb = ctx.createGain()
  fb.gain.value = 0.25
  const wet = ctx.createGain()
  wet.gain.value = 0.22
  delay.connect(fb).connect(delay)
  delay.connect(wet).connect(tone)

  let step = 0
  /** Whole loops played: picks the phrase (A, B, A, rest), the key, and when to fill. */
  let loops = 0
  let shift = 0
  let nextAt = 0
  let timer = null
  let mood = MOODS.lobby
  let wanted = 'lobby'
  const level = { base: 0.45, ducked: 1, volume: 1 }

  function note(midi, t, { type = 'sine', length = 0.3, volume = 0.05, attack = 0.01, cutoff = 0, echo = false, detune = 0 } = {}) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq(midi)
    if (detune) osc.detune.value = detune
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(volume, t + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    let last = osc
    if (cutoff) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = cutoff
      last = last.connect(filter)
    }
    last.connect(gain).connect(tone)
    if (echo) gain.connect(delay)
    osc.start(t)
    osc.stop(t + length + 0.05)
  }

  function hiss(t, { type = 'bandpass', frequency = 1500, q = 0.9, volume = 0.04, length = 0.06 } = {}) {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(volume, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    src.connect(filter).connect(gain).connect(tone)
    src.start(t, Math.random() * 0.5)
    src.stop(t + length + 0.01)
  }

  function kick(t, volume = 0.16) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.setValueAtTime(140, t)
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13)
    gain.gain.setValueAtTime(volume, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    osc.connect(gain).connect(tone)
    osc.start(t)
    osc.stop(t + 0.24)
  }

  function clap(t, volume = 0.035) {
    for (let i = 0; i < 3; i += 1) hiss(t + i * 0.011, { frequency: 1300 + i * 250, volume, length: 0.05 + i * 0.02 })
  }

  /** Everything on sixteenth `step` (of a 4-bar, 64-sixteenth loop) at time t. */
  function play(t) {
    const m = mood
    const six = 60 / m.bpm / 4
    const inBar = step % 16
    const base = m.bars[Math.floor(step / 16) % 4]
    // Every few loops the whole song moves to a new key, so it never gets stale.
    const bar = shift ? { root: base.root + shift, chord: base.chord.map((n) => n + shift) } : base
    const lastBar = Math.floor((step % 64) / 16) === 3
    const fill = lastBar && loops % 4 === 3

    if (m.drums === 'soft') {
      if (inBar === 0 || inBar === 10) kick(t, 0.11)
      if (inBar === 8) clap(t, 0.022)
      if (inBar % 4 === 2) hiss(t, { frequency: 6500, q: 1.5, volume: 0.007, length: 0.03 })
      // Bass on the beat, a pad chord at the top of each bar.
      if (inBar % 8 === 0) note(bar.root, t, { type: 'triangle', length: six * 7, volume: 0.07 })
      if (inBar === 0) {
        for (const n of bar.chord) {
          note(n, t, { type: 'triangle', length: six * 15, volume: 0.012, attack: 0.25, echo: true, detune: -6 })
          note(n, t, { type: 'sine', length: six * 15, volume: 0.012, attack: 0.3, detune: 7 })
        }
      }
    } else {
      // Four on the floor, claps on 2 and 4, hats on the off-beats.
      if (inBar % 4 === 0) kick(t, 0.15)
      if (inBar === 4 || inBar === 12) clap(t, 0.04)
      if (inBar % 4 === 2) hiss(t, { frequency: 7000, q: 1.2, volume: 0.012, length: 0.025 })
      if (m.drums === 'tense' && inBar % 2 === 1) hiss(t, { frequency: 9000, q: 2, volume: 0.006, length: 0.015 })
      // A snare roll into the next section.
      if (fill && inBar >= 8) clap(t, 0.012 + (inBar - 8) * 0.004)
      // Pulsing bass eighths.
      if (inBar % 2 === 0) note(bar.root + (inBar % 8 === 6 ? 12 : 0), t, { type: 'sawtooth', length: six * 1.6, volume: 0.05, cutoff: m.drums === 'tense' ? 900 : 600 })
      // Arpeggio up the chord: eighths, or sixteenths when tense.
      const every = m.drums === 'tense' ? 1 : 2
      if (inBar % every === 0) {
        const n = bar.chord[(step / every) % 3 | 0] + 12
        note(n, t, { type: 'square', length: six * 0.9, volume: 0.01, cutoff: m.filter, echo: true })
      }
    }
    if (fill && m.drums === 'soft' && inBar % 4 === 2) hiss(t, { frequency: 2400, q: 1.2, volume: 0.012, length: 0.05 })
    // The melody: phrase A, phrase B, A again, then a loop of rest so it doesn't nag.
    const phrase = [m.melody, m.melodyB, m.melody, null][loops % 4]
    if (phrase?.length) {
      for (const [at, midi, length] of phrase) {
        if (at === step % 64) note(midi + shift, t, { type: m.drums === 'soft' ? 'triangle' : 'square', length: six * length * 0.95, volume: m.drums === 'soft' ? 0.03 : m.drums === 'tense' ? 0.012 : 0.014, attack: 0.015, cutoff: m.filter, echo: true })
      }
    }
  }

  function schedule() {
    nextAt = Math.max(nextAt, ctx.currentTime + 0.05)
    while (nextAt < ctx.currentTime + LOOKAHEAD_S) {
      // Change mood on a bar line.
      if (step % 16 === 0 && MOODS[wanted] !== mood) {
        mood = MOODS[wanted]
        loops = 0
        shift = 0
        tone.frequency.setTargetAtTime(mood.filter, nextAt, 0.5)
      }
      play(nextAt)
      nextAt += 60 / mood.bpm / 4
      step = (step + 1) % 128
      if (step % 64 === 0) {
        loops += 1
        if (loops % 8 === 0) shift = [0, 2, -3, 3, -2][(loops / 8) % 5]
      }
    }
  }

  const applyLevel = (seconds) => out.gain.setTargetAtTime(level.base * level.ducked * level.volume, ctx.currentTime, seconds)

  return {
    start() {
      if (timer) return
      nextAt = ctx.currentTime + 0.1
      timer = setInterval(schedule, TICK_MS)
      schedule()
      applyLevel(1.2)
    },
    /** 'lobby' | 'match' | 'tense' - takes effect on the next bar. */
    setMood(name) {
      if (MOODS[name]) wanted = name
    },
    duck(on) {
      level.ducked = on ? 0.45 : 1
      applyLevel(0.4)
    },
    setVolume(volume) {
      level.volume = Math.min(1, Math.max(0, Number(volume) || 0))
      if (timer) applyLevel(0.15)
    },
  }
}
