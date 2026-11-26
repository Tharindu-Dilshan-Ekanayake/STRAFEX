import { useEffect, useRef, useState } from 'react'

import { ITEMS } from '@shared/balance'

import { runtime } from '../game/runtime'
import { getGame, useGame } from '../store/game'
import { u } from './format'
import GameIcon from './GameIcon'
import { isTouchDevice } from './device'

/**
 * Phone and tablet controls: a floating stick on the left (its resting spot is shown),
 * drag anywhere on the right to look, and round buttons with pixel icons on the right -
 * jump, hit / break (hold), the use button that changes with what you hold (place, eat,
 * drink, throw, shoot), sneak (a toggle) and the camera. Auto-jump is on with touch.
 */

const LOOK_SPEED = 0.0055
const STICK = 64


/** What the use button does with the item in hand. */
function actionFor(item) {
  switch (item?.kind) {
    case 'block':
    case 'tnt':
      return { icon: 'cube', label: 'PLACE', color: '58,111,216' }
    case 'food':
      return { icon: 'apple', label: 'EAT', color: '230,140,40' }
    case 'potion':
    case 'heart':
      return { icon: 'potion', label: 'DRINK', color: '190,80,220' }
    case 'throw':
      return { icon: 'ball', label: 'THROW', color: '70,170,200' }
    case 'bow':
      return { icon: 'bow', label: 'SHOOT', color: '150,100,50' }
    default:
      return null
  }
}

export default function TouchControls() {
  const [enabled, setEnabled] = useState(isTouchDevice)
  const zone = useGame((s) => s.zone)
  const panel = useGame((s) => s.panel)
  const heldId = useGame((s) => s.me.inv[s.me.sel]?.id)
  const [sneak, setSneak] = useState(false)
  const [held, setHeld] = useState({})
  const stick = useRef({ id: null, ox: 0, oy: 0 })
  const look = useRef({ id: null, x: 0, y: 0 })
  const [knob, setKnob] = useState(null)

  useEffect(() => {
    const onTouch = () => {
      runtime.input.touch = true
      setEnabled(true)
    }
    window.addEventListener('touchstart', onTouch, { once: true, passive: true })
    return () => window.removeEventListener('touchstart', onTouch)
  }, [])

  // Touch layout on: the store knows (the mouse hint hides) and so does CSS (compact HUD).
  useEffect(() => {
    if (!enabled) return
    runtime.input.touch = true
    getGame().setTouchUI(true)
    document.body.classList.add('touch-ui')
  }, [enabled])

  useEffect(() => {
    runtime.input.sneakToggle = sneak
  }, [sneak])

  if (!enabled || panel) return null

  const onStart = (e) => {
    for (const t of e.changedTouches) {
      const left = t.clientX < window.innerWidth * 0.45
      if (left && stick.current.id === null) {
        stick.current = { id: t.identifier, ox: t.clientX, oy: t.clientY }
        setKnob({ ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 })
      } else if (!left && look.current.id === null) {
        look.current = { id: t.identifier, x: t.clientX, y: t.clientY }
      }
    }
  }
  const onMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.current.id) {
        const s = stick.current
        let dx = t.clientX - s.ox
        let dy = t.clientY - s.oy
        const len = Math.hypot(dx, dy)
        if (len > STICK) {
          dx = (dx / len) * STICK
          dy = (dy / len) * STICK
        }
        runtime.input.joyX = dx / STICK
        runtime.input.joyY = -dy / STICK
        setKnob({ ox: s.ox, oy: s.oy, dx, dy })
      } else if (t.identifier === look.current.id) {
        const sens = useGame.getState().settings.sensitivity
        runtime.input.lookX += (t.clientX - look.current.x) * LOOK_SPEED * sens
        runtime.input.lookY += (t.clientY - look.current.y) * LOOK_SPEED * sens
        look.current.x = t.clientX
        look.current.y = t.clientY
      }
    }
  }
  const onEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.current.id) {
        stick.current.id = null
        runtime.input.joyX = 0
        runtime.input.joyY = 0
        setKnob(null)
      } else if (t.identifier === look.current.id) {
        look.current.id = null
      }
    }
  }

  /** A hold button writing `key` into the input while pressed. */
  const hold = (key) => ({
    onTouchStart: (e) => {
      e.stopPropagation()
      runtime.input[key] = true
      setHeld((h) => ({ ...h, [key]: true }))
    },
    onTouchEnd: (e) => {
      e.stopPropagation()
      runtime.input[key] = false
      setHeld((h) => ({ ...h, [key]: false }))
    },
    onTouchCancel: () => {
      runtime.input[key] = false
      setHeld((h) => ({ ...h, [key]: false }))
    },
  })

  const item = ITEMS[heldId]
  const use = actionFor(item)
  const attackIcon = item?.kind === 'sword' ? 'sword' : 'pick'
  const face = (size, rgb, alpha = 0.82) => ({
    width: u(size),
    height: u(size),
    background: `radial-gradient(circle at 35% 30%, rgba(${rgb},${alpha + 0.12}) 0%, rgba(${rgb},${alpha}) 55%, rgba(${rgb},${alpha - 0.15}) 100%)`,
  })
  const label = (text, size = 13) => (
    <span className="txt-o" style={{ fontSize: u(size), marginTop: u(2), letterSpacing: '0.05em' }}>
      {text}
    </span>
  )

  return (
    <div className="touch-root absolute inset-0 z-[5]" data-zone={zone} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd} style={{ touchAction: 'none' }}>
      {/* The stick: where it rests until you touch, then under your thumb. */}
      {knob ? (
        <div className="pointer-events-none absolute" style={{ left: knob.ox - STICK, top: knob.oy - STICK, width: STICK * 2, height: STICK * 2, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.08), rgba(255,255,255,0.2))', border: '3px solid rgba(255,255,255,0.45)' }}>
          <div className="absolute" style={{ left: STICK - 28 + knob.dx, top: STICK - 28 + knob.dy, width: 56, height: 56, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #ffffff, #cfd8ff)', border: '3px solid rgba(13,10,24,0.6)', boxShadow: '0 4px 0 rgba(0,0,0,0.3)' }} />
        </div>
      ) : (
        <div className="stick-ghost pointer-events-none absolute flex items-center justify-center" style={{ left: 28, bottom: 28, width: STICK * 2, height: STICK * 2, borderRadius: '50%', border: '3px dashed rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.06)' }}>
          <span className="txt-o" style={{ fontSize: u(14), opacity: 0.8 }}>
            MOVE
          </span>
        </div>
      )}

      <div className="touch-cluster absolute" style={{ right: u(16), bottom: u(16), width: u(300), height: u(300) }}>
        {/* Jump: the biggest, under your thumb's resting spot. */}
        <button type="button" className={`tbtn absolute ${held.jump ? 'held' : ''}`} style={{ ...face(108, '74,160,60'), right: 0, bottom: 0 }} {...hold('jump')}>
          <GameIcon name="up" size={40} />
          {label('JUMP')}
        </button>
        {zone === 'match' && (
          <>
            <button type="button" className={`tbtn absolute ${held.attack ? 'held' : ''}`} style={{ ...face(96, '216,68,58'), right: u(118), bottom: u(4) }} {...hold('attack')}>
              <GameIcon name={attackIcon} size={36} />
              {label(item?.kind === 'sword' ? 'HIT' : 'BREAK')}
            </button>
            {use && (
              <button type="button" className={`tbtn absolute ${held.use ? 'held' : ''}`} style={{ ...face(88, use.color), right: u(128), bottom: u(114) }} {...hold('use')}>
                <GameIcon name={use.icon} size={32} />
                {label(use.label, 12)}
              </button>
            )}
            <button
              type="button"
              className="tbtn absolute"
              style={{ ...face(66, sneak ? '246,181,45' : '75,85,99', sneak ? 0.92 : 0.75), right: u(20), bottom: u(124) }}
              onTouchStart={(e) => {
                e.stopPropagation()
                setSneak((v) => !v)
              }}
            >
              <GameIcon name="down" size={24} />
              {label(sneak ? 'SNEAK ON' : 'SNEAK', 10)}
            </button>
            <button
              type="button"
              className="tbtn absolute"
              style={{ ...face(54, '75,85,99', 0.7), right: u(30), bottom: u(204) }}
              onTouchStart={(e) => {
                e.stopPropagation()
                runtime.camera.mode = runtime.camera.mode === 'first' ? 'third' : 'first'
              }}
            >
              <GameIcon name="eye" size={22} />
            </button>
          </>
        )}
        {zone === 'lobby' && (
          <button type="button" className={`tbtn absolute ${held.attack ? 'held' : ''}`} style={{ ...face(80, '216,68,58'), right: u(118), bottom: u(8) }} {...hold('attack')}>
            <GameIcon name="sword" size={30} />
            {label('SWING', 12)}
          </button>
        )}
      </div>
    </div>
  )
}
