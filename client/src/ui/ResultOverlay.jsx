import { useEffect, useState } from 'react'

import { exitPointerLock } from '../game/input'
import { actions } from '../net/actions'
import { useGame } from '../store/game'
import { u, useCountUp } from './format'
import { Button, Fancy } from './kit'
import { t } from './i18n'

const HOW = {
  lava: 'You melted in the lava',
  void: 'You fell off the world',
  tnt: 'Blown up by TNT',
  lightning: 'Struck by lightning',
  burn: 'You burned up',
}

/**
 * The end of your round: knocked out (with your place and what you earned, and the
 * choice to watch the rest or go back), or the win.
 */
export default function ResultOverlay() {
  const result = useGame((s) => s.result)
  const reward = useGame((s) => s.roundReward)
  const fighters = useGame((s) => s.phase.fighters)
  // "Spectate" hides this card for this result only; a new result shows again.
  const [hiddenFor, setHiddenFor] = useState(null)

  useEffect(() => {
    if (result && result.kind !== 'over') exitPointerLock()
  }, [result])

  if (!result || hiddenFor === result) return null
  const win = result.kind === 'win'
  const dead = result.kind === 'dead'

  if (result.kind === 'over') {
    return (
      <div className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 text-center" style={{ top: u(220) }}>
        <div className="pop-in">
          <Fancy size={44} from="#fff7b0" to="#ffb21a">{t('{name} WINS!', { name: result.winner })}</Fancy>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in absolute inset-0 z-20 flex items-center justify-center" style={{ background: win ? 'rgba(40,30,0,0.35)' : 'rgba(40,0,0,0.35)' }}>
      {win && <Confetti />}
      <div className="mc-panel pop-in flex flex-col items-center text-center" style={{ padding: `${u(22)} ${u(36)}`, gap: u(10), minWidth: u(420) }}>
        <div className={win ? 'victory-title' : 'shake-in'}>
          <Fancy size={56} from={win ? '#fff7b0' : '#ffd0c4'} to={win ? '#ffb21a' : '#ff3a2a'}>
            {win ? t('VICTORY!') : t('ELIMINATED')}
          </Fancy>
        </div>
        {dead && (
          <div className="txt-o" style={{ fontSize: u(20), color: '#e6dcff' }}>
            {result.by ? `by ${result.by}` : HOW[result.how] || 'Better luck next round'}
          </div>
        )}
        {dead && result.placement === 0 && (
          <div className="txt-o" style={{ fontSize: u(20), color: '#7fdcff' }}>
            Your team is still fighting - spectate and cheer them on!
          </div>
        )}
        {result.placement > 0 && !win && (
          <div className="txt-o" style={{ fontSize: u(26) }}>
            #{result.placement} of {fighters}
          </div>
        )}
        {reward && (
          <div className="flex flex-col items-center" style={{ gap: u(2) }}>
            <RollingCash value={reward.cash} />
            <div className="txt-o" style={{ fontSize: u(16), color: '#cfc6ee' }}>
              {reward.kills} kill{reward.kills === 1 ? '' : 's'}
              {reward.win ? ' · +1 win' : ''}
            </div>
            {reward.xp > 0 && (
              <div className="txt-o" style={{ fontSize: u(18), color: '#7cf0ff', fontWeight: 700 }}>
                +{reward.xp} XP{reward.quests?.length ? ` · ${reward.quests.length} quest${reward.quests.length === 1 ? '' : 's'} done!` : ''}
              </div>
            )}
          </div>
        )}
        {dead && (
          <div className="flex" style={{ gap: u(12), marginTop: u(8) }}>
            <Button color="#3a6fd8" style={{ padding: `${u(8)} ${u(22)}`, fontSize: u(20) }} onClick={() => setHiddenFor(result)}>
              {t('SPECTATE')}
            </Button>
            <Button color="#4a8f2c" style={{ padding: `${u(8)} ${u(22)}`, fontSize: u(20) }} onClick={() => actions.toLobby()}>
              {t('LOBBY')}
            </Button>
          </div>
        )}
        {win && (
          <div className="txt-o" style={{ fontSize: u(16), color: '#cfc6ee' }}>
            {t('Back to the lobby in a moment…')}
          </div>
        )}
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
