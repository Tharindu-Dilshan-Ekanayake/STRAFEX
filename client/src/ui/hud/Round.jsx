import { useEffect, useRef, useState } from 'react'

import { EFFECTS, ITEMS, MODES, OFFHAND, TEAMS } from '@shared/balance'

import { exitPointerLock, selectSlot } from '../../game/input'
import { itemIcon } from '../../game/art/items'
import { day } from '../../game/dayNight'
import { runtime } from '../../game/runtime'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { formatClock, u, useNow } from '../format'
import { Button, Fancy, Hearts } from '../kit'
import { t } from '../i18n'
import PixelIcon from '../PixelIcon'

/** The HUD in a fight (and while watching): banners, the duel score, crosshair, hearts and hotbar. */

const BANNER_COLORS = {
  green: ['#d8ffb0', '#3fdc4a'],
  red: ['#ffd0c4', '#ff3a2a'],
  gold: ['#fff7b0', '#ffb21a'],
}

/** ROUND 2 / FIGHT / round won, big in the middle of the screen for a moment. */
export function Banner() {
  const banner = useGame((s) => s.banner)
  const setBanner = useGame((s) => s.setBanner)
  useEffect(() => {
    if (!banner) return undefined
    const id = setTimeout(() => setBanner(null), banner.text === 'FIGHT' ? 1300 : 2600)
    return () => clearTimeout(id)
  }, [banner, setBanner])
  if (!banner) return null
  const [from, to] = BANNER_COLORS[banner.color] || BANNER_COLORS.gold
  return (
    <div key={banner.id} className="big-count absolute left-1/2 flex flex-col items-center text-center" style={{ top: '30%' }}>
      <Fancy size={banner.text === 'FIGHT' ? 96 : 64} from={from} to={to}>
        {banner.text === 'FIGHT' ? `✕ ${banner.text} ✕` : banner.text}
      </Fancy>
      {banner.sub && (
        <span className="txt-o" style={{ fontSize: u(20), color: '#efe9ff', marginTop: u(4) }}>
          {banner.sub}
        </span>
      )}
    </div>
  )
}

/** 3, 2, 1 before each round of a duel. */
export function Countdown() {
  const phase = useGame((s) => s.phase)
  const now = useNow(100)
  if (phase.kind !== 'duel' || phase.phase !== 'countdown') return null
  const n = Math.ceil((phase.endsAt - now) / 1000)
  if (n < 1 || n > 3) return null
  return (
    <div key={n} className="big-count absolute left-1/2 top-1/2">
      <Fancy size={130} from="#ffffff" to="#ffc21a">
        {String(n)}
      </Fancy>
    </div>
  )
}

/** The duel's scoreboard: both names (in their side's colour), rounds won, first to N, the clock. */
export function DuelTop() {
  const phase = useGame((s) => s.phase)
  const now = useNow(500)
  if (phase.kind !== 'duel' || phase.phase === 'vote') return null
  const left = phase.phase === 'fight' ? Math.max(0, phase.endsAt - now) : null
  const score = phase.score || []
  return (
    <div className="duel-top flex flex-col items-center" style={{ gap: u(4) }}>
      <div className="mc-hud flex items-center" style={{ gap: u(14), padding: `${u(5)} ${u(16)}` }}>
        {score.map((s, i) => (
          <div key={s.eid} className="flex items-center" style={{ gap: u(10), flexDirection: i ? 'row-reverse' : 'row' }}>
            <span className="txt-o" style={{ fontSize: u(18), fontWeight: 700, color: TEAMS[s.team]?.color || '#fff' }}>
              {s.eid === runtime.eid ? t('You') : s.name}
            </span>
            <span className="txt-o" style={{ fontSize: u(28), fontWeight: 700 }}>
              {s.wins}
            </span>
          </div>
        ))}
      </div>
      <span className="txt-o" style={{ fontSize: u(14), color: '#d9ccff' }}>
        {t(MODES[phase.mode]?.name || '')} · {t('ROUND {n}', { n: phase.round || 1 })} · {t('first to {n}', { n: phase.ft || 1 })}
        {left !== null ? ` · ${formatClock(left)}` : ''}
      </span>
    </div>
  )
}

export function Crosshair() {
  return (
    <>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: u(22), height: u(22), mixBlendMode: 'difference' }}>
        <div className="absolute left-1/2 top-0 h-full -translate-x-1/2 bg-white" style={{ width: u(3) }} />
        <div className="absolute left-0 top-1/2 w-full -translate-y-1/2 bg-white" style={{ height: u(3) }} />
      </div>
      {/* Flashes when your hit lands (ui/juice.js). */}
      <div id="hitmarker" style={{ width: u(34), height: u(34) }}>
        {[45, -45].map((r) => (
          <div key={r} className="absolute left-1/2 top-1/2" style={{ width: u(34), height: u(5), background: '#ff4a3a', boxShadow: '0 0 0 2px #1a0f2e', transform: `translate(-50%, -50%) rotate(${r}deg)` }} />
        ))}
      </div>
      <div id="dmg-layer" className="absolute inset-0" />
      <KillBanner />
    </>
  )
}

/** "ELIMINATED <name>" in the middle of the screen, with streaks. */
function KillBanner() {
  const banner = useGame((s) => s.killBanner)
  if (!banner) return null
  return (
    <div key={banner.id} className="kill-banner absolute left-1/2 flex flex-col items-center" style={{ top: '22%' }}>
      {banner.streak && (
        <Fancy size={34} from="#ffe9ff" to="#d05cff">
          {banner.streak}
        </Fancy>
      )}
      <Fancy size={26} from="#ffd0c4" to="#ff3a2a">
        {t('ELIMINATED')}
      </Fancy>
      <span className="txt-o" style={{ fontSize: u(20), fontWeight: 700 }}>
        {banner.name}
      </span>
      {banner.cash > 0 && (
        <span className="txt-o" style={{ fontSize: u(18), color: '#7cff6b' }}>
          +${banner.cash}
        </span>
      )}
    </div>
  )
}

/** Holding to eat or drink: a little bar filling under the crosshair. */
function UseProgress() {
  const now = useNow(60)
  const main = useGame((s) => ITEMS[s.me.inv[s.me.sel]?.id]?.kind)
  const off = useGame((s) => ITEMS[s.me.inv[OFFHAND]?.id]?.kind)
  const kind = runtime.useHand === 'off' ? off : main
  if (!runtime.eatStart || (kind !== 'food' && kind !== 'potion')) return null
  const k = Math.min(1, (now - runtime.eatStart) / (kind === 'food' ? 1050 : 850))
  return (
    <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 'calc(50% + 26px)', width: u(80), height: u(8), background: 'rgba(0,0,0,0.5)', borderRadius: u(4), overflow: 'hidden' }}>
      <div style={{ width: `${k * 100}%`, height: '100%', background: kind === 'food' ? '#ffd23b' : '#ff7bd5' }} />
    </div>
  )
}

/** The shield's down after an axe hit: how long until it's back. */
function ShieldChip() {
  const off = useGame((s) => s.me.shieldOff)
  const has = useGame((s) => s.me.inv[OFFHAND]?.id === 'shield' || s.me.inv[s.me.sel]?.id === 'shield')
  const now = useNow(250)
  const left = off - (now - runtime.me.shieldOffAt)
  if (!has || left <= 0) return null
  return (
    <span className="mc-hud txt-o" style={{ padding: `${u(2)} ${u(8)}`, fontSize: u(14), color: '#ff9a3c' }}>
      🛡 {t('SHIELD DOWN')} {Math.ceil(left / 1000)}s
    </span>
  )
}

export function BottomBar() {
  const me = useGame((s) => s.me)
  const sword = useGame((s) => s.profile.sword)
  const [label, setLabel] = useState(null)
  const labelId = useRef(0)
  const selId = me.inv[me.sel]?.id
  useEffect(() => {
    if (!selId) return undefined
    labelId.current += 1
    setLabel({ text: ITEMS[selId]?.name, id: labelId.current })
    const id = setTimeout(() => setLabel(null), 1600)
    return () => clearTimeout(id)
  }, [selId, me.sel])

  return (
    <>
      <UseProgress />
      <div className="bottom-bar absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ paddingBottom: u(14), gap: u(6) }}>
        {label?.text && (
          <div key={label.id} className="txt-o pop-in" style={{ fontSize: u(20) }}>
            {label.text}
          </div>
        )}
        <div className="flex" style={{ gap: u(6) }}>
          <ShieldChip />
          <EffectChips effects={me.effects} />
        </div>
        {/* Under water: your breath, as bubbles (they pop as it runs out). */}
        {me.air !== undefined && me.air < 10 && (
          <div className="air-row flex w-full justify-end" style={{ gap: u(1) }}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ opacity: i < me.air ? 1 : 0, transition: 'opacity 0.15s' }}>
                <PixelIcon name="bubble" size={u(20)} className="" />
              </span>
            ))}
          </div>
        )}
        <div className="hearts-row flex w-full items-end justify-between" style={{ gap: u(16) }}>
          <Hearts hp={me.hp} maxHp={me.maxHp} absorb={me.absorb || 0} />
          {me.kills > 0 && (
            <div className="txt-o" style={{ fontSize: u(18), color: '#ff8a8a' }}>
              ⚔ {me.kills}
            </div>
          )}
        </div>
        <div className="hotbar pointer-events-auto flex items-center">
          {/* The offhand (left hand), and the inventory (E). */}
          <OffhandSlot slot={me.inv[OFFHAND]} sword={sword} />
          {Array.from({ length: 9 }, (_, i) => {
            const slot = me.inv[i]
            return (
              <button
                key={i}
                type="button"
                className={`slot relative flex items-center justify-center ${i === me.sel ? 'sel' : ''}`}
                style={{ width: 'var(--slot)', height: 'var(--slot)' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  selectSlot(i)
                }}
              >
                {slot && <img src={itemIcon(slot.id, sword)} alt="" className="pixelated" style={{ width: '68%', height: '68%' }} draggable={false} />}
                {slot && slot.n > 1 && (
                  <span key={slot.n} className="slot-count bump absolute" style={{ fontSize: u(16) }}>
                    {slot.n}
                  </span>
                )}
                <span className="slot-num absolute" style={{ fontSize: u(9) }}>
                  {i + 1}
                </span>
              </button>
            )
          })}
          <BagButton />
        </div>
      </div>
    </>
  )
}

/** The left hand, next to the hotbar; tap it (or press E) for the whole inventory. */
function OffhandSlot({ slot, sword }) {
  const open = useGame((s) => s.togglePanel)
  return (
    <>
      <button
        type="button"
        className="slot relative flex items-center justify-center"
        style={{ width: 'var(--slot)', height: 'var(--slot)', marginRight: u(12) }}
        title={t('Offhand (F swaps hands)')}
        onPointerDown={(e) => {
          e.stopPropagation()
          exitPointerLock()
          open('inventory')
        }}
      >
        {/* Empty: a faint shield, like Minecraft's empty offhand slot. */}
        <img src={itemIcon(slot ? slot.id : 'shield', sword)} alt="" className="pixelated" style={{ width: '68%', height: '68%', opacity: slot ? 1 : 0.22, filter: slot ? 'none' : 'grayscale(1)' }} draggable={false} />
        {slot && slot.n > 1 && (
          <span className="slot-count absolute" style={{ fontSize: u(16) }}>
            {slot.n}
          </span>
        )}
      </button>
    </>
  )
}

/** Opens the inventory (E): a bag button after the hotbar. */
function BagButton() {
  const open = useGame((s) => s.togglePanel)
  return (
    <button
      type="button"
      className="slot flex items-center justify-center"
      style={{ width: 'var(--slot)', height: 'var(--slot)', marginLeft: u(12) }}
      title={t('Inventory (E)')}
      onPointerDown={(e) => {
        e.stopPropagation()
        exitPointerLock()
        open('inventory')
      }}
    >
      <PixelIcon name="backpack" size="62%" className="" />
    </button>
  )
}

const EFFECT_LABELS = { speed: ['SPEED', '#5fd3ff'], jump: ['JUMP', '#7cff6b'], leap: ['SUPER JUMP', '#b4ff6a'], strength: ['STRENGTH', '#ff5050'], regen: ['REGEN', '#ff7bd5'] }

function EffectChips({ effects }) {
  const now = useNow(500)
  const at = runtime.me.effectsAt
  const list = Object.entries(effects || {}).filter(([k, ms]) => EFFECT_LABELS[k] && ms - (now - at) > 0 && EFFECTS[k])
  if (!list.length) return null
  return (
    <div className="flex" style={{ gap: u(6) }}>
      {list.map(([k, ms]) => (
        <span key={k} className="mc-hud txt-o" style={{ padding: `${u(2)} ${u(8)}`, fontSize: u(14), color: EFFECT_LABELS[k][1] }}>
          {t(EFFECT_LABELS[k][0])} {Math.ceil((ms - (now - at)) / 1000)}s
        </span>
      ))}
    </div>
  )
}

/** Knocked out of a duel round: who you're watching, and the way out. */
export function SpectateBar() {
  const name = useGame((s) => s.spectating)
  const phase = useGame((s) => s.phase)
  if (phase.kind !== 'duel' || phase.phase === 'ended') return null
  return (
    <div className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(24), gap: u(8) }}>
      <div className="mc-hud flex flex-col items-center" style={{ padding: `${u(6)} ${u(18)}`, minWidth: u(220) }}>
        <span className="txt-o" style={{ fontSize: u(13), color: '#bdb3e0' }}>
          {t('SPECTATING')}
        </span>
        <span className="txt-o" style={{ fontSize: u(22), fontWeight: 700 }}>
          {name || '—'}
        </span>
      </div>
      <Button color="#d8443a" style={{ padding: `${u(6)} ${u(20)}`, fontSize: u(16) }} onClick={() => actions.toLobby()}>
        {t('FORFEIT & LEAVE')}
      </Button>
    </div>
  )
}

/** Spirelands: how many are fighting, and the way back to the lobby. */
export function FfaTop() {
  const phase = useGame((s) => s.phase)
  if (phase.kind !== 'ffa') return null
  return (
    <div className="flex flex-col items-center" style={{ gap: u(4) }}>
      <Fancy size={26} from="#e4fbff" to="#5f8bff">
        {t('SPIRELANDS')}
      </Fancy>
      <span className="txt-o" style={{ fontSize: u(14), color: '#d9ccff' }}>
        {t('Free for all · {n} fighting', { n: phase.alive || 0 })} · <TimeOfDay />
      </span>
    </div>
  )
}

const DAY_LABELS = { morning: ['☀ MORNING', '#ffd2a0'], day: ['☀ DAY', '#fff3b0'], evening: ['☀ EVENING', '#ffb27a'], night: ['☾ NIGHT', '#bcd0ff'] }
/** Spirelands' time of day, read off the clock every few seconds. */
function TimeOfDay() {
  useNow(3000)
  const [label, color] = DAY_LABELS[day.phase] || DAY_LABELS.day
  return <span style={{ color }}>{t(label)}</span>
}

/** Back to the lobby (or forfeit a duel) from a fight. */
export function LeaveButton() {
  const phase = useGame((s) => s.phase)
  const zone = useGame((s) => s.zone)
  if (zone !== 'match' || (phase.kind === 'duel' && phase.phase === 'ended')) return null
  return (
    <button type="button" className="mc-stone leave-btn pointer-events-auto" style={{ height: u(50), padding: `0 ${u(14)}`, fontSize: u(14) }} onClick={() => actions.toLobby()}>
      {phase.kind === 'duel' ? t('FORFEIT') : t('LOBBY')}
    </button>
  )
}
