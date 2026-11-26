import { HOTBAR } from '@shared/balance'

import { sfx } from '../audio/sfx'
import { actions } from '../net/actions'
import { getGame } from '../store/game'
import { runtime } from './runtime'

/**
 * Keyboard, mouse and pointer lock. Writes raw input into `runtime.input`; the
 * controller (Player.jsx) turns it into movement and actions each frame. Touch input
 * lives in ui/TouchControls.jsx and writes to the same place.
 *
 * Desktop controls: WASD move, Space jump, Shift (or W tapped twice) sprint, C sneak (never
 * fall off an edge), left mouse attack (every click counts) / break (hold), right mouse
 * place / use / block with a shield / eat (hold), 1-9 or the wheel pick a slot, E use a
 * station (in a fight: the inventory), F swap hands, R play again after a duel, V switch
 * camera.
 */

const KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  // Shift runs; C sneaks (Ctrl is left alone: Ctrl+W would close the tab).
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'sneak',
}

let lastForwardTap = 0
let doubleTapSprint = false
/** A sprint hit spent your sprint; letting go of forward (or Ctrl) brings it back. */
let spent = false
let spentAt = 0

/** `sprintSpent()` reads it; `sprintSpent(true)` spends it (after a sprint hit). */
export function sprintSpent(set) {
  if (set) {
    spent = true
    spentAt = performance.now()
  }
  // Touch has no forward key to let go of: the sprint comes back by itself.
  if (spent && runtime.input.touch && performance.now() - spentAt > 380) spent = false
  return spent
}

/** Picks hotbar slot `slot`: shown at once here, confirmed by the host. */
export function selectSlot(slot) {
  const s = ((slot % HOTBAR) + HOTBAR) % HOTBAR
  if (runtime.me.sel === s) return
  runtime.me = { ...runtime.me, sel: s }
  const game = getGame()
  game.setMe({ ...game.me, sel: s })
  runtime.bowPullAt = 0
  actions.select(s)
  sfx.select()
}

/** Whether the game should be taking mouse/keyboard input right now. */
const playing = () => !getGame().panel && !getGame().caseOpen

export function requestPointerLock(canvas) {
  if (getGame().panel || runtime.input.touch) return
  const target = canvas || document.querySelector('canvas')
  try {
    const p = target?.requestPointerLock?.({ unadjustedMovement: true })
    // Some browsers reject unadjustedMovement; retry plain.
    p?.catch?.(() => target?.requestPointerLock?.())
  } catch {
    target?.requestPointerLock?.()
  }
}

export function exitPointerLock() {
  if (document.pointerLockElement) document.exitPointerLock()
}

/** Installs the handlers; returns the cleanup. */
export function installInput() {
  const input = runtime.input
  const locked = () => Boolean(document.pointerLockElement)

  const onKeyDown = (e) => {
    if (e.target instanceof HTMLInputElement) return
    const game = getGame()
    if (e.code === 'Escape' || (e.code === 'KeyE' && game.panel === 'inventory')) {
      if (game.quickChat) game.setQuickChat(false)
      if (game.panel) game.closePanel()
      return
    }
    // Quick chat: T opens the picker; a number says that line.
    if (e.code === 'KeyT' && !game.panel && !e.repeat) {
      game.setQuickChat(!game.quickChat)
      return
    }
    if (game.quickChat && e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5))
      actions.quickChat(n === 0 ? 9 : n - 1)
      game.setQuickChat(false)
      return
    }
    if (!playing()) return
    const key = KEYS[e.code]
    if (key) {
      if (key === 'forward' && !e.repeat) {
        const now = performance.now()
        if (now - lastForwardTap < 280) doubleTapSprint = true
        lastForwardTap = now
      }
      input[key] = true
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5))
      if (n >= 1 && n <= HOTBAR) selectSlot(n - 1)
    }
    if (e.code === 'KeyV' || e.code === 'F5') {
      runtime.camera.mode = runtime.camera.mode === 'first' ? 'third' : 'first'
      e.preventDefault()
    }
    // In a fight: E is the inventory, F swaps what's in your hands.
    if (e.code === 'KeyE' && !e.repeat && runtime.zone === 'match') {
      exitPointerLock()
      game.togglePanel('inventory')
      return
    }
    if (e.code === 'KeyF' && !e.repeat && runtime.zone === 'match') {
      actions.swapHands()
      sfx.select()
      return
    }
    if (e.code === 'KeyE' && !e.repeat) {
      if (game.prompt?.startsWith('case:')) {
        exitPointerLock()
        game.openPanel('cases', { caseId: game.prompt.slice(5) })
      } else if (game.prompt === 'duels') {
        exitPointerLock()
        game.openPanel('modes')
      } else if (game.prompt === 'ffa') actions.ffa()
    }
    if (e.code === 'KeyR' && !e.repeat && game.duelOver) actions.requeue()
    if (e.code === 'KeyB' && runtime.zone === 'lobby') {
      exitPointerLock()
      game.openPanel('backpack')
    }
  }
  const onKeyUp = (e) => {
    const key = KEYS[e.code]
    if (!key) return
    input[key] = false
    if (key === 'forward') {
      doubleTapSprint = false
      spent = false
    }
    if (key === 'sprint') spent = false
  }

  const onMouseDown = (e) => {
    if (!locked() || !playing()) return
    if (e.button === 0) input.attack = true
    if (e.button === 2) input.use = true
  }
  const onMouseUp = (e) => {
    if (e.button === 0) input.attack = false
    if (e.button === 2) input.use = false
  }
  const onMouseMove = (e) => {
    if (!locked() || !playing()) return
    const { sensitivity, invertY } = getGame().settings
    const k = 0.0022 * sensitivity
    input.lookX += e.movementX * k
    input.lookY += e.movementY * k * (invertY ? -1 : 1)
  }
  const onWheel = (e) => {
    if (!locked() || !playing()) return
    selectSlot(runtime.me.sel + Math.sign(e.deltaY))
  }
  const onContextMenu = (e) => e.preventDefault()
  const onLockChange = () => {
    const isLocked = locked()
    getGame().setPointerLocked(isLocked)
    if (!isLocked) {
      input.attack = false
      input.use = false
    }
  }
  const onBlur = () => {
    for (const key of Object.values(KEYS)) input[key] = false
    input.attack = false
    input.use = false
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('blur', onBlur)
  document.addEventListener('pointerlockchange', onLockChange)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('pointerlockchange', onLockChange)
  }
}

/** Sprinting from the keyboard: Shift, or W tapped twice. */
export const wantsSprint = () => runtime.input.sprint || doubleTapSprint
