import { useState } from 'react'

import { AD_REWARDS, CAPES, DAILY_REWARDS, GEM_GROUPS, GEM_PRODUCTS, LEVEL_CASE_EVERY, levelCash, levelXp, QUESTS, RARITIES, SWORD_SKINS } from '@shared/balance'
import { dailyStatus } from '@shared/logic'

import { buyGems, isRewardedAvailable, useGemsBalance, watchRewardedAd } from '../../bloxity/services'
import { capePreview } from '../../game/art/capes'
import { itemIcon } from '../../game/art/items'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { u } from '../format'
import { Button, Fancy } from '../kit'
import { t } from '../i18n'

/** Earning and showing off: the shop, the daily reward, level and quests, the leaderboards. */

/** What a product shows: a picture for cosmetics, and whether you have it already. */
function productState(p, profile, now) {
  const g = p.grant
  // A pack (cash and more) is never "owned"; a single exclusive is, once you have it.
  const single = !g.cash
  if (g.cape) return { owned: single && profile.capes.includes(g.cape), picture: capePreview(g.cape), tall: true, rarity: CAPES[g.cape]?.gemOnly ? CAPES[g.cape].rarity : null }
  if (g.sword) return { owned: single && profile.swords.includes(g.sword), picture: itemIcon('diamond_sword', g.sword), rarity: SWORD_SKINS[g.sword]?.gemOnly ? SWORD_SKINS[g.sword].rarity : null }
  if (g.pass) return { owned: Boolean(profile.passes[g.pass]) }
  if (g.xpBoostMs) {
    const left = (profile.boosts?.xpUntil || 0) - now
    return { note: left > 0 ? `Active: ${Math.ceil(left / 60000)} min left` : null }
  }
  return {}
}

export function ShopPanel() {
  const gems = useGemsBalance()
  const [busy, setBusy] = useState(null)
  const show = useGame((s) => s.showToast)
  const profile = useGame((s) => s.profile)
  const [openedAt] = useState(() => Date.now())
  const adReady = isRewardedAvailable()
  return (
    <div className="flex flex-col" style={{ gap: u(10) }}>
      {gems !== null && gems !== undefined && (
        <div className="txt-o" style={{ fontSize: u(18), color: '#7fdcff' }}>
          Your Gems: {gems}
        </div>
      )}
      {GEM_GROUPS.map(([group, title]) => (
        <div key={group} className="flex flex-col" style={{ gap: u(8) }}>
          <Fancy size={22} from="#ffffff" to={group === 'exclusive' ? '#ff9de2' : '#7fdcff'}>
            {title}
          </Fancy>
          <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${u(200)}, 1fr))`, gap: u(10) }}>
            {Object.entries(GEM_PRODUCTS)
              .filter(([, p]) => p.group === group)
              .map(([sku, p]) => {
                const st = productState(p, profile, openedAt)
                const rarityColor = st.rarity ? RARITIES[st.rarity]?.color : null
                return (
                  <div key={sku} className="slot flex flex-col" style={{ padding: u(12), gap: u(6), borderColor: rarityColor || undefined }}>
                    {st.picture && (
                      <img src={st.picture} alt="" className="pixelated self-center" style={{ height: u(64), width: st.tall ? u(40) : u(64) }} draggable={false} />
                    )}
                    <div className="txt-o" style={{ fontSize: u(20), fontWeight: 700, color: '#ffd23b' }}>
                      {p.name}
                    </div>
                    {st.rarity && (
                      <div className="txt-o" style={{ fontSize: u(13), color: rarityColor }}>
                        ★ {RARITIES[st.rarity].name.toUpperCase()} · GEMS ONLY
                      </div>
                    )}
                    <div className="txt-o" style={{ fontSize: u(14), minHeight: u(34) }}>
                      {p.blurb}
                    </div>
                    {st.note && (
                      <div className="txt-o" style={{ fontSize: u(13), color: '#7cf0ff' }}>
                        {st.note}
                      </div>
                    )}
                    <Button
                      color={st.owned ? '#4b5563' : '#3a6fd8'}
                      disabled={busy === sku || st.owned}
                      style={{ padding: `${u(6)} 0`, fontSize: u(17) }}
                      onClick={async () => {
                        setBusy(sku)
                        const r = await buyGems(sku)
                        setBusy(null)
                        if (!r.success && r.error) show(r.error, 'error')
                      }}
                    >
                      {st.owned ? 'OWNED' : 'BUY WITH GEMS'}
                    </Button>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
      <Fancy size={22} from="#ffffff" to="#7cff6b">
        FREE
      </Fancy>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${u(200)}, 1fr))`, gap: u(10) }}>
        {Object.entries(AD_REWARDS).map(([placement, ad]) => (
          <div key={placement} className="slot flex flex-col" style={{ padding: u(12), gap: u(6) }}>
            <div className="txt-o" style={{ fontSize: u(22), fontWeight: 700, color: '#7cff6b' }}>
              FREE {ad.label}
            </div>
            <div className="txt-o" style={{ fontSize: u(15), minHeight: u(36) }}>
              Watch a short video
            </div>
            <Button
              color="#4a8f2c"
              disabled={!adReady || busy === placement}
              style={{ padding: `${u(6)} 0`, fontSize: u(18) }}
              onClick={async () => {
                setBusy(placement)
                const r = await watchRewardedAd(placement)
                setBusy(null)
                if (!r.ok && r.status !== 'skipped') show('No video available right now', 'error')
              }}
            >
              {adReady ? 'WATCH' : 'UNAVAILABLE'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DailyPanel() {
  const profile = useGame((s) => s.profile)
  const [openedAt] = useState(() => Date.now())
  const status = dailyStatus(profile, openedAt)
  return (
    <div className="flex flex-col items-center" style={{ gap: u(14) }}>
      <div className="flex flex-wrap justify-center" style={{ gap: u(8) }}>
        {DAILY_REWARDS.map((cash, i) => {
          const day = i + 1
          const current = Math.min(status.streak, DAILY_REWARDS.length) === day
          const past = day < Math.min(status.streak, DAILY_REWARDS.length) || (!status.ready && current)
          return (
            <div key={day} className="slot flex flex-col items-center" style={{ width: u(92), padding: u(8), borderColor: current ? '#ffd23b' : undefined, opacity: past && !current ? 0.6 : 1 }}>
              <span className="txt-o" style={{ fontSize: u(15) }}>
                DAY {day}
              </span>
              <span className="txt-o" style={{ fontSize: u(20), color: '#7cff6b', fontWeight: 700 }}>
                ${cash}
              </span>
              {past && <span style={{ fontSize: u(16) }}>✔</span>}
            </div>
          )
        })}
      </div>
      <Button
        color="#3fa2ff"
        disabled={!status.ready}
        style={{ padding: `${u(10)} ${u(30)}`, fontSize: u(24), fontWeight: 700 }}
        onClick={() => actions.claimDaily()}
      >
        {status.ready ? `CLAIM $${status.reward}` : 'COME BACK TOMORROW'}
      </Button>
    </div>
  )
}

export function QuestsPanel() {
  const profile = useGame((s) => s.profile)
  const level = profile.level || 1
  const need = levelXp(level)
  const xp = profile.xp || 0
  const nextCase = Math.ceil((level + 1) / LEVEL_CASE_EVERY) * LEVEL_CASE_EVERY
  const quests = profile.quests?.list || []
  return (
    <div className="flex flex-col" style={{ gap: u(14) }}>
      <div className="slot flex items-center" style={{ padding: u(12), gap: u(14) }}>
        <div className="flex flex-col items-center" style={{ minWidth: u(80) }}>
          <span className="txt-o" style={{ fontSize: u(13), color: '#d9ccff' }}>
            {t('LEVEL')}
          </span>
          <Fancy size={40} from="#fff7b0" to="#ffb21a">
            {String(level)}
          </Fancy>
        </div>
        <div className="flex flex-1 flex-col" style={{ gap: u(6) }}>
          <div className="flex justify-between txt-o" style={{ fontSize: u(15) }}>
            <span>
              {xp} / {need} XP
            </span>
            <span style={{ color: '#7cff6b' }}>{t('Next level: +${cash}', { cash: levelCash(level + 1) })}</span>
          </div>
          <div style={{ height: u(16), borderRadius: u(8), background: 'rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            <div className="xp-fill" style={{ width: `${Math.min(100, (xp / need) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #7cf0ff, #5f8bff)' }} />
          </div>
          <span className="txt-o" style={{ fontSize: u(13), color: '#e6c7ff' }}>
            Free case at level {nextCase} · XP from playing, kills, lucky blocks, wins and quests
          </span>
        </div>
      </div>
      <Fancy size={22} from="#ffffff" to="#ffc28a">
        {t("TODAY'S QUESTS")}
      </Fancy>
      {quests.map((q) => {
        const def = QUESTS[q.id]
        if (!def) return null
        return (
          <div key={q.id} className="slot flex items-center" style={{ padding: u(10), gap: u(12), borderColor: q.done ? '#7cff6b' : undefined }}>
            <span style={{ fontSize: u(26), width: u(32), textAlign: 'center' }}>{q.done ? '✔' : '★'}</span>
            <div className="flex flex-1 flex-col" style={{ gap: u(4) }}>
              <span className="txt-o" style={{ fontSize: u(17), fontWeight: 700 }}>
                {t(def.name)}
              </span>
              <div style={{ height: u(10), borderRadius: u(5), background: 'rgba(0,0,0,0.45)', overflow: 'hidden' }}>
                <div className="xp-fill" style={{ width: `${(q.progress / def.goal) * 100}%`, height: '100%', background: q.done ? '#7cff6b' : 'linear-gradient(90deg, #ffd23b, #ff8a3c)' }} />
              </div>
            </div>
            <div className="flex flex-col items-end txt-o" style={{ fontSize: u(14), minWidth: u(90) }}>
              <span>
                {Math.floor(q.progress)} / {def.goal}
              </span>
              <span style={{ color: '#7cff6b' }}>
                ${def.cash} · {def.xp} XP
              </span>
            </div>
          </div>
        )
      })}
      <span className="txt-o" style={{ fontSize: u(13), color: '#bdb3e0', textAlign: 'center' }}>
        {t('New quests every day. Rewards are paid the moment a quest is done.')}
      </span>
    </div>
  )
}

export function LeaderboardsPanel() {
  const boards = useGame((s) => s.leaderboards)
  const profile = useGame((s) => s.profile)
  const [tab, setTab] = useState('wins')
  const tabs = { wins: 'WINS', kills: 'KILLS', games: 'ROUNDS', playtime: 'MINUTES' }
  const rows = boards?.[tab] || []
  return (
    <div className="flex flex-col" style={{ gap: u(10) }}>
      <div className="flex flex-wrap" style={{ gap: u(8) }}>
        {Object.entries(tabs).map(([id, label]) => (
          <Button key={id} color={tab === id ? '#2bb3a3' : '#4b5563'} style={{ padding: `${u(6)} ${u(14)}`, fontSize: u(18) }} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>
      {rows.length === 0 && (
        <div className="txt-o" style={{ fontSize: u(18), color: '#bdb3e0' }}>
          {boards ? 'No scores yet - be the first!' : 'Boards appear when you play online.'} You: {profile.wins} wins, {profile.kills} kills.
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="slot flex justify-between" style={{ padding: `${u(6)} ${u(12)}`, fontSize: u(18) }}>
          <span className="txt-o" style={{ color: i === 0 ? '#ffd23b' : '#fff' }}>
            {i + 1}. {r.name}
          </span>
          <span className="txt-o">{tab === 'playtime' ? Math.floor(r.value / 60) : Math.floor(r.value)}</span>
        </div>
      ))}
    </div>
  )
}
