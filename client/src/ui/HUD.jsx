import { MODES, ROUND } from '@shared/balance'
import { MAPS } from '@shared/maps'

import { actions } from '../net/actions'
import { useGame, voteOnScreen } from '../store/game'
import { formatClock, u, useNow } from './format'
import { Button, Fancy } from './kit'
import { BigCount, BottomBar, Crosshair, LootPopup, Objective, SpectateBar, TeamChip } from './hud/Round'
import { LevelUpBanner, Toasts, TopRight } from './hud/Corner'
import { LobbyMenu, PlayerCount, StationPrompt, VoteCards, Wallet, WelcomeGift } from './hud/Lobby'
import { t } from './i18n'

/**
 * The heads-up display: round clock and players left, the objective, hearts, hotbar,
 * crosshair, kill feed, loot popups and toasts in a round; the vote, menu, wallet and
 * case prompt in the lobby; the spectator bar when you're out.
 */
export default function HUD() {
  const zone = useGame((s) => s.zone)
  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-white">
      {/* Every zone change (lobby, round, spectating) fades in from dark. */}
      <div key={zone} className="zone-fade" />
      <TopCenter />
      {zone === 'match' && (
        <>
          <Objective />
          <BigCount />
          <Crosshair />
          <BottomBar />
          <LootPopup />
        </>
      )}
      {zone === 'lobby' && (
        <>
          <LobbyMenu />
          <Wallet />
          <StationPrompt />
          <WelcomeGift />
        </>
      )}
      {zone === 'spec' && <SpectateBar />}
      <TopRight />
      <LevelUpBanner />
      <Toasts />
    </div>
  )
}

function TopCenter() {
  const phase = useGame((s) => s.phase)
  const zone = useGame((s) => s.zone)
  const now = useNow(250)
  const left = Math.max(0, phase.endsAt - now)

  // Title as parts: [text, highlighted?] - each drawn as gradient title text.
  let parts = null
  let sub = null
  let bar = null
  if (zone !== 'lobby') {
    if (phase.phase === 'cages') {
      parts = [[t('CAGES OPEN IN')], [String(Math.ceil(left / 1000)), true]]
      sub = MODES[phase.mode]?.name ? `${t(MODES[phase.mode].name)} · ${t(MAPS[phase.map]?.name || '')}` : null
    } else if (phase.phase === 'fight') {
      const teams = phase.teamSize > 1
      parts = [[`${teams ? phase.teamsLeft : phase.alive}`, true], [teams ? t('TEAMS LEFT') : t('PLAYERS LEFT')], [formatClock(left), true]]
      bar = left / ROUND.fightMs
    } else if (phase.phase === 'ended') parts = [[t('ROUND OVER')]]
  } else if (phase.phase === 'intermission') {
    const stage = { mode: 'PICK THE MODE', map: 'PICK THE MAP' }[phase.voteStage] || 'ROUND STARTS IN'
    parts = [[t(stage)], [formatClock(left), true]]
  } else if (phase.phase === 'waiting') {
    parts = [[phase.afk ? t('YOU ARE AFK') : t('WAITING FOR PLAYERS...')]]
    sub = phase.afk ? t('Turn AFK off to join the next round') : null
  } else {
    parts = [[t('ROUND IN PROGRESS ·')], [`${phase.alive}`, true], [t('LEFT')]]
  }

  return (
    <div className="top-center absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top: u(12), gap: u(8) }}>
      {parts && (
        <div key={`${zone}:${phase.phase}`} className="drop-in flex items-baseline" style={{ gap: u(14) }}>
          {parts.map(([text, hot], i) => (
            <Fancy key={i} size={30} from={hot ? '#fff7b0' : '#ffffff'} to={hot ? '#ffb21a' : '#d7ccff'}>
              {text.trim()}
            </Fancy>
          ))}
        </div>
      )}
      {bar !== null && (
        <div className="mc-panel" style={{ width: u(460), height: u(20), padding: u(3) }}>
          <div style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%`, height: '100%', background: bar < 0.25 ? 'linear-gradient(#ffb36b, #e2441c)' : 'linear-gradient(#d9a8ff 0%, #a35cff 50%, #7a2fe0 100%)', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.35)' }} />
        </div>
      )}
      {sub && (
        <div className="txt-o" style={{ fontSize: u(18), color: '#d9ccff' }}>
          {sub}
        </div>
      )}
      {zone !== 'lobby' && phase.teamSize > 1 && (phase.phase === 'cages' || phase.phase === 'fight') && <TeamChip />}
      {zone === 'lobby' && <PlayerCount />}
      {voteOnScreen(phase, zone) && <VoteCards phase={phase} />}
      {zone === 'lobby' && (phase.phase === 'cages' || phase.phase === 'fight') && (
        <div className="pointer-events-auto flex" style={{ gap: u(10) }}>
          {phase.canJoin && (
            <Button color="#3fae4a" style={{ padding: `${u(8)} ${u(26)}`, fontSize: u(22) }} onClick={() => actions.joinRound()}>
              {t('JOIN ROUND')}
            </Button>
          )}
          <Button color="#3a6fd8" style={{ padding: `${u(8)} ${u(26)}`, fontSize: u(22) }} onClick={() => actions.spectate()}>
            {t('SPECTATE')}
          </Button>
        </div>
      )}
    </div>
  )
}
