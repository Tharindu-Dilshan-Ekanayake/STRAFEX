import { useEffect, useRef } from 'react'

import { ARMOR, ARMOR_PIECES, MODES } from '@shared/balance'

import { armorIcon } from '../../game/art/armorIcons'
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
      interact: el.querySelector('[data-k="e"]'),
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
      {key('e', 'E')}
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
    <div className="stats-panel mc-hud absolute flex flex-col" style={{ right: u(14), top: '42%', gap: u(2), minWidth: u(170), paddingBottom: u(5) }}>
      <div className="mc-hud-title mc-text" style={{ fontSize: u(13), color: '#ffff55', padding: `${u(4)} ${u(8)}` }}>
        {MODES[kit]?.name || (phase.kind === 'ffa' ? t('SPIRELANDS') : 'STRAFEX')}
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="mc-text flex justify-between" style={{ fontSize: u(12), gap: u(12), padding: `0 ${u(8)}` }}>
          <span>{t(label)}</span>
          <span style={{ color: '#ff5555' }}>{value}</span>
        </div>
      ))}
    </div>
  )
}
