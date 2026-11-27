import { setAmbience, setMusicMood, sfx } from '../audio/sfx'
import { getGame } from '../store/game'
import { runtime } from './runtime'
import { lobbyLayout } from './world'

/**
 * The only bridge from per-frame state to the UI: ten times a second, copies the slow
 * things the HUD shows out of `runtime` into the store - the station in reach, who you
 * are spectating - and plays the duel countdown. Never from a frame loop.
 */
export function startGameTicker() {
  let lastCount = -1
  const id = setInterval(() => {
    const game = getGame()
    const b = runtime.player.body

    // A station in reach (lobby only): the Duels arch, the Spirelands portal, a case stall.
    let prompt = null
    if (runtime.zone === 'lobby') {
      for (const st of lobbyLayout().stations) {
        if (Math.hypot(b.x - st.x, b.z - st.z) < st.r && Math.abs(b.y - st.y) < 3) prompt = st.id
      }
    }
    game.setPrompt(prompt)

    // Spectating: who we're watching.
    if (runtime.zone === 'spec') {
      const r = runtime.remotes.get(runtime.spectate.eid)
      game.setSpectating(r ? r.name || 'Player' : null)
    } else game.setSpectating(null)

    // Music and ambience follow where you are and how close the fight is.
    const phase = game.phase
    const inFight = runtime.zone !== 'lobby'
    let tense = false
    if (inFight && phase.kind === 'duel') {
      const ft = phase.ft || 1
      tense = (phase.score || []).some((s) => s.wins === ft - 1) || runtime.me.hp < 7
    } else if (inFight) tense = runtime.me.hp < 7
    setMusicMood(!inFight ? 'lobby' : tense ? 'tense' : 'match')
    setAmbience('wind', inFight ? 0.5 : 0.8)

    // Countdown beeps: the last three seconds before a round.
    const count = phase.kind === 'duel' && phase.phase === 'countdown' && inFight ? Math.ceil((phase.endsAt - performance.now()) / 1000) : -1
    if (count !== lastCount) {
      if (count >= 1 && count <= 3) sfx.countdown(count)
      lastCount = count
    }

    game.pruneFeed()
  }, 100)
  return () => clearInterval(id)
}
