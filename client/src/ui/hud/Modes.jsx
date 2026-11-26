import { useEffect } from 'react'

import { ITEMS, MODE_IDS, MODES } from '@shared/balance'
import { DUEL_MAPS } from '@shared/maps'

import { itemIcon } from '../../game/art/items'
import { exitPointerLock } from '../../game/input'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { u, useNow } from '../format'
import { Fancy } from '../kit'
import { mapPreview } from '../mapPreview'
import { t } from '../i18n'

/**
 * Picking what to play: the mode menu (CHOOSE YOUR MODE: queue for a 1v1), the kit
 * picker in Spirelands, and the map vote once an opponent is found.
 */

/** Each kit's picture: a fight on the Spirelands island (public/kits, ~20KB each, loaded
 * only when a menu opens). */
const kitArt = (id) => `${import.meta.env.BASE_URL}kits/${id}.webp`

/** One mode's card: its picture and name, what it is, the kit at a glance, and who's searching. */
function ModeCard({ id, i, picked, note, onPick, sword, duel = true, compact = false }) {
  const m = MODES[id]
  const icons = [...new Set(m.hotbar.filter(Boolean).map((s) => s[0]))].slice(0, 5)
  return (
    <button
      type="button"
      className={`mc-tile mode-card flex flex-col text-left ${picked ? 'picked' : ''} ${compact ? 'compact' : ''}`}
      style={{ '--i': i }}
      onClick={() => onPick(id)}
    >
      <span className="mode-art" style={{ '--kc': m.color }}>
        <img src={kitArt(id)} alt="" loading="lazy" decoding="async" draggable={false} />
        <span className="mode-art-name flex items-center" style={{ gap: u(6) }}>
          <span className="chip" style={{ fontSize: u(11), padding: `0 ${u(5)}`, color: '#ffd23b' }}>
            {i + 1}
          </span>
          <span className="txt-o" style={{ fontSize: u(19), fontWeight: 700, color: m.color }}>
            {t(m.name)}
          </span>
        </span>
      </span>
      {!compact && (
        <span className="txt-o" style={{ fontSize: u(12), color: '#ffffff', lineHeight: 1.2, minHeight: u(30) }}>
          {t(m.blurb)}
        </span>
      )}
      <span className="flex items-center" style={{ gap: u(3) }}>
        {icons.map((itemId) => (
          <span key={itemId} className="mc-slot flex items-center justify-center" style={{ width: u(28), height: u(28) }} title={ITEMS[itemId]?.name}>
            <img src={itemIcon(itemId, sword)} alt="" className="pixelated" style={{ width: '78%', height: '78%' }} draggable={false} />
          </span>
        ))}
      </span>
      {!compact && (
        <span className="txt-o" style={{ fontSize: u(11), color: '#f2f2f2' }}>
          {duel ? `${t('CASUAL')} · ${t('first to {n}', { n: m.ft })} · ` : ''}
          {note}
        </span>
      )}
    </button>
  )
}

/** The lobby's mode menu: click a mode (or press 1-9) to queue for a 1v1 in it. */
export function ModesPanel() {
  const close = useGame((s) => s.closePanel)
  const phase = useGame((s) => s.phase)
  const sword = useGame((s) => s.profile.sword)
  const net = useGame((s) => s.net.mode)
  const pick = (id) => {
    actions.queue(id)
    close()
  }
  useEffect(() => {
    exitPointerLock()
    const onKey = (e) => {
      const n = Number(e.key)
      if (n >= 1 && n <= MODE_IDS.length) pick(MODE_IDS[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="panel-wrap absolute inset-0 z-30 flex items-center justify-center bg-black/50" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mc-gui pop-in pointer-events-auto flex flex-col" style={{ width: `min(100%, ${u(900)})`, maxHeight: '100%', padding: u(16), gap: u(10) }}>
        <div className="flex items-center justify-between" style={{ gap: u(10) }}>
          <span className="mc-title" style={{ fontSize: u(28) }}>
            {t('CHOOSE YOUR MODE')}
          </span>
          <button type="button" className="mc-stone" style={{ width: u(44), height: u(44), fontSize: u(22) }} onClick={close}>
            ✕
          </button>
        </div>
        <span className="mc-note" style={{ fontSize: u(13) }}>
          {net === 'online' ? t('1v1 duels against real players · you are paired with anyone searching (same mode first, else the mode of whoever waited longer)') : t('Duels are against real players only · offline, nobody else can join your queue')}
        </span>
        <div className="mode-grid overflow-y-auto">
          {MODE_IDS.map((id, i) => (
            <ModeCard
              key={id}
              id={id}
              i={i}
              sword={sword}
              picked={phase.queue === id}
              note={phase.searching?.[id] ? t('{n} SEARCHING', { n: phase.searching[id] }) : phase.playing?.[id] ? t('{n} PLAYING', { n: phase.playing[id] }) : t('NOBODY SEARCHING')}
              onPick={pick}
            />
          ))}
        </div>
        <span className="mc-note" style={{ fontSize: u(12) }}>
          {t('Click a mode or press 1-9 to join its queue · Esc closes')}
        </span>
      </div>
    </div>
  )
}

/** Spirelands: dead (or just arrived) - pick the kit you come back with. */
export function KitPicker() {
  const sword = useGame((s) => s.profile.sword)
  const panel = useGame((s) => s.panel)
  useEffect(() => {
    exitPointerLock()
  }, [])
  if (panel) return null
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(8,4,20,0.45)' }}>
      <div className="kit-picker mc-gui pop-in pointer-events-auto flex flex-col" style={{ padding: u(14), gap: u(8) }}>
        <div className="flex items-center justify-between" style={{ gap: u(10) }}>
          <span className="mc-title" style={{ fontSize: u(24) }}>
            {t('PICK A KIT')}
          </span>
          <button type="button" className="mc-stone" style={{ padding: `${u(5)} ${u(14)}`, fontSize: u(15) }} onClick={() => actions.toLobby()}>
            {t('LOBBY')}
          </button>
        </div>
        <span className="mc-note kit-note" style={{ fontSize: u(12) }}>
          {t('Spirelands · free for all · kills heal you · click a kit')}
        </span>
        <div className="mode-grid kit-grid overflow-y-auto">
          {MODE_IDS.map((id, i) => (
            <ModeCard key={id} id={id} i={i} sword={sword} picked={false} duel={false} compact onPick={(m) => actions.kit(m)} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** An opponent is found: both pick a map (most votes wins, ties at random). */
export function MapVote() {
  const phase = useGame((s) => s.phase)
  const now = useNow(250)
  const left = Math.max(0, phase.endsAt - now)
  const options = phase.mapOptions
  useEffect(() => {
    exitPointerLock()
    const onKey = (e) => {
      const n = Number(e.key)
      if (options && n >= 1 && n <= options.length) actions.voteMap(options[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [options])
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(8,4,20,0.35)' }}>
      <div className="mc-gui pop-in pointer-events-auto flex flex-col items-center" style={{ width: `min(100%, ${u(820)})`, padding: u(14), gap: u(10) }}>
        <span className="txt-o" style={{ fontSize: u(14), color: '#bdb3e0' }}>
          {t('{mode} 1v1', { mode: MODES[phase.mode]?.name || '' })} · {(phase.score || []).map((s) => s.name).join(' vs ')}
        </span>
        <div className="flex items-center" style={{ gap: u(12) }}>
          <Fancy size={30} from="#ffffff" to="#ffd23b">
            {t('VOTE FOR THE MAP')}
          </Fancy>
          <span className="chip" style={{ fontSize: u(16), color: '#ffd23b' }}>
            {Math.ceil(left / 1000)}s
          </span>
        </div>
        <div className="map-grid">
          {(phase.mapOptions || []).map((id, i) => {
            const mine = phase.myMapVote === id
            const votes = phase.mapVotes?.[id] || 0
            return (
              <button
                key={id}
                type="button"
                className={`mc-btn vote-card flex flex-col items-center text-center ${mine ? 'picked' : ''}`}
                style={{ '--c': mine ? '#e0a21b' : '#3b3352', '--i': i, padding: u(6), gap: u(3) }}
                onClick={() => actions.voteMap(id)}
              >
                <img src={mapPreview(id)} alt={DUEL_MAPS[id].name} className="pixelated" draggable={false} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: u(8) }} />
                <span className="txt-o" style={{ fontSize: u(16), fontWeight: 700 }}>
                  {i + 1}. {t(DUEL_MAPS[id].name)}
                </span>
                <span className="txt-o" style={{ fontSize: u(11), color: '#cfc6ee', lineHeight: 1.15 }}>
                  {t(DUEL_MAPS[id].blurb)}
                </span>
                <span key={votes} className="vote-count bump">
                  {t(votes === 1 ? '{n} VOTE' : '{n} VOTES', { n: votes })}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
