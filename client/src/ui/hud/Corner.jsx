import { useState } from 'react'

import { CAPES, levelXp, QUICK_CHAT, SWORD_SKINS, TEAMS } from '@shared/balance'

import { exitPointerLock } from '../../game/input'
import { actions } from '../../net/actions'
import { useBloxity } from '../../bloxity/BloxityContext'
import { useGame } from '../../store/game'
import { u } from '../format'
import PixelIcon from '../PixelIcon'
import { Fancy } from '../kit'
import { t } from '../i18n'

/** The corners and overlays shown everywhere: settings, quick chat, your name tag, the feed, toasts, level-ups. */

/** You, top right: your Bloxity picture and name, with your wins and kills. */
export function NameTag() {
  const { identity } = useBloxity()
  const profileName = useGame((s) => s.profile.name)
  const wins = useGame((s) => s.profile.wins)
  const kills = useGame((s) => s.profile.kills)
  const level = useGame((s) => s.profile.level || 1)
  const vip = useGame((s) => Boolean(s.profile.passes?.vip))
  const xpUntil = useGame((s) => s.profile.boosts?.xpUntil || 0)
  const [seenAt] = useState(() => Date.now())
  const xp = useGame((s) => s.profile.xp || 0)
  const need = levelXp(level)
  const name = identity?.displayName || identity?.username || profileName || 'Guest'
  const pfp = identity?.pfp
  return (
    <div className="name-tag slide-in-right mc-hud" style={{ padding: `${u(6)} ${u(14)} ${u(6)} ${u(6)}`, gap: u(10) }}>
      <div className="mc-slot flex shrink-0 items-center justify-center overflow-hidden" style={{ width: u(46), height: u(46), padding: u(3) }}>
        {pfp ? (
          <img src={pfp} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
        ) : (
          <span className="mc-text" style={{ fontSize: u(24) }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex flex-col" style={{ lineHeight: 1.1, gap: u(3) }}>
        <span className="mc-text" style={{ fontSize: u(17), maxWidth: u(220), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vip ? `👑 ${name}` : name}
        </span>
        <span className="mc-text" style={{ fontSize: u(13) }}>
          <span style={{ color: '#ffff55' }}>👑 {wins}</span> <span style={{ color: '#ff5555', marginLeft: u(8) }}>⚔ {kills}</span>
        </span>
        <div className="flex items-center" style={{ gap: u(6), marginTop: u(1) }} title={`${xp} / ${need} XP`}>
          <span className="mc-level" style={{ fontSize: u(15) }}>
            {level}
          </span>
          {xpUntil > seenAt && (
            <span className="chip" style={{ fontSize: u(10), padding: `0 ${u(5)}`, color: '#7cf0ff' }}>
              2x XP
            </span>
          )}
          <div className="mc-xp" style={{ width: u(118), height: u(9) }}>
            <div key={level} className="mc-xp-fill xp-fill" style={{ width: `${Math.min(100, (xp / need) * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The top-right column: your name tag, then the quick chat and settings buttons, then the
 * kill feed. Stacked in one flex column, so a taller name tag pushes the rest down
 * instead of covering it.
 */
export function TopRight({ children }) {
  return (
    <div className="top-right absolute flex flex-col items-end" style={{ right: u(14), top: u(14), gap: u(10) }}>
      <NameTag />
      <div className="tr-buttons relative flex items-center" style={{ gap: u(10) }}>
        {children}
        <QuickChat />
        <SettingsButton />
      </div>
      <KillFeed />
    </div>
  )
}

/** Quick chat: a button under your name tag (and the T key) opening ten one-tap lines. */
export function QuickChat() {
  const open = useGame((s) => s.quickChat)
  const setOpen = useGame((s) => s.setQuickChat)
  return (
    <>
      <button
        type="button"
        className="mc-stone pointer-events-auto flex items-center justify-center"
        title="Quick chat (T)"
        style={{ width: u(50), height: u(50), padding: 0 }}
        onClick={() => setOpen(!open)}
      >
        <PixelIcon name="chat" size={u(30)} className="" />
      </button>
      {open && (
        <div className="mc-hud pointer-events-auto pop-in absolute grid" style={{ right: 0, top: `calc(100% + ${u(8)})`, zIndex: 25, padding: u(8), gap: u(6), gridTemplateColumns: 'repeat(2, auto)' }}>
          {QUICK_CHAT.map((text, i) => (
            <button
              key={text}
              type="button"
              className="mc-btn txt-o flex items-center"
              style={{ '--c': '#4b5468', padding: `${u(5)} ${u(12)}`, fontSize: u(16), gap: u(8), minWidth: u(140) }}
              onClick={() => {
                actions.quickChat(i)
                setOpen(false)
              }}
            >
              <span className="chip" style={{ fontSize: u(11), padding: `0 ${u(6)}` }}>
                {(i + 1) % 10}
              </span>
              {text}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** The settings button, under your name tag, in the lobby and in a round alike. */
export function SettingsButton() {
  const open = useGame((s) => s.openPanel)
  return (
    <button
      type="button"
      className="mc-stone pointer-events-auto flex items-center justify-center"
      title="Settings"
      style={{ width: u(50), height: u(50), padding: 0 }}
      onClick={() => {
        exitPointerLock()
        open('settings')
      }}
    >
      <PixelIcon name="gear" size={u(30)} className="" />
    </button>
  )
}

/** LEVEL UP! with what it gave you. */
export function LevelUpBanner() {
  const levelUp = useGame((s) => s.levelUp)
  if (!levelUp?.ups?.length) return null
  const top = levelUp.ups.at(-1)
  const cash = levelUp.ups.reduce((s, x) => s + x.cash, 0)
  const won = levelUp.ups.find((x) => x.case?.ok)?.case
  return (
    <div
      key={levelUp.id}
      className="level-up absolute left-1/2 z-30 flex flex-col items-center text-center"
      style={{ top: '14%', padding: `${u(24)} ${u(70)}`, background: 'radial-gradient(ellipse at center, rgba(13,10,24,0.82) 0%, rgba(13,10,24,0.55) 45%, rgba(13,10,24,0) 72%)' }}
    >
      <Fancy size={52} from="#fff7b0" to="#ffb21a">
        {t('LEVEL UP!')}
      </Fancy>
      <Fancy size={34} from="#e4fbff" to="#5fb8ff">
        {t('LEVEL {n}', { n: top.level })}
      </Fancy>
      <span className="txt-o" style={{ fontSize: u(20), color: '#7cff6b', fontWeight: 700 }}>
        +${cash}
      </span>
      {won && (
        <span className="txt-o" style={{ fontSize: u(17), color: '#e6c7ff' }}>
          Free {won.kind === 'cape' ? 'kill effect' : 'sword skin'}: {(won.kind === 'cape' ? CAPES : SWORD_SKINS)[won.id]?.name || won.id}
          {won.duplicate ? ` (duplicate, +$${won.refund})` : ''}
        </span>
      )}
    </div>
  )
}

export function KillFeed() {
  const feed = useGame((s) => s.feed)
  if (!feed.length) return null
  const how = { melee: '⚔', arrow: '➶', boom: '✹', void: '↓', fall: '⤓', gust: '🌀', left: '⇥', pearl: '✦' }
  return (
    <div className="tr-feed flex flex-col items-end" style={{ gap: u(4) }}>
      {feed.map((f) => (
        <div key={f.id} className="mc-hud txt-o slide-in-right" style={{ padding: `${u(3)} ${u(10)}`, fontSize: u(16) }}>
          {f.chat ? (
            <>
              <span style={{ color: f.team >= 0 && f.team < TEAMS.length ? TEAMS[f.team].color : '#9fe6ff' }}>{f.k}:</span> {f.v}
            </>
          ) : f.k ? (
            <>
              <span style={{ color: '#ffd23b' }}>{f.k}</span> {how[f.how] || '⚔'} <span style={{ color: '#ff8a8a' }}>{f.v}</span>
            </>
          ) : (
            <>
              <span style={{ color: '#ff8a8a' }}>{f.v}</span> {f.how === 'left' ? 'left' : f.how === 'void' ? 'fell into the void' : f.how === 'fall' ? 'hit the ground too hard' : f.how === 'boom' ? 'blew up' : f.how === 'fire' ? 'burned' : f.how === 'drown' ? 'drowned' : 'was eliminated'}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const colors = { success: '#7cff6b', error: '#ff6b6b', kill: '#ffd23b', info: '#ffffff' }
  return (
    <div className="toasts absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top: u(205), gap: u(6) }}>
      {toasts.map((t) => (
        <div key={t.id} className="txt-o pop-in" style={{ fontSize: u(22), color: colors[t.kind] || '#fff' }}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

// --- Lobby ------------------------------------------------------------------------------
