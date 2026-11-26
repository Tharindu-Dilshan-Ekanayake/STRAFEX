import { useEffect, useState } from 'react'

import { MODES, TEAMS } from '@shared/balance'

import { exitPointerLock } from '../game/input'
import { runtime } from '../game/runtime'
import { actions } from '../net/actions'
import { useGame } from '../store/game'
import { u, useCountUp } from './format'
import { Button, Fancy } from './kit'
import { t } from './i18n'

const HOW = {
  void: 'You fell into the void',
  fall: 'You fell too far',
  boom: 'Blown up by a crystal',
  pearl: 'Your own pearl',
}

/**
 * The end of a duel (victory or defeat: the score, your numbers, what you earned, play
 * again), and being knocked out in Spirelands (who got you; the kit picker sits below).
 */
export default function ResultOverlay() {
  const duelOver = useGame((s) => s.duelOver)
  const result = useGame((s) => s.result)
  if (duelOver) return <DuelOver over={duelOver} />
  if (result?.kind === 'dead' && result.mode === 'ffa') {
    return (
      <div className="pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 text-center" style={{ top: u(70) }}>
        <div className="shake-in flex flex-col items-center">
          <Fancy size={44} from="#ffd0c4" to="#ff3a2a">
            {t('DEFEATED')}
          </Fancy>
          <span className="txt-o" style={{ fontSize: u(18), color: '#e6dcff' }}>
            {result.by ? t('by {name}', { name: result.by }) : t(HOW[result.how] || 'Better luck next life')}
          </span>
        </div>
      </div>
    )
  }
  return null
}

function DuelOver({ over }) {
  const reward = useGame((s) => s.roundReward)
  const stats = useGame((s) => s.duelStats)
  const [shown, setShown] = useState(true)
  useEffect(() => {
    exitPointerLock()
  }, [over])
  if (!shown) return null
  const win = over.win
  return (
    <div className="fade-in absolute inset-0 z-20 flex items-center justify-center" style={{ background: win ? 'rgba(40,30,0,0.35)' : 'rgba(40,0,0,0.35)' }}>
      {win && <Confetti />}
      <div className="mc-panel pop-in pointer-events-auto flex flex-col items-center text-center" style={{ padding: `${u(20)} ${u(32)}`, gap: u(10), minWidth: u(440) }}>
        <div className={win ? 'victory-title' : 'shake-in'}>
          <Fancy size={56} from={win ? '#fff7b0' : '#ffd0c4'} to={win ? '#ffb21a' : '#ff3a2a'}>
            {win ? t('VICTORY!') : t('DEFEAT')}
          </Fancy>
        </div>
        <span className="txt-o" style={{ fontSize: u(15), color: '#d9ccff' }}>
          {t(MODES[over.mode]?.name || '')} 1v1{over.forfeit ? ` · ${t('by forfeit')}` : ''}
        </span>
        <div className="flex items-center" style={{ gap: u(16) }}>
          {(over.score || []).map((s, i) => (
            <div key={s.eid} className="flex items-center" style={{ gap: u(8), flexDirection: i ? 'row-reverse' : 'row' }}>
              <span className="txt-o" style={{ fontSize: u(20), fontWeight: 700, color: TEAMS[s.team]?.color }}>
                {s.eid === runtime.eid ? t('You') : s.name}
              </span>
              <span className="txt-o" style={{ fontSize: u(32), fontWeight: 700 }}>
                {s.wins}
              </span>
            </div>
          ))}
        </div>
        {stats && (
          <div className="grid txt-o" style={{ gridTemplateColumns: 'repeat(3, auto)', gap: `${u(2)} ${u(18)}`, fontSize: u(14) }}>
            <span>
              {t('Hits')} <b style={{ color: '#7cff6b' }}>{stats.hits}</b>
            </span>
            <span>
              {t('Dealt')} <b style={{ color: '#ffd23b' }}>{Number(stats.dealt).toFixed(1)}</b>
            </span>
            <span>
              {t('Best Combo')} <b style={{ color: '#c9a6ff' }}>{stats.best}</b>
            </span>
            <span>
              {t('Hits Taken')} <b style={{ color: '#ff8a8a' }}>{stats.taken}</b>
            </span>
            <span>
              {t('Taken')} <b style={{ color: '#ff6b6b' }}>{Number(stats.dmgTaken).toFixed(1)}</b>
            </span>
          </div>
        )}
        {reward && (
          <div className="flex flex-col items-center" style={{ gap: u(2) }}>
            <RollingCash value={reward.cash} />
            {reward.xp > 0 && (
              <div className="txt-o" style={{ fontSize: u(17), color: '#7cf0ff', fontWeight: 700 }}>
                +{reward.xp} XP{reward.quests?.length ? ` · ${t(reward.quests.length === 1 ? '{n} quest done!' : '{n} quests done!', { n: reward.quests.length })}` : ''}
              </div>
            )}
          </div>
        )}
        <div className="flex" style={{ gap: u(12), marginTop: u(6) }}>
          <Button color="#3fae4a" style={{ padding: `${u(8)} ${u(22)}`, fontSize: u(20) }} onClick={() => actions.requeue()}>
            {runtime.input.touch ? t('PLAY AGAIN') : t('PLAY AGAIN (R)')}
          </Button>
          <Button color="#3a6fd8" style={{ padding: `${u(8)} ${u(22)}`, fontSize: u(20) }} onClick={() => actions.toLobby()}>
            {t('LOBBY')}
          </Button>
          <Button color="#4b5563" style={{ padding: `${u(8)} ${u(14)}`, fontSize: u(16) }} onClick={() => setShown(false)}>
            ✕
          </Button>
        </div>
      </div>
    </div>
  )
}

function RollingCash({ value }) {
  const shown = useCountUp(value, 900, 0)
  return (
    <div className="txt-o" style={{ fontSize: u(30), color: '#7cff6b', fontWeight: 700 }}>
      +${shown}
    </div>
  )
}

const CONFETTI_COLORS = ['#ffd23b', '#ff5a8a', '#5fd3ff', '#7cff6b', '#c58bff', '#ffffff']

/** A burst of confetti: CSS only (transform + opacity), 36 little rectangles, gone in 3 s. */
function Confetti() {
  const [bits] = useState(() =>
    Array.from({ length: 36 }, (_, i) => ({
      left: 5 + Math.random() * 90,
      dx: (Math.random() - 0.5) * 30,
      rot: 360 + Math.random() * 720,
      delay: Math.random() * 0.5,
      dur: 2 + Math.random() * 1.2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      w: 6 + Math.random() * 6,
    })),
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="confetti"
          style={{ left: `${b.left}%`, width: u(b.w), height: u(b.w * 1.6), background: b.color, '--dx': `${b.dx}vw`, '--rot': `${b.rot}deg`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }}
        />
      ))}
    </div>
  )
}
