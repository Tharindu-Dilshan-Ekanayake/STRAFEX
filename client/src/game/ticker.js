import { LAVA } from '@shared/balance'
import { CENTER } from '@shared/maps'

import { setAmbience, setMusicMood, sfx } from '../audio/sfx'
import { actions, send } from '../net/actions'
import { getGame } from '../store/game'
import { runtime } from './runtime'
import { lobbyLayout } from './world'
import { t } from '../ui/i18n'

/**
 * The only bridge from per-frame state to the UI: ten times a second, copies the slow
 * things the HUD shows out of `runtime` into the store - the station in reach, who you
 * are spectating, tutorial steps - and plays the lava warning. Never from a frame loop.
 */
export function startGameTicker() {
  let lavaWarned = false
  let surgeWarned = false
  let lavaLessonAt = 0
  let tutorialSent = false
  let tutorialReported = 0
  let lastCount = -1
  const id = setInterval(() => {
    const game = getGame()
    const b = runtime.player.body

    // A case station in reach (lobby only).
    let prompt = null
    if (runtime.zone === 'lobby') {
      for (const st of lobbyLayout().stations) {
        if (Math.hypot(b.x - st.x, b.z - st.z) < st.r && Math.abs(b.y - st.y) < 3) prompt = st.id
      }
    }
    game.setPrompt(prompt)

    // Spectating: whose round we're watching.
    if (runtime.zone === 'spec') {
      const r = runtime.remotes.get(runtime.spectate.eid)
      game.setSpectating(r ? r.name || 'Player' : null)
    } else game.setSpectating(null)

    // Tutorial: made it to the middle island; then a hit; then the lava lesson.
    if (game.tutorial === 2 && runtime.zone === 'match' && Math.hypot(b.x - CENTER.x, b.z - CENTER.z) < 11) game.setTutorial(3)
    if (game.tutorial === 4) {
      lavaLessonAt ||= performance.now()
      if (performance.now() - lavaLessonAt > 9000 || (runtime.zone === 'match' && b.y > runtime.lava.y + 12 && runtime.lava.y > 6.3)) game.setTutorial(5)
    }
    // Analytics: how far through the tutorial people get.
    if (game.tutorial > tutorialReported && !game.profile.tutorial) {
      tutorialReported = game.tutorial
      send('tut', { step: game.tutorial })
    }
    if (game.tutorial >= 5 && !game.profile.tutorial && !tutorialSent) {
      tutorialSent = true
      actions.tutorialDone()
    }

    // The lava starts to climb: one rumble per round.
    const phase = game.phase
    if (phase.phase === 'fight' && runtime.zone === 'match') {
      if (!lavaWarned && runtime.lava.y > 6.3) {
        lavaWarned = true
        sfx.lavaWarn()
      }
      // The surge: from here the lava floods the islands.
      if (!surgeWarned && runtime.lava.y > LAVA.surgeY + 0.2) {
        surgeWarned = true
        sfx.lavaWarn()
        game.showToast(t('The lava is surging - get high or get to the middle!'), 'error')
      }
    } else {
      lavaWarned = false
      surgeWarned = false
    }

    // Music and ambience follow where you are and how tight the round is.
    const inRound = runtime.zone !== 'lobby'
    const tense = inRound && phase.phase === 'fight' && (runtime.lava.y > 6.3 || (phase.teamSize > 1 ? phase.teamsLeft : phase.alive) <= 2)
    setMusicMood(!inRound ? 'lobby' : tense ? 'tense' : 'match')
    if (!inRound) setAmbience('wind', 0.8)
    else {
      const above = b.y - runtime.lava.y
      setAmbience('lava', runtime.zone === 'spec' ? 0.35 : Math.max(0.12, 1 - above / 26))
    }

    // Countdown beeps: the last three seconds in the cages.
    const count = phase.phase === 'cages' && inRound ? Math.ceil((phase.endsAt - performance.now()) / 1000) : -1
    if (count !== lastCount) {
      if (count >= 1 && count <= 3) sfx.countdown(count)
      // The cages just opened: GO!
      else if (lastCount >= 0 && phase.phase === 'fight') sfx.go()
      lastCount = count
    }

    game.pruneFeed()
  }, 100)
  return () => clearInterval(id)
}
