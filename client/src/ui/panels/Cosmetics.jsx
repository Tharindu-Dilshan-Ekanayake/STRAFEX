import { useEffect, useMemo, useRef, useState } from 'react'

import { CAPES, casePool, CASES, RARITIES, RARITY_ORDER, SWORD_SKINS } from '@shared/balance'
import { mulberry32 } from '@shared/rng'

import { sfx } from '../../audio/sfx'
import { killFxPreview } from '../../game/art/killfx'
import { itemIcon } from '../../game/art/items'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { formatCash, u } from '../format'
import { Button } from '../kit'

/** Cosmetics: the case shop, the case-opening reel, and your backpack. */

const rarityColor = (r) => RARITIES[r]?.color || '#fff'

function CosmeticTile({ kind, id, rarity, chance, owned, equipped, onClick }) {
  const isCape = kind === 'cape'
  const def = isCape ? CAPES[id] : SWORD_SKINS[id]
  return (
    <button
      type="button"
      className="slot flex flex-col items-center"
      style={{ padding: u(8), gap: u(4), borderColor: equipped ? '#fff' : rarityColor(rarity), opacity: owned === false ? 0.55 : 1 }}
      onClick={onClick}
    >
      <img src={isCape ? killFxPreview(id) : itemIcon('diamond_sword', id)} alt="" className="pixelated" style={{ height: u(64), width: u(64) }} draggable={false} />
      <span className="txt-o text-center" style={{ fontSize: u(14), lineHeight: 1.1 }}>
        {def?.gemOnly ? `★ ${def.name}` : def?.name}
      </span>
      <span className="txt-o" style={{ fontSize: u(12), color: rarityColor(rarity) }}>
        {chance !== undefined ? `${(chance * 100).toFixed(chance < 0.01 ? 2 : 1)}%` : RARITIES[rarity]?.name}
        {equipped ? ' · ON' : ''}
      </span>
    </button>
  )
}

export function CasesPanel() {
  const data = useGame((s) => s.panelData)
  const cash = useGame((s) => s.profile.cash)
  const [caseId, setCaseId] = useState(data?.caseId && CASES[data.caseId] && !CASES[data.caseId].gems ? data.caseId : 'cape')
  const c = CASES[caseId]
  const pool = useMemo(() => casePool(caseId), [caseId])
  const afford = cash >= c.price
  return (
    <div className="flex flex-col" style={{ gap: u(12) }}>
      <div className="flex" style={{ gap: u(10) }}>
        {Object.entries(CASES)
          .filter(([, cs]) => !cs.gems)
          .map(([id, cs]) => (
          <Button key={id} color={id === caseId ? cs.color : '#4b5563'} style={{ padding: `${u(8)} ${u(16)}`, fontSize: u(20) }} onClick={() => setCaseId(id)}>
            {cs.name.toUpperCase()}
          </Button>
          ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${u(110)}, 1fr))`, gap: u(8) }}>
        {pool.map((e) => (
          <CosmeticTile key={e.id} kind={c.kind} id={e.id} rarity={e.rarity} chance={e.chance} />
        ))}
      </div>
      <div className="flex items-center justify-between" style={{ gap: u(10) }}>
        <div className="txt-o" style={{ fontSize: u(22), color: '#7cff6b' }}>
          You have {formatCash(cash)}
        </div>
        <Button
          color={c.color}
          disabled={!afford}
          style={{ padding: `${u(10)} ${u(28)}`, fontSize: u(24), fontWeight: 700 }}
          onClick={() => {
            sfx.buy()
            actions.openCase(caseId)
          }}
        >
          OPEN · ${c.price}
        </Button>
      </div>
      <div className="txt-o" style={{ fontSize: u(14), color: '#bdb3e0' }}>
        Win rounds and get kills to earn cash. Duplicates give {Math.round(0.4 * 100)}% of the price back.
      </div>
    </div>
  )
}

let strips = 1

/** The case reel: a strip of prizes scrolls fast, slows, and stops on what you got. */
export function CaseOpening({ result }) {
  const setCaseOpen = useGame((s) => s.setCaseOpen)
  const c = CASES[result.caseId] || CASES.cape
  const pool = useMemo(() => casePool(result.caseId || 'cape'), [result.caseId])
  const [stage, setStage] = useState('spin')
  const strip = useMemo(() => {
    // 40 tiles drawn by chance, with the prize at index 34.
    let seed = 0
    for (const ch of `${result.id}${result.caseId}${result.refund}`) seed = (seed * 31 + ch.charCodeAt(0)) | 0
    const rng = mulberry32(seed ^ strips++)
    const pick = () => {
      let r = rng()
      for (const e of pool) {
        r -= e.chance
        if (r <= 0) return e
      }
      return pool[0]
    }
    const tiles = Array.from({ length: 40 }, pick)
    tiles[34] = pool.find((e) => e.id === result.id) || { id: result.id, rarity: 'common' }
    return tiles
  }, [pool, result])
  const stripRef = useRef(null)
  const TILE = 130

  useEffect(() => {
    const el = stripRef.current
    if (!el) return undefined
    const width = el.parentElement.clientWidth
    const scale = el.firstChild ? el.firstChild.getBoundingClientRect().width / 1 : TILE
    const tileW = scale + 8
    const target = 34 * tileW + tileW / 2 - width / 2 + (Math.random() - 0.5) * tileW * 0.6
    el.style.transition = 'none'
    el.style.transform = 'translateX(0px)'
    let raf = 0
    let lastTile = -1
    const start = performance.now()
    const tickSounds = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      const tile = Math.floor((-m.m41 + width / 2) / tileW)
      if (tile !== lastTile) {
        lastTile = tile
        sfx.caseTick(1 + Math.min(1, (performance.now() - start) / 5000) * 0.3)
      }
      raf = requestAnimationFrame(tickSounds)
    }
    requestAnimationFrame(() => {
      el.style.transition = 'transform 4.6s cubic-bezier(0.08, 0.7, 0.12, 1)'
      el.style.transform = `translateX(${-target}px)`
      raf = requestAnimationFrame(tickSounds)
    })
    const done = setTimeout(() => {
      cancelAnimationFrame(raf)
      setStage('done')
      sfx.reveal(RARITY_ORDER.indexOf(pool.find((e) => e.id === result.id)?.rarity || 'common'))
    }, 4800)
    return () => {
      clearTimeout(done)
      cancelAnimationFrame(raf)
    }
  }, [strip, pool, result])

  const prize = strip[34]
  const kind = result.kind || c.kind
  const def = kind === 'cape' ? CAPES[result.id] : SWORD_SKINS[result.id]
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60" style={{ gap: u(18) }}>
      <div className="txt-o" style={{ fontSize: u(40), fontWeight: 700, color: c.color }}>
        {result.gift ? 'WELCOME GIFT · ' : ''}
        {c.name.toUpperCase()}
      </div>
      <div className="mc-gui relative overflow-hidden" style={{ width: `min(92vw, ${u(760)})`, padding: `${u(12)} 0` }}>
        <div className="absolute left-1/2 top-0 z-10 h-full -translate-x-1/2" style={{ width: u(4), background: '#ffd23b', boxShadow: '0 0 8px #ffd23b' }} />
        <div ref={stripRef} className="flex" style={{ gap: 8, willChange: 'transform' }}>
          {strip.map((e, i) => (
            <div key={i} className="slot flex shrink-0 flex-col items-center justify-center" style={{ width: u(TILE), height: u(150), borderColor: rarityColor(e.rarity), gap: u(4) }}>
              <img src={kind === 'cape' ? killFxPreview(e.id) : itemIcon('diamond_sword', e.id)} alt="" className="pixelated" style={{ height: u(80), width: u(80) }} draggable={false} />
              <span className="txt-o text-center" style={{ fontSize: u(13), lineHeight: 1.1 }}>
                {(kind === 'cape' ? CAPES[e.id] : SWORD_SKINS[e.id])?.name}
              </span>
            </div>
          ))}
        </div>
      </div>
      {stage === 'done' && (
        <div className="pop-in flex flex-col items-center" style={{ gap: u(8) }}>
          <div className="txt-o" style={{ fontSize: u(20), color: rarityColor(prize.rarity) }}>
            {RARITIES[prize.rarity]?.name.toUpperCase()}
          </div>
          <div className="txt-o" style={{ fontSize: u(38), fontWeight: 700, color: rarityColor(prize.rarity) }}>
            {def?.name}
          </div>
          <div className="txt-o" style={{ fontSize: u(18) }}>
            {result.duplicate ? `Duplicate! +$${result.refund} back` : 'NEW! Added to your backpack'}
          </div>
          <div className="flex" style={{ gap: u(12) }}>
            {!result.duplicate && (
              <Button
                color="#3a6fd8"
                style={{ padding: `${u(8)} ${u(20)}`, fontSize: u(20) }}
                onClick={() => {
                  actions.equip(kind, result.id)
                  setCaseOpen(null)
                }}
              >
                EQUIP
              </Button>
            )}
            <Button style={{ padding: `${u(8)} ${u(20)}`, fontSize: u(20) }} onClick={() => setCaseOpen(null)}>
              NICE!
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function BackpackPanel() {
  const profile = useGame((s) => s.profile)
  const [tab, setTab] = useState('cape')
  const table = tab === 'cape' ? CAPES : SWORD_SKINS
  const owned = tab === 'cape' ? profile.capes : profile.swords
  const equipped = tab === 'cape' ? profile.cape : profile.sword
  const ids = Object.keys(table).sort((a, b) => RARITY_ORDER.indexOf(table[b].rarity) - RARITY_ORDER.indexOf(table[a].rarity))
  return (
    <div className="flex flex-col" style={{ gap: u(12) }}>
      <div className="flex" style={{ gap: u(10) }}>
        <Button color={tab === 'cape' ? '#ffb52e' : '#4b5563'} style={{ padding: `${u(8)} ${u(16)}`, fontSize: u(20) }} onClick={() => setTab('cape')}>
          KILL FX {profile.capes.length}/{Object.keys(CAPES).length}
        </Button>
        <Button color={tab === 'sword' ? '#3fa2ff' : '#4b5563'} style={{ padding: `${u(8)} ${u(16)}`, fontSize: u(20) }} onClick={() => setTab('sword')}>
          SWORDS {profile.swords.length}/{Object.keys(SWORD_SKINS).length}
        </Button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${u(110)}, 1fr))`, gap: u(8) }}>
        {ids.map((id) => (
          <CosmeticTile
            key={id}
            kind={tab}
            id={id}
            rarity={table[id].rarity}
            owned={owned.includes(id)}
            equipped={equipped === id}
            onClick={() => owned.includes(id) && actions.equip(tab, id)}
          />
        ))}
      </div>
      <div className="txt-o" style={{ fontSize: u(14), color: '#bdb3e0' }}>
        Tap something you own to wear it. Get more from cases; ★ items are Gem exclusives (Shop).
      </div>
    </div>
  )
}
