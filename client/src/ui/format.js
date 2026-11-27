import { useEffect, useRef, useState } from 'react'

/** A length in HUD units (scaled with the screen; see --u in index.css). */
export const u = (n) => `calc(var(--u) * ${n})`

/** Re-renders every `ms` with the current time (for clocks). */
export function useNow(ms = 250) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/**
 * A number that rolls up (or down) to `target` over `ms` instead of jumping: cash
 * counters and rewards. Runs only while it moves, on requestAnimationFrame.
 */
export function useCountUp(target, ms = 700, start = target) {
  const [shown, setShown] = useState(start)
  const from = useRef(start)
  useEffect(() => {
    const a = from.current
    if (a === target) return undefined
    const t0 = performance.now()
    let raf = 0
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms)
      const v = Math.round(a + (target - a) * (1 - (1 - k) ** 3))
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}

export const formatClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const formatCash = (n) => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e4) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return `$${Math.floor(n).toLocaleString('en-US')}`
}

const heartCache = {}
/** Pixel heart image: 'full' | 'half' | 'empty' | 'gold' | 'goldHalf' (absorption). */
export function heartUrl(kind) {
  if (heartCache[kind]) return heartCache[kind]
  const rows = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...']
  const canvas = document.createElement('canvas')
  canvas.width = 9
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  // Dark outline first, then the fill.
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'x') return
      ctx.fillStyle = '#1a0a10'
      ctx.fillRect(x, y, 3, 3)
    }),
  )
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'x') return
      const gold = kind === 'gold' || kind === 'goldHalf'
      const filled = kind === 'full' || kind === 'gold' || ((kind === 'half' || kind === 'goldHalf') && x < 3)
      const light = gold ? '#fff3b0' : '#ffb3c0'
      const dark = gold ? '#c98a0c' : '#b3122c'
      const mid = gold ? '#ffd23b' : '#ff2f4f'
      ctx.fillStyle = filled ? (y === 1 && x === 1 ? light : y >= 3 ? dark : mid) : '#3b2a33'
      ctx.fillRect(x + 1, y + 1, 1, 1)
    }),
  )
  heartCache[kind] = canvas.toDataURL()
  return heartCache[kind]
}

