import { Color, Vector3 } from 'three'

import { FFA_SKY } from '@shared/maps'

/**
 * Spirelands' day: morning, day, evening and night, round and round. It runs off the
 * clock (Date.now), so every player on every server sees the same time of day with
 * nothing sent over the network. Duels and the lobby stay in daylight.
 *
 * `updateDay(active)` is called once a frame (Environment's Sky) and fills `day`, which
 * the sky, the terrain shader, the figures and the lights read.
 */
export const DAY_CYCLE_MS = 12 * 60_000

/**
 * The day's keyframes: when (0-1, 0 = sunrise), how bright, the light's tint, the sky's
 * three colours (zenith, above the horizon, horizon/fog) and the phase's name.
 */
const SUNRISE = [0.78, [1, 0.86, 0.76], ['#4a6fc0', '#f0a070', '#ffd2a0']]
const DAY = [1, [1, 1, 1], FFA_SKY]
const SUNSET = [0.7, [1, 0.8, 0.68], ['#3b3f86', '#e2704f', '#ffb27a']]
const NIGHT = [0.36, [0.55, 0.64, 1], ['#060a1f', '#0f1a40', '#1f2f5a']]
const KEYS = [
  [0, ...SUNRISE],
  [0.08, ...DAY],
  [0.5, ...DAY],
  [0.56, ...SUNSET],
  [0.62, ...NIGHT],
  [0.92, ...NIGHT],
  [1, ...SUNRISE],
].map(([t, light, tint, sky]) => ({ t, light, tint: new Color(...tint), sky: sky.map((c) => new Color(c)) }))

/** What the day is like right now. */
export const day = {
  /** On (Spirelands) or not (everywhere else: plain daylight). */
  active: false,
  /** 0-1 through the cycle, 0 = sunrise. */
  t: 0.3,
  /** Brightness of everything lit by the sky (1 by day, about a third at night). */
  light: 1,
  /** The sky light's colour (warm at dawn and dusk, moonlit blue at night). */
  tint: new Color(1, 1, 1),
  /** How dark it is: 0 by day, 1 at full night (torches and campfires light the dark). */
  night: 0,
  sky: [new Color(), new Color(), new Color()],
  /** Where the sun - or by night the moon - is (a unit vector). */
  orb: new Vector3(0.38, 0.78, -0.5).normalize(),
  moon: false,
  phase: 'day',
}

const lerpColor = (out, a, b, k) => out.copy(a).lerp(b, k)

export function updateDay(active, now = Date.now()) {
  day.active = active
  if (!active) {
    day.light = 1
    day.tint.setRGB(1, 1, 1)
    day.night = 0
    day.moon = false
    day.phase = 'day'
    return day
  }
  const t = (now % DAY_CYCLE_MS) / DAY_CYCLE_MS
  day.t = t
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i += 1
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
  const s = k * k * (3 - 2 * k)
  day.light = a.light + (b.light - a.light) * s
  lerpColor(day.tint, a.tint, b.tint, s)
  for (let j = 0; j < 3; j += 1) lerpColor(day.sky[j], a.sky[j], b.sky[j], s)
  day.night = Math.max(0, Math.min(1, (1 - day.light) / (1 - NIGHT[0])))
  // The sun crosses the sky from sunrise to sunset; the moon the rest of the time.
  const sunUp = t < 0.6
  const arc = sunUp ? t / 0.6 : (t - 0.6) / 0.4
  const ang = arc * Math.PI
  day.orb.set(Math.cos(ang), Math.max(0.05, Math.sin(ang)) * 0.9, -0.35).normalize()
  day.moon = !sunUp
  day.phase = t < 0.08 ? 'morning' : t < 0.5 ? 'day' : t < 0.62 ? 'evening' : t < 0.92 ? 'night' : 'morning'
  return day
}
