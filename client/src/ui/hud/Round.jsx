import { useEffect, useRef, useState } from 'react'

import { EFFECTS, ITEMS, lavaHeight, LAVA, ROUND, TEAMS } from '@shared/balance'

import { selectSlot } from '../../game/input'
import { itemIcon } from '../../game/art/items'
import { runtime } from '../../game/runtime'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { u, useNow } from '../format'
import { Button, Fancy, Hearts } from '../kit'
import { t } from '../i18n'

/** The HUD in a round (and while spectating): countdown, objective, crosshair, hearts and hotbar, loot, team. */

/** 3, 2, 1 in the middle of the screen as the cages open, then GO! */
export function BigCount() {
  const phase = useGame((s) => s.phase)
  const now = useNow(100)
  let text = null
  if (phase.phase === 'cages') {
    const n = Math.ceil((phase.endsAt - now) / 1000)
    if (n >= 1 && n <= 3) text = String(n)
  } else if (phase.phase === 'fight' && ROUND.fightMs - (phase.endsAt - now) < 1000) text = 'GO!'
  const shown = text === 'GO!' ? t('GO!') : text
  if (!text) return null
  const go = text === 'GO!'
  return (
    <div key={text} className={`big-count absolute left-1/2 top-1/2 ${go ? 'big-go' : ''}`}>
      <Fancy size={go ? 120 : 140} from={go ? '#d8ffb0' : '#ffffff'} to={go ? '#3fdc4a' : '#ffc21a'}>
        {shown}
      </Fancy>
    </div>
  )
}

/** Team modes: which team you're on, and who's with you. */
export function TeamChip() {
  const roster = useGame((s) => s.roster)
  const mine = Object.values(roster).find((e) => e.eid === runtime.eid)
  if (!mine || mine.team < 0) return null
  const team = TEAMS[mine.team % TEAMS.length]
  const mates = Object.values(roster).filter((e) => e.team === mine.team && e.eid !== mine.eid && e.zone === 'match')
  return (
    <div className="mc-panel txt-o flex items-center" style={{ gap: u(8), padding: `${u(3)} ${u(12)}`, fontSize: u(15), borderColor: team.color }}>
      <span style={{ color: team.color, fontWeight: 700 }}>{team.name.toUpperCase()} TEAM</span>
      {mates.length > 0 && (
        <span style={{ color: '#e6dcff' }}>
          with{' '}
          {mates.map((m, i) => (
            <span key={m.eid} style={{ color: m.alive ? '#fff' : '#8b84a8', textDecoration: m.alive ? 'none' : 'line-through' }}>
              {i ? ', ' : ''}
              {m.name}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

export function Objective() {
  const tutorialSeen = useGame((s) => s.profile.tutorial)
  const step = useGame((s) => s.tutorial)
  const phase = useGame((s) => s.phase)
  const now = useNow(500)
  const touch = runtime.input.touch
  let text = null
  let sub = null
  let hot = false
  if (!tutorialSeen && step < 5 && phase.phase === 'fight') {
    const steps = [
      ['1/5 BREAK A LUCKY BLOCK', touch ? 'Hold the pickaxe button while aiming at it' : 'Hold left click on it'],
      ['2/5 HOLD YOUR BLOCKS', touch ? 'Tap the block slot in your hotbar' : 'Press the number of your block slot'],
      ['3/5 BUILD TO THE MIDDLE ISLAND', touch ? 'Look past the edge - the white box shows where - tap PLACE' : 'Look past the edge - the white box shows where - right click'],
      ['4/5 HIT SOMEONE', touch ? 'Pick your best sword, aim at a player and tap HIT' : 'Pick your best sword, aim at a player and left click'],
      ['5/5 THE LAVA WILL RISE', touch ? 'Stay high: look down, JUMP and PLACE to build a pillar' : 'Stay high: look down, jump and right click to build a pillar'],
    ]
    ;[text, sub] = steps[step].map((x) => t(x))
  } else if (phase.phase === 'fight') {
    const elapsed = ROUND.fightMs - Math.max(0, phase.endsAt - now)
    if (lavaHeight(elapsed, phase.mode) > LAVA.startY + 0.05) {
      text = lavaHeight(elapsed, phase.mode) > LAVA.surgeY ? t('THE LAVA IS SURGING!') : t('THE LAVA IS RISING!')
      hot = true
    }
  }
  if (!text) return null
  return (
    <div className="objective absolute left-1/2 flex -translate-x-1/2 flex-col items-center text-center" style={{ top: u(118) }}>
      <div className={hot ? 'bob' : ''}>
        <Fancy size={hot ? 26 : 32} from={hot ? '#ffe27a' : '#ffffff'} to={hot ? '#ff4a1c' : '#9fe6ff'}>
          {text}
        </Fancy>
      </div>
      {sub && (
        <div className="txt-o" style={{ fontSize: u(18), color: '#e6dcff' }}>
          {sub}
        </div>
      )}
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
    <div key={banner.id} className="kill-banner absolute left-1/2 flex flex-col items-center" style={{ top: '25%' }}>
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
      <span className="txt-o" style={{ fontSize: u(18), color: '#7cff6b' }}>
        +${banner.cash}
      </span>
    </div>
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
    <div className="bottom-bar absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ paddingBottom: u(14), gap: u(6) }}>
      {label?.text && (
        <div key={label.id} className="txt-o pop-in" style={{ fontSize: u(20) }}>
          {label.text}
        </div>
      )}
      <EffectChips effects={me.effects} />
      <div className="hearts-row flex w-full items-end justify-between" style={{ gap: u(16) }}>
        <Hearts hp={me.hp} maxHp={me.maxHp} />
        {me.kills > 0 && (
          <div className="txt-o" style={{ fontSize: u(18), color: '#ff8a8a' }}>
            ⚔ {me.kills}
          </div>
        )}
      </div>
      <div className="hotbar pointer-events-auto flex" style={{ gap: u(3) }}>
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
                <span key={slot.n} className="txt-o bump absolute" style={{ right: u(3), bottom: u(-2), fontSize: u(18), fontWeight: 700 }}>
                  {slot.n}
                </span>
              )}
              <span className="absolute opacity-50" style={{ left: u(4), top: u(1), fontSize: u(11) }}>
                {i + 1}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const EFFECT_LABELS = { speed: ['SPEED', '#5fd3ff'], jump: ['JUMP', '#7cff6b'], strength: ['STRENGTH', '#ff5050'], regen: ['REGEN', '#ff7bd5'], burn: ['BURNING', '#ff9a3c'] }

function EffectChips({ effects }) {
  const now = useNow(500)
  const at = runtime.me.effectsAt
  const list = Object.entries(effects || {}).filter(([k, ms]) => EFFECT_LABELS[k] && ms - (now - at) > 0 && EFFECTS[k])
  if (!list.length) return null
  return (
    <div className="flex" style={{ gap: u(6) }}>
      {list.map(([k, ms]) => (
        <span key={k} className="mc-panel txt-o" style={{ padding: `${u(2)} ${u(8)}`, fontSize: u(14), color: EFFECT_LABELS[k][1] }}>
          {EFFECT_LABELS[k][0]} {Math.ceil((ms - (now - at)) / 1000)}s
        </span>
      ))}
    </div>
  )
}

export function LootPopup() {
  const loot = useGame((s) => s.loot)
  const sword = useGame((s) => s.profile.sword)
  if (!loot) return null
  const color = loot.bad ? '#ff5a3c' : loot.rare ? '#d08cff' : '#ffd23b'
  return (
    <div key={loot.id} className="fade-up absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(190), gap: u(6) }}>
      <Fancy size={38} from={loot.bad ? '#ffb0a0' : loot.rare ? '#f3d4ff' : '#fff7b0'} to={color}>
        {loot.text}
      </Fancy>
      <div className="flex" style={{ gap: u(8) }}>
        {loot.items.map(([id, n], i) => (
          <div key={i} className="mc-panel flex items-center" style={{ padding: `${u(2)} ${u(8)}`, gap: u(4) }}>
            <img src={itemIcon(id, sword)} alt="" className="pixelated" style={{ width: u(28), height: u(28) }} />
            <span className="txt-o" style={{ fontSize: u(16) }}>
              +{n}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SpectateBar() {
  const name = useGame((s) => s.spectating)
  const canJoin = useGame((s) => s.phase.canJoin)
  const cycle = (dir) => {
    const ids = [...runtime.remotes.keys()]
    if (!ids.length) return
    const i = ids.indexOf(runtime.spectate.eid)
    runtime.spectate.eid = ids[(i + dir + ids.length) % ids.length]
    runtime.snap = true
  }
  return (
    <div className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(24), gap: u(8) }}>
      <div className="mc-panel flex items-center" style={{ gap: u(12), padding: `${u(6)} ${u(10)}` }}>
        <Button color="#4b5563" style={{ width: u(46), height: u(40), fontSize: u(22) }} onClick={() => cycle(-1)}>
          ‹
        </Button>
        <div className="flex flex-col items-center" style={{ minWidth: u(200) }}>
          <span className="txt-o" style={{ fontSize: u(13), color: '#bdb3e0' }}>
            SPECTATING
          </span>
          <span className="txt-o" style={{ fontSize: u(22), fontWeight: 700 }}>
            {name || '—'}
          </span>
        </div>
        <Button color="#4b5563" style={{ width: u(46), height: u(40), fontSize: u(22) }} onClick={() => cycle(1)}>
          ›
        </Button>
      </div>
      <div className="flex" style={{ gap: u(10) }}>
        {canJoin && (
          <Button color="#3fae4a" style={{ padding: `${u(6)} ${u(20)}`, fontSize: u(18) }} onClick={() => actions.joinRound()}>
            JOIN ROUND
          </Button>
        )}
        <Button color="#d8443a" style={{ padding: `${u(6)} ${u(20)}`, fontSize: u(18) }} onClick={() => actions.toLobby()}>
          BACK TO LOBBY
        </Button>
      </div>
    </div>
  )
}
