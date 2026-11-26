import { avatarShown } from './game/avatar/state'
import { runtime } from './game/runtime'
import { enterMatch, setBlock, worldState } from './game/world'
import { actions, send } from './net/actions'
import { useGame } from './store/game'
import { useQuality } from './store/quality'

/**
 * `?debug` in the URL exposes game internals on `window.__pp` for the automated
 * perf/screenshot checks and console poking. Off by default; changes nothing else.
 */
export function installDebugHooks() {
  if (typeof window === 'undefined') return
  if (!new URLSearchParams(window.location.search).has('debug')) return
  window.__pp = { runtime, worldState, enterMatch, setBlock, useGame, useQuality, actions, send, avatarShown }
}
