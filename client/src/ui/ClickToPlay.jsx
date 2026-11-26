import { useEffect } from 'react'

import { requestPointerLock } from '../game/input'
import { runtime } from '../game/runtime'
import { useGame } from '../store/game'
import { u } from './format'
import { t } from './i18n'
import { isTouchDevice } from './device'

/**
 * Desktop: clicking the 3D view captures the mouse (Esc lets it go, for the menus).
 * While it isn't captured, a hint says so - never blocking the buttons.
 */
export default function ClickToPlay() {
  const locked = useGame((s) => s.pointerLocked)
  const panel = useGame((s) => s.panel)
  const caseOpen = useGame((s) => s.caseOpen)
  const result = useGame((s) => s.result)
  const zone = useGame((s) => s.zone)
  const touchUI = useGame((s) => s.touchUI)

  useEffect(() => {
    const onDown = (e) => {
      if (runtime.input.touch || e.button !== 0) return
      if (e.target instanceof HTMLCanvasElement) requestPointerLock(e.target)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  // Touch screens get touch controls, not a mouse hint (the same check TouchControls uses,
  // and its store flag for screens that only reveal touch on the first tap).
  if (locked || panel || caseOpen || touchUI || runtime.input.touch || isTouchDevice() || (result && result.kind !== 'over')) return null
  return (
    <div className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 text-center" style={{ top: '62%' }}>
      <div className="mc-panel txt-o" style={{ padding: `${u(8)} ${u(18)}`, fontSize: u(20), opacity: 0.92 }}>
        {zone === 'match' ? t('CLICK TO PLAY') : t('CLICK TO LOOK AROUND')}
        <div style={{ fontSize: u(14), color: '#cfc6ee', marginTop: u(4) }}>
          WASD move · Space jump · Shift sneak · {zone === 'match' ? 'L-click break/hit · R-click place/use' : 'E open cases · Esc menu'}
        </div>
      </div>
    </div>
  )
}
