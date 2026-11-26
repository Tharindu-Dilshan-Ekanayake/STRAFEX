import { useEffect, useRef } from 'react'

import { ARMOR, ARMOR_PIECES, MODES } from '@shared/balance'

import { cps, runtime } from '../../game/runtime'
import { useGame } from '../../store/game'
import { u } from '../format'
import { t } from '../i18n'

/**
 * The competitive PvP overlay: keystrokes with clicks per second (left), your armour's
 * durability (bottom right) and the fight's numbers - hits, hits taken, damage dealt and
 * taken, best combo (right).
 */

/**
 * W A S D, jump, and both mouse buttons with their CPS, lit while held. Driven by its
 * own animation frame straight into the DOM: input changes every frame, React never
 * re-renders for it.
 */
export function Keystrokes() {
  const root = useRef(null)
  useEffect(() => {
    const el = root.current
    if (!el) return undefined
    const keys = {
      forward: el.querySelector('[data-k="w"]'),
      left: el.querySelector('[data-k="a"]'),
      back: el.querySelector('[data-k="s"]'),
      right: el.querySelector('[data-k="d"]'),
      jump: el.querySelector('[data-k="jump"]'),
      attack: el.querySelector('[data-k="lmb"]'),
      use: el.querySelector('[data-k="rmb"]'),
    }
    const keyList = Object.entries(keys)
    const lCps = el.querySelector('[data-c="l"]')
    const rCps = el.querySelector('[data-c="r"]')
    const lit = {}
    const shown = { l: -1, r: -1 }
    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const input = runtime.input
      for (let i = 0; i < keyList.length; i += 1) {
        const [k, node] = keyList[i]
        const on = Boolean(input[k])
        if (lit[k] !== on) {
          lit[k] = on
          node.classList.toggle('ks-on', on)
        }
      }
      const l = cps('l')
      const r = cps('r')
      if (l !== shown.l) {
        shown.l = l
        lCps.textContent = `${l} CPS`
      }
      if (r !== shown.r) {
        shown.r = r
        rCps.textContent = `${r} CPS`
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  const key = (k, label, w = 1) => (
    <div data-k={k} className="ks-key" style={{ gridColumn: `span ${w}` }}>
      {label}
    </div>
  )
  return (
    <div ref={root} className="keystrokes absolute" style={{ left: u(14), top: '34%' }}>
      <div />
      {key('w', 'W')}
      <div />
      {key('a', 'A')}
      {key('s', 'S')}
      {key('d', 'D')}
      <div data-k="lmb" className="ks-key ks-mouse" style={{ gridColumn: 'span 1' }}>
        LMB
        <span data-c="l">0 CPS</span>
      </div>
      <div />
      <div data-k="rmb" className="ks-key ks-mouse" style={{ gridColumn: 'span 1' }}>
        RMB
        <span data-c="r">0 CPS</span>
      </div>
      <div data-k="jump" className="ks-key ks-space" style={{ gridColumn: 'span 3' }} />
    </div>
  )
}

/** Little pixel armour pieces, tinted per tier (cached data URLs). */
const iconCache = new Map()
const SHAPES = [
  ['xxxxxx', 'x....x', 'x....x'],
  ['xx..xx', 'xxxxxx', '.xxxx.', '.xxxx.', '.xxxx.'],
  ['xxxxxx', 'xx..xx', 'xx..xx', 'xx..xx'],
  ['xx..xx', 'xx..xx', 'xx..xx'],
]
function armorIcon(piece, color) {
  const key = `${piece}:${color}`
  if (iconCache.has(key)) return iconCache.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  const rows = SHAPES[piece]
  const oy = Math.floor((8 - rows.length) / 2)
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'x') return
      ctx.fillStyle = '#120c1e'
      ctx.fillRect(x, y + oy, 3, 2)
    }),
  )
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'x') return
      ctx.fillStyle = y === 0 ? '#ffffff' : color
      ctx.fillRect(x + 1, y + oy, 1, 1)
    }),
  )
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

/** Each armour piece and how much durability it has left (red when nearly broken). */
export function ArmorPanel() {
  const armor = useGame((s) => s.me.armor)
  const set = ARMOR[armor?.tier]
  if (!set || !set.color) return null
  return (
    <div className="armor-panel absolute flex flex-col items-end" style={{ right: u(14), bottom: u(96), gap: u(2) }}>
      {armor.dura.map((d, i) => {
        const max = set.dura[i]
        const low = d / max < 0.2
        return (
          <div key={i} className="txt-o flex items-center" style={{ gap: u(6), fontSize: u(15), color: d <= 0 ? '#8b84a8' : low ? '#ff6b6b' : '#ffffff' }} title={`${set.name} ${ARMOR_PIECES[i]}`}>
            <span>{d}</span>
            <img src={armorIcon(i, d <= 0 ? '#5a5466' : set.color)} alt="" className="pixelated" style={{ width: u(20), height: u(20) }} draggable={false} />
          </div>
        )
      })}
    </div>
  )
}

/** The fight's numbers, like a scoreboard sidebar. */
export function StatsPanel() {
  const st = useGame((s) => s.me.stats)
  const kit = useGame((s) => s.me.kit)
  const phase = useGame((s) => s.phase)
  if (!st) return null
  const rows = [
    ['Hits', st.hits, '#7cff6b'],
    ['Hits Taken', st.taken, '#ff8a8a'],
    ['Dealt', st.dealt.toFixed(1), '#ffd23b'],
    ['Taken', st.dmgTaken.toFixed(1), '#ff6b6b'],
    ['Combo', st.combo, '#9fe6ff'],
    ['Best Combo', st.best, '#c9a6ff'],
  ]
  return (
    <div className="stats-panel mc-panel absolute flex flex-col" style={{ right: u(14), top: '42%', padding: `${u(6)} ${u(10)}`, gap: u(1), minWidth: u(150) }}>
      <div className="txt-o" style={{ fontSize: u(13), color: '#ffb21a', fontWeight: 700, letterSpacing: '0.04em' }}>
        STRAFEX · {MODES[kit]?.name || (phase.kind === 'ffa' ? t('SPIRELANDS') : '')}
      </div>
      {rows.map(([label, value, color]) => (
        <div key={label} className="txt-o flex justify-between" style={{ fontSize: u(13), gap: u(10) }}>
          <span style={{ color: '#d9d2f0' }}>{t(label)}</span>
          <span style={{ color, fontWeight: 700 }}>{value}</span>
        </div>
      ))}
    </div>
  )
}
