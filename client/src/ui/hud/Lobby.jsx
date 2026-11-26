import { useEffect, useRef, useState } from 'react'

import { BOT_LEVELS, CASES, MODES, MODE_IDS } from '@shared/balance'
import { MAP_IDS, MAPS } from '@shared/maps'
import { dailyStatus } from '@shared/logic'

import { exitPointerLock } from '../../game/input'
import { runtime } from '../../game/runtime'
import { actions } from '../../net/actions'
import { switchLobby } from '../../net/connection'
import { useGame } from '../../store/game'
import { formatCash, u, useCountUp, useNow } from '../format'
import { Button, Fancy } from '../kit'
import { t } from '../i18n'
import GameIcon from '../GameIcon'

/** The lobby HUD: the vote, server fill, the menu, wallet and case prompt, the welcome gift. */

/** How many people are in this server (online only: offline there's nothing to say). */
export function PlayerCount() {
  const net = useGame((s) => s.net)
  if (net.mode !== 'online') return null
  const text = net.isPrivate ? t('PRIVATE ROOM {code} · {n}/{max} PLAYERS', { code: net.code || '', n: net.players, max: net.maxPlayers }) : t('{n}/{max} PLAYERS', { n: net.players, max: net.maxPlayers })
  return (
    <div className="flex items-center" style={{ gap: u(10) }}>
      <span className="txt-o" style={{ fontSize: u(14), color: '#bfe8ff' }}>
        {text}
      </span>
      {net.mode === 'online' && net.isPrivate && (
        <Button className="pointer-events-auto" color="#3a6fd8" style={{ padding: `${u(2)} ${u(10)}`, fontSize: u(13) }} onClick={() => switchLobby({ mode: 'public' })}>
          PUBLIC SERVER
        </Button>
      )}
    </div>
  )
}

/**
 * The lobby vote, decided by everyone in the room, in two steps: first the mode (and
 * whether to play with bots, and how hard), then - with the chosen mode shown - the map.
 * Each step ends when its time is up or as soon as everyone has voted; once the map is
 * picked the round starts.
 */
export function VoteCards({ phase }) {
  const now = useNow(250)
  const label = (n) => t(n === 1 ? '{n} VOTE' : '{n} VOTES', { n: n || 0 })
  const modeStep = phase.voteStage !== 'map'
  const stageLeft = Math.max(0, (phase.stageEndsAt || 0) - now)
  const step = (n, text) => (
    <div className="flex items-center" style={{ gap: u(10) }}>
      <span className="chip" style={{ fontSize: u(13), color: '#ffd23b' }}>
        {t('STEP {n}/2', { n })}
      </span>
      <Fancy size={22} from="#ffffff" to="#c9b8ff">
        {t(text)}
      </Fancy>
      {phase.phase === 'intermission' && (
        <span className="chip" style={{ fontSize: u(15), color: '#ffd23b' }}>
          {Math.ceil(stageLeft / 1000)}s
        </span>
      )}
    </div>
  )

  if (modeStep) {
    return (
      <div className="vote-panel pointer-events-auto mc-panel flex flex-col items-center" style={{ gap: u(10), marginTop: u(4), padding: `${u(10)} ${u(12)} ${u(12)}` }}>
        {step(1, 'PICK THE MODE')}
        <div className="vote-row vote-modes" style={{ gap: u(8) }}>
          {MODE_IDS.map((id, i) => {
            const m = MODES[id]
            const mine = phase.myVote === id
            return (
              <button
                key={id}
                type="button"
                className={`mc-btn vote-card flex flex-col items-center text-center ${mine ? 'picked' : ''}`}
                style={{ '--c': m.color, '--i': i, width: u(150), padding: `${u(8)} ${u(8)}` }}
                onClick={() => actions.vote(id)}
              >
                <img
                  src={`${import.meta.env.BASE_URL}modes/${id}.webp`}
                  alt=""
                  draggable={false}
                  style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: u(9), marginBottom: u(4), boxShadow: '0 2px 0 rgba(0,0,0,0.25)' }}
                />
                <span className="txt-o" style={{ fontSize: u(19), fontWeight: 700 }}>
                  {t(m.name)}
                </span>
                <span className="mode-blurb txt-o" style={{ fontSize: u(12), lineHeight: 1.2, minHeight: u(56), opacity: 0.95, fontWeight: 500 }}>
                  {t(m.blurb)}
                </span>
                <span key={phase.votes?.[id] || 0} className="vote-count bump">
                  {label(phase.votes?.[id])}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center" style={{ gap: u(8) }}>
          <span className="txt-o" style={{ fontSize: u(16), color: '#d9ccff', fontWeight: 700 }}>
            {t('BOTS')}
          </span>
          {[
            ['normal', 'WITH BOTS', '#3fae4a'],
            ['off', 'NO BOTS', '#d8443a'],
          ].map(([id, label, color]) => {
            const mine = phase.myBotVote === id
            return (
              <button
                key={id}
                type="button"
                className={`mc-btn txt-o ${mine ? 'picked' : ''}`}
                style={{ '--c': mine ? color : '#4b5468', padding: `${u(4)} ${u(14)}`, fontSize: u(15) }}
                onClick={() => actions.voteBots(id)}
              >
                {t(label)} · {phase.botVotes?.[id] || 0}
              </button>
            )
          })}
        </div>
        <span className="txt-o" style={{ fontSize: u(13), color: '#bdb3e0', fontWeight: 500 }}>
          {t('Most votes wins. No bots unless you vote for them (they play at Medium). Then everyone picks the map')}
        </span>
      </div>
    )
  }

  const chosen = MODES[phase.chosenMode]
  return (
    <div className="vote-panel pointer-events-auto mc-panel flex flex-col items-center" style={{ gap: u(10), marginTop: u(4), padding: `${u(10)} ${u(12)} ${u(12)}` }}>
      {chosen && (
        <div className="flex items-center" style={{ gap: u(10) }}>
          <span className="txt-o" style={{ fontSize: u(13), color: '#bdb3e0' }}>
            {t('MODE')}
          </span>
          <span className="chip" style={{ fontSize: u(18), background: chosen.color, color: '#fff', fontWeight: 700 }}>
            {t(chosen.name)}
          </span>
          {phase.chosenBots && (
            <span className="chip" style={{ fontSize: u(14), color: BOT_LEVELS[phase.chosenBots]?.color }}>
              {phase.chosenBots === 'off' ? t('NO BOTS') : t('{name} bots', { name: t(BOT_LEVELS[phase.chosenBots]?.name) })}
            </span>
          )}
        </div>
      )}
      {step(2, 'PICK THE MAP')}
      <div className="vote-row vote-maps" style={{ gap: u(10) }}>
        {(phase.mapOptions || MAP_IDS.slice(0, 6)).map((id, i) => {
          const mine = phase.myMapVote === id
          return (
            <button
              key={id}
              type="button"
              className={`mc-btn vote-card flex flex-col items-center text-center ${mine ? 'picked' : ''}`}
              style={{ '--c': mine ? '#e0a21b' : '#4b5468', '--i': i, width: u(176), padding: u(6), gap: u(4) }}
              onClick={() => actions.voteMap(id)}
            >
              <img src={`${import.meta.env.BASE_URL}maps/${id}.webp`} alt={MAPS[id].name} draggable={false} style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: u(10) }} />
              <span className="txt-o" style={{ fontSize: u(17), fontWeight: 700, lineHeight: 1.1 }}>
                {t(MAPS[id].name)}
              </span>
              <span key={phase.mapVotes?.[id] || 0} className="vote-count bump">
                {label(phase.mapVotes?.[id])}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MenuButton({ label, short, icon, color, badge, onClick }) {
  return (
    <Button color={color} className="menu-btn relative flex flex-col items-center justify-center" onClick={onClick}>
      <GameIcon name={icon} size={34} />
      <span className="menu-label txt-o">{label}</span>
      <span className="menu-label-short txt-o">{short || label}</span>
      {badge && (
        <span className="absolute flex items-center justify-center rounded-full bg-red-600" style={{ right: u(-10), top: u(-10), width: u(24), height: u(24), fontSize: u(15), border: `${u(3)} solid #0d0a18` }}>
          !
        </span>
      )}
    </Button>
  )
}

export function LobbyMenu() {
  const open = useGame((s) => s.openPanel)
  const profile = useGame((s) => s.profile)
  const afk = useGame((s) => s.phase.afk)
  const [openedAt] = useState(() => Date.now())
  const dailyReady = dailyStatus(profile, openedAt).ready
  const go = (panel, data) => {
    exitPointerLock()
    open(panel, data)
  }
  return (
    <div className="lobby-menu pointer-events-auto absolute" style={{ left: u(14), gap: u(12) }}>
      <MenuButton label={t('SHOP')} icon="bag" color="#e0a21b" onClick={() => go('shop')} />
      <MenuButton label={t('CASES')} icon="chest" color="#c25cff" onClick={() => go('cases', { caseId: 'cape' })} />
      <MenuButton label={t('BACKPACK')} short={t('BAG')} icon="backpack" color="#b0633a" onClick={() => go('backpack')} />
      <MenuButton label={t('DAILY')} icon="gift" color="#3fa2ff" badge={dailyReady} onClick={() => go('daily')} />
      <MenuButton label={t('QUESTS')} icon="scroll" color="#e0702b" onClick={() => go('quests')} />
      <MenuButton label={t('TOP')} icon="trophy" color="#2bb3a3" onClick={() => go('leaderboards')} />
      <MenuButton label={afk ? t('AFK: ON') : t('AFK: OFF')} short={t('AFK')} icon="moon" color={afk ? '#d8443a' : '#4b5563'} onClick={() => actions.afk(!afk)} />
    </div>
  )
}

export function Wallet() {
  const wins = useGame((s) => s.profile.wins)
  const cash = useGame((s) => s.profile.cash)
  const shown = useCountUp(cash)
  return (
    <div className="wallet slide-in-up absolute flex flex-col" style={{ left: u(14), bottom: u(14), gap: u(6) }}>
      <div className="txt-o" style={{ fontSize: u(28), fontWeight: 700, color: '#ffd23b' }}>
        👑 {wins}
      </div>
      <div key={cash} className="txt-o bump" style={{ fontSize: u(30), fontWeight: 700, color: '#7cff6b', transformOrigin: 'left center' }}>
        {formatCash(shown)}
      </div>
    </div>
  )
}

export function StationPrompt() {
  const prompt = useGame((s) => s.prompt)
  const open = useGame((s) => s.openPanel)
  if (!prompt?.startsWith('case:')) return null
  const caseId = prompt.slice(5)
  const c = CASES[caseId]
  return (
    <div className="station-prompt absolute left-1/2 -translate-x-1/2" style={{ bottom: u(120) }}>
      <Button
        className="pointer-events-auto bob"
        color={c.color}
        style={{ padding: `${u(10)} ${u(26)}`, fontSize: u(24), fontWeight: 700 }}
        onClick={() => {
          exitPointerLock()
          open('cases', { caseId })
        }}
      >
        {runtime.input.touch ? 'OPEN' : '[E]'} {c.name.toUpperCase()} · ${c.price}
      </Button>
    </div>
  )
}

/** First visit: a free Cape Case, opened right away. */
export function WelcomeGift() {
  const loaded = useGame((s) => s.profileLoaded)
  const given = useGame((s) => s.profile.welcomeGift)
  const phase = useGame((s) => s.phase)
  const now = useNow(1000)
  const asked = useRef(false)
  // Only in the countdown before the votes (or while waiting for players): never over
  // the vote, never with a round about to start.
  const calm = phase.phase === 'waiting' || (phase.phase === 'intermission' && phase.voteStage === 'wait' && phase.endsAt - now > 12_000)
  useEffect(() => {
    if (!loaded || given || asked.current || !calm) return undefined
    const id = setTimeout(() => {
      asked.current = true
      actions.welcomeGift()
    }, 2500)
    return () => clearTimeout(id)
  }, [loaded, given, calm])
  return null
}
