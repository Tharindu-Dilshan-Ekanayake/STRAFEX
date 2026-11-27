import { useEffect, useRef, useState } from 'react'

import { CASES, LOBBY_SWORD, MODES } from '@shared/balance'
import { dailyStatus } from '@shared/logic'

import { itemIcon } from '../../game/art/items'
import { exitPointerLock } from '../../game/input'
import { runtime } from '../../game/runtime'
import { actions } from '../../net/actions'
import { switchLobby } from '../../net/connection'
import { useGame } from '../../store/game'
import { formatCash, formatClock, u, useCountUp, useNow } from '../format'
import { Button, Fancy } from '../kit'
import { t } from '../i18n'
import PixelIcon from '../PixelIcon'

/** The lobby HUD: play buttons and the queue, server fill, the menu, wallet and station prompts, the welcome gift. */

/** How many people are on this server (online only: offline there's nothing to say). */
export function PlayerCount() {
  const net = useGame((s) => s.net)
  if (net.mode !== 'online') return null
  const text = net.isPrivate ? t('PRIVATE SERVER {code} · {n}/{max} ONLINE', { code: net.code || '', n: net.players, max: net.maxPlayers }) : t('{n}/{max} ONLINE', { n: net.players, max: net.maxPlayers })
  return (
    <div className="flex items-center" style={{ gap: u(10) }}>
      <span className="txt-o" style={{ fontSize: u(14), color: '#bfe8ff' }}>
        {text}
      </span>
      {net.isPrivate && (
        <Button className="pointer-events-auto" color="#3a6fd8" style={{ padding: `${u(2)} ${u(10)}`, fontSize: u(13) }} onClick={() => switchLobby({ mode: 'public' })}>
          PUBLIC SERVER
        </Button>
      )}
    </div>
  )
}

/** Two of the game's own diamond swords, crossed. */
function CrossedSwords({ size }) {
  const src = itemIcon(LOBBY_SWORD)
  return (
    <span className="play-icon relative inline-block" style={{ width: size, height: size }} aria-hidden="true">
      <img src={src} alt="" className="pixelated absolute inset-0" style={{ width: '100%', height: '100%' }} draggable={false} />
      <img src={src} alt="" className="pixelated absolute inset-0" style={{ width: '100%', height: '100%', transform: 'scaleX(-1)' }} draggable={false} />
    </span>
  )
}

/** The title and the two ways to play: blocky buttons, pixel icons, Minecraft-style lettering. */
export function PlayButtons() {
  const open = useGame((s) => s.openPanel)
  const phase = useGame((s) => s.phase)
  if (phase.queue) return null
  return (
    <div className="play-buttons pointer-events-auto flex flex-col items-center" style={{ gap: u(8) }}>
      <div className="flex" style={{ gap: u(12) }}>
        <Button
          color="#e0a21b"
          className="play-btn bob"
          onClick={() => {
            exitPointerLock()
            open('modes')
          }}
        >
          <CrossedSwords size={u(40)} />
          <span className="flex flex-col items-start">
            <span className="play-title">{t('PLAY DUELS')}</span>
            <span className="play-sub">{t('1V1 · REAL PLAYERS')}</span>
          </span>
        </Button>
        <Button color="#3a6fd8" className="play-btn bob" onClick={() => actions.ffa()}>
          <PixelIcon name="spire" size={u(40)} />
          <span className="flex flex-col items-start">
            <span className="play-title">{t('SPIRELANDS FFA')}</span>
            <span className="play-sub">{phase.ffa ? t('{n} FIGHTING', { n: phase.ffa }) : t('FREE FOR ALL')}</span>
          </span>
        </Button>
      </div>
    </div>
  )
}

/** In a queue: how long you've waited, and the way out. */
export function QueueBar() {
  const phase = useGame((s) => s.phase)
  const now = useNow(500)
  if (!phase.queue) return null
  const waited = Math.max(0, now - (phase.queuedSince || now))
  const m = MODES[phase.queue]
  const inFfa = phase.kind === 'ffa'
  // Waiting a while in the lobby: point at Spirelands (the search goes on in there).
  const nudge = !inFfa && waited > 15000
  return (
    <div className="queue-bar mc-hud pointer-events-auto flex items-center" style={{ gap: u(14), padding: `${u(8)} ${u(14)}` }}>
      <span className="queue-spinner" />
      <div className="flex flex-col" style={{ gap: u(4) }}>
        <span className="mc-text" style={{ fontSize: u(18) }}>
          {t('SEARCHING FOR OPPONENT')} <span style={{ color: '#ffff55' }}>{formatClock(waited)}</span>
        </span>
        <span className="txt-o" style={{ fontSize: u(13), color: '#e0e0e0' }}>
          {t('CASUAL')} · <span style={{ color: m?.color }}>{t(m?.name || '')}</span> {t('1v1')} · {t('{n} searching', { n: Math.max(1, Object.values(phase.searching || {}).reduce((a, b) => a + b, 0)) })}
        </span>
      </div>
      {!inFfa && (
        <button
          type="button"
          className={`mc-stone ${nudge ? 'nudge' : ''}`}
          style={{ padding: `${u(6)} ${u(12)}`, fontSize: u(12), lineHeight: 1.15 }}
          title={t('Fight in Spirelands while you wait: you are pulled into the duel the moment an opponent is found')}
          onClick={() => actions.ffa()}
        >
          {t('PLAY SPIRELANDS')}
          <br />
          <span style={{ fontSize: u(9), color: '#d6f0ff' }}>{t('WHILE YOU WAIT')}</span>
        </button>
      )}
      <button type="button" className="mc-stone" style={{ padding: `${u(6)} ${u(14)}`, fontSize: u(14) }} onClick={() => actions.unqueue()}>
        {t('LEAVE QUEUE')}
      </button>
    </div>
  )
}

function MenuButton({ label, short, icon, badge, onClick }) {
  return (
    <button type="button" className="mc-stone menu-btn relative flex flex-col items-center justify-center" onClick={onClick}>
      <PixelIcon name={icon} size={u(36)} className="" />
      <span className="menu-label">{label}</span>
      <span className="menu-label-short">{short || label}</span>
      {badge && (
        <span className="absolute flex items-center justify-center rounded-full bg-red-600" style={{ right: u(-10), top: u(-10), width: u(24), height: u(24), fontSize: u(15), border: `${u(3)} solid #0d0a18` }}>
          !
        </span>
      )}
    </button>
  )
}

export function LobbyMenu() {
  const open = useGame((s) => s.openPanel)
  const profile = useGame((s) => s.profile)
  const [openedAt] = useState(() => Date.now())
  const dailyReady = dailyStatus(profile, openedAt).ready
  const go = (panel, data) => {
    exitPointerLock()
    open(panel, data)
  }
  return (
    <div className="lobby-menu pointer-events-auto absolute" style={{ left: u(14), gap: u(12) }}>
      <MenuButton label={t('SHOP')} icon="shop" onClick={() => go('shop')} />
      <MenuButton label={t('CASES')} icon="chest" onClick={() => go('cases', { caseId: 'cape' })} />
      <MenuButton label={t('BACKPACK')} short={t('BAG')} icon="backpack" onClick={() => go('backpack')} />
      <MenuButton label={t('DAILY')} icon="gift" badge={dailyReady} onClick={() => go('daily')} />
      <MenuButton label={t('QUESTS')} icon="scroll" onClick={() => go('quests')} />
      <MenuButton label={t('TOP')} icon="trophy" onClick={() => go('leaderboards')} />
    </div>
  )
}

export function Wallet() {
  const wins = useGame((s) => s.profile.wins)
  const cash = useGame((s) => s.profile.cash)
  const shown = useCountUp(cash)
  return (
    <div className="wallet slide-in-up absolute flex flex-col" style={{ left: u(14), bottom: u(14), gap: u(6) }}>
      <div className="mc-text" style={{ fontSize: u(26), color: '#ffff55' }}>
        👑 {wins}
      </div>
      <div key={cash} className="mc-text bump" style={{ fontSize: u(28), color: '#55ff55', transformOrigin: 'left center' }}>
        {formatCash(shown)}
      </div>
    </div>
  )
}

/** Standing at a station: the Duels arch, the Spirelands portal, a case stall. */
export function StationPrompt() {
  const prompt = useGame((s) => s.prompt)
  const open = useGame((s) => s.openPanel)
  const queued = useGame((s) => Boolean(s.phase.queue))
  if (!prompt) return null
  const key = runtime.input.touch ? '' : '[E] '
  let label
  let color
  let onClick
  if (prompt === 'duels') {
    if (queued) return null
    label = `${key}${t('CHOOSE YOUR MODE')}`
    color = '#e0a21b'
    onClick = () => {
      exitPointerLock()
      open('modes')
    }
  } else if (prompt === 'ffa') {
    label = `${key}${t('ENTER SPIRELANDS')}`
    color = '#3a6fd8'
    onClick = () => actions.ffa()
  } else if (prompt.startsWith('case:')) {
    const caseId = prompt.slice(5)
    const c = CASES[caseId]
    label = `${key}${c.name.toUpperCase()} · $${c.price}`
    color = c.color
    onClick = () => {
      exitPointerLock()
      open('cases', { caseId })
    }
  } else return null
  return (
    <div className="station-prompt absolute left-1/2 -translate-x-1/2" style={{ bottom: u(120) }}>
      <Button className="pointer-events-auto bob" color={color} style={{ padding: `${u(10)} ${u(26)}`, fontSize: u(24), fontWeight: 700 }} onClick={onClick}>
        {label}
      </Button>
    </div>
  )
}

/** First visit: a free Kill FX Case, opened right away (not while queued). */
export function WelcomeGift() {
  const loaded = useGame((s) => s.profileLoaded)
  const given = useGame((s) => s.profile.welcomeGift)
  const phase = useGame((s) => s.phase)
  const asked = useRef(false)
  const calm = phase.kind === 'lobby' && !phase.queue
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

/** The lobby parkour's clock, while you're on the course. */
export function ParkourTimer() {
  const now = useNow(100)
  const started = runtime.parkour.startedAt
  if (!started) return null
  return (
    <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '18%' }}>
      <Fancy size={34} from="#e8ffd8" to="#3fdc4a">
        {`PARKOUR ${((now - started) / 1000).toFixed(1)}s`}
      </Fancy>
    </div>
  )
}
