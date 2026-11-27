import { useEffect, useRef, useState } from 'react'

import { ITEMS, OFFHAND } from '@shared/balance'

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
function actionFor(item, shield) {
  switch (item?.kind) {
    case 'block':
    case 'crystal':
      return { icon: 'cube', label: 'PLACE', color: '58,111,216' }
    case 'food':
      return { icon: 'apple', label: 'EAT', color: '230,140,40' }
    case 'potion':
      return { icon: 'potion', label: 'DRINK', color: '190,80,220' }
    case 'throw':
    case 'splash':
      return { icon: 'ball', label: 'THROW', color: '70,170,200' }
    case 'bow':
      return { icon: 'bow', label: 'SHOOT', color: '150,100,50' }
    case 'spear':
      return { icon: 'ball', label: 'LUNGE', color: '70,170,90' }
    case 'bucket':
      return item.fill ? { icon: 'ball', label: 'POUR', color: '63,140,255' } : { icon: 'ball', label: 'SCOOP', color: '90,110,140' }
    default:
      // Anything else: right click raises the shield, if you have one.
      return shield ? { icon: 'cube', label: 'BLOCK', color: '120,120,140' } : null
  }
}

/** Thumbs held on a hit/use button, by button: dragging them turns the camera too. */
const btnLook = {}
/** Input keys a thumb holds right now (released when the controls switch to the mouse). */
const thumbHeld = {}

export default function TouchControls() {
  const [enabled, setEnabled] = useState(isTouchDevice)
  const zone = useGame((s) => s.zone)
  const panel = useGame((s) => s.panel)
  const heldId = useGame((s) => s.me.inv[s.me.sel]?.id)
  const hasShield = useGame((s) => s.me.inv[OFFHAND]?.id === 'shield' || s.me.inv[s.me.sel]?.id === 'shield')
  const offItem = useGame((s) => ITEMS[s.me.inv[OFFHAND]?.id])
  const [sneak, setSneak] = useState(false)
  const [held, setHeld] = useState({})
  const stick = useRef({ id: null, ox: 0, oy: 0 })
  const look = useRef({ id: null, x: 0, y: 0 })
  const [knob, setKnob] = useState(null)

  /**
   * The controls follow what you play with. A finger on the screen turns them on; a mouse
   * that really moves (or clicks), or a game key on a keyboard, turns them off again - so a
   * touch-screen laptop played with its mouse never shows the phone buttons.
   */
  useEffect(() => {
    let mouseTravel = 0
    const onTouch = () => {
      mouseTravel = 0
      runtime.input.touch = true
      setEnabled(true)
    }
    // Back to mouse and keyboard: nothing left held down by a thumb.
    const toMouse = () => {
      if (!runtime.input.touch && !getGame().touchUI) return
      runtime.input.touch = false
      runtime.input.joyX = 0
      runtime.input.joyY = 0
      stick.current.id = null
      look.current.id = null
      for (const key of Object.keys(btnLook)) delete btnLook[key]
      for (const key of Object.keys(thumbHeld)) {
        if (thumbHeld[key]) runtime.input[key] = false
        delete thumbHeld[key]
      }
      setHeld({})
      setSneak(false)
      setKnob(null)
      setEnabled(false)
    }
    const onPointerMove = (e) => {
      if (e.pointerType !== 'mouse') return
      mouseTravel += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0)
      if (mouseTravel > 60) toMouse()
    }
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') toMouse()
    }
    const onKey = (e) => {
      if (/^(Key[WASDEFQR]|Space|Digit[1-9]|Shift(Left|Right))$/.test(e.code)) toMouse()
    }
    window.addEventListener('touchstart', onTouch, { passive: true })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Touch layout on or off: the store knows (the mouse hint) and so does CSS (compact HUD).
  useEffect(() => {
    if (enabled) {
      runtime.input.touch = true
      getGame().setTouchUI(true)
      document.body.classList.add('touch-ui')
      return
    }
    runtime.input.touch = false
    getGame().setTouchUI(false)
    document.body.classList.remove('touch-ui')
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
      thumbHeld[key] = true
      setHeld((h) => ({ ...h, [key]: true }))
    },
    onTouchEnd: (e) => {
      e.stopPropagation()
      runtime.input[key] = false
      thumbHeld[key] = false
      setHeld((h) => ({ ...h, [key]: false }))
    },
    onTouchCancel: () => {
      runtime.input[key] = false
      thumbHeld[key] = false
      setHeld((h) => ({ ...h, [key]: false }))
    },
  })

  /**
   * Like `hold`, and the thumb on the button aims too: slide it while holding and the
   * camera turns with it - hit (or block, or draw a bow) and aim with one thumb, no need
   * to let go and turn first.
   */
  const holdLook = (key) => {
    const h = hold(key)
    return {
      onTouchStart: (e) => {
        h.onTouchStart(e)
        const t = e.changedTouches[0]
        if (t) btnLook[key] = { id: t.identifier, x: t.clientX, y: t.clientY }
      },
      onTouchMove: (e) => {
        e.stopPropagation()
        const s = btnLook[key]
        if (!s) return
        for (const t of e.changedTouches) {
          if (t.identifier !== s.id) continue
          const sens = useGame.getState().settings.sensitivity
          runtime.input.lookX += (t.clientX - s.x) * LOOK_SPEED * sens
          runtime.input.lookY += (t.clientY - s.y) * LOOK_SPEED * sens
          s.x = t.clientX
          s.y = t.clientY
        }
      },
      onTouchEnd: (e) => {
        h.onTouchEnd(e)
        btnLook[key] = null
      },
      onTouchCancel: (e) => {
        h.onTouchCancel(e)
        btnLook[key] = null
      },
    }
  }

  const item = ITEMS[heldId]
  // The use button follows the hand right click would use: the right, else the left.
  const use = actionFor(item, hasShield) || actionFor(offItem, false)
  const attackIcon = item?.kind === 'sword' ? 'sword' : 'pick'
  // Minecraft-style touch buttons: square, see-through, tinted by what they do.
  const face = (size, rgb, alpha = 0.82) => ({
    width: u(size),
    height: u(size),
    background: `linear-gradient(180deg, rgba(${rgb},${Math.min(0.85, alpha - 0.1)}) 0%, rgba(${rgb},${Math.max(0.35, alpha - 0.3)}) 100%)`,
  })
  const label = (text, size = 13) => (
    <span className="tbtn-label" style={{ fontSize: u(size - 1), marginTop: u(3) }}>
      {text}
    </span>
  )

  return (
    <div className="touch-root absolute inset-0 z-[5]" data-zone={zone} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd} style={{ touchAction: 'none' }}>
      {/* The stick: where it rests until you touch, then under your thumb. */}
      {knob ? (
        <div className="stick-ring pointer-events-none absolute" style={{ left: knob.ox - STICK, top: knob.oy - STICK, width: STICK * 2, height: STICK * 2 }}>
          <div className="stick-knob absolute" style={{ left: STICK - 28 + knob.dx, top: STICK - 28 + knob.dy, width: 56, height: 56 }} />
        </div>
      ) : (
        <div className="stick-ghost stick-ring pointer-events-none absolute flex items-center justify-center" style={{ left: 28, bottom: 28, width: STICK * 2, height: STICK * 2, opacity: 0.75 }}>
          <span className="tbtn-label" style={{ fontSize: u(14) }}>
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
            <button type="button" className={`tbtn absolute ${held.attack ? 'held' : ''}`} style={{ ...face(96, '216,68,58'), right: u(118), bottom: u(4) }} {...holdLook('attack')}>
              <GameIcon name={attackIcon} size={36} />
              {label('HIT')}
            </button>
            {use && (
              <button type="button" className={`tbtn absolute ${held.use ? 'held' : ''}`} style={{ ...face(88, use.color), right: u(128), bottom: u(114) }} {...holdLook('use')}>
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
          <button type="button" className={`tbtn absolute ${held.attack ? 'held' : ''}`} style={{ ...face(80, '216,68,58'), right: u(118), bottom: u(8) }} {...holdLook('attack')}>
            <GameIcon name="sword" size={30} />
            {label('SWING', 12)}
          </button>
        )}
      </div>
    </div>
  )
}
