import { useEffect, useState } from 'react'

import { ARMOR, ARMOR_PIECES, HOTBAR, ITEMS, OFFHAND, RECIPES, TABLE_REACH } from '@shared/balance'
import { B } from '@shared/voxel'

import { sfx } from '../../audio/sfx'
import { itemIcon } from '../../game/art/items'
import { runtime } from '../../game/runtime'
import { worldState } from '../../game/world'
import { armorIcon } from '../../game/art/armorIcons'
import { exitPointerLock } from '../../game/input'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { u, useNow } from '../format'
import { Button, Fancy } from '../kit'
import { t } from '../i18n'

/**
 * Your whole inventory (E in a fight): armour, the offhand, the 27-slot bag and the
 * hotbar. Click a slot, then another, to swap them (or stack the same item) - put a
 * shield in your offhand to block with your sword still in hand, apples there to eat
 * without switching, refills from the bag onto the hotbar.
 */

function Slot({ index, slot, picked, onPick, sword, label, big }) {
  const item = slot && ITEMS[slot.id]
  return (
    <button
      type="button"
      className={`slot relative flex items-center justify-center ${picked ? 'sel' : ''}`}
      style={{ width: big ? 'calc(var(--inv-slot) * 1.15)' : 'var(--inv-slot)', height: big ? 'calc(var(--inv-slot) * 1.15)' : 'var(--inv-slot)', outline: picked ? `${u(3)} solid #ffd23b` : 'none' }}
      title={item ? `${item.name}${slot.n > 1 ? ` x${slot.n}` : ''}` : label || ''}
      onPointerDown={(e) => {
        e.stopPropagation()
        onPick(index)
      }}
    >
      {slot && <img src={itemIcon(slot.id, sword)} alt="" className="pixelated" style={{ width: '70%', height: '70%' }} draggable={false} />}
      {slot && slot.n > 1 && (
        <span className="txt-o absolute" style={{ right: u(3), bottom: u(-1), fontSize: u(15), fontWeight: 700 }}>
          {slot.n}
        </span>
      )}
      {!slot && label && (
        <span className="absolute opacity-40" style={{ fontSize: u(10), textAlign: 'center', lineHeight: 1 }}>
          {label}
        </span>
      )}
    </button>
  )
}

/** How many of `id` the inventory holds. */
const countOf = (inv, id) => inv.reduce((n, s) => (s?.id === id ? n + s.n : n), 0)

/** Is there a crafting table within reach of you (upgrades and new weapons need one)? */
function nearCraftingTable() {
  const w = worldState.world
  const b = runtime.player?.body
  if (!w || !b) return false
  const x0 = Math.floor(b.x)
  const y0 = Math.floor(b.y)
  const z0 = Math.floor(b.z)
  for (let dy = -2; dy <= 3; dy += 1) {
    for (let dx = -TABLE_REACH; dx <= TABLE_REACH; dx += 1) {
      for (let dz = -TABLE_REACH; dz <= TABLE_REACH; dz += 1) if (w.get(x0 + dx, y0 + dy, z0 + dz) === B.CRAFTING_TABLE) return true
    }
  }
  return false
}

/** One recipe: what it makes, what it takes (red if you're short), and the button. */
function Recipe({ r, inv, sword, atTable }) {
  const have = r.need.every(([id, n]) => countOf(inv, id) >= n)
  const can = have && (!r.table || atTable)
  const tier = r.armor ? ARMOR[r.armor] : null
  const icon = r.armor ? armorIcon(1, tier.color) : r.repair ? armorIcon(1, '#d6dbe2') : itemIcon(r.out[0], sword)
  const name = r.name || ITEMS[r.out[0]].name
  return (
    <button
      type="button"
      className={`mc-btn craft-row flex items-center text-left ${can ? '' : 'off'}`}
      style={{ '--c': can ? '#2bb37a' : '#3b3352', gap: u(8), padding: `${u(5)} ${u(8)}` }}
      disabled={!can}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (can) actions.craft(r.id)
        else sfx.error()
      }}
    >
      <span className="slot relative flex items-center justify-center" style={{ width: u(42), height: u(42), flex: 'none' }}>
        <img src={icon} alt="" className="pixelated" style={{ width: '72%', height: '72%' }} draggable={false} />
        {r.out?.[1] > 1 && (
          <span className="txt-o absolute" style={{ right: u(2), bottom: u(-2), fontSize: u(13), fontWeight: 700 }}>
            {r.out[1]}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col" style={{ gap: u(2) }}>
        <span className="txt-o" style={{ fontSize: u(13), fontWeight: 700 }}>
          {t(name)}
        </span>
        <span className="txt-o" style={{ fontSize: u(10), color: r.table && !atTable ? '#ffb27a' : '#cfc6ee', lineHeight: 1.1 }}>
          {r.table && !atTable ? t('Needs a crafting table nearby') : t(r.blurb)}
        </span>
        <span className="flex items-center" style={{ gap: u(6) }}>
          {r.need.map(([id, n]) => {
            const have = countOf(inv, id)
            return (
              <span key={id} className="flex items-center" style={{ gap: u(2) }} title={ITEMS[id].name}>
                <img src={itemIcon(id, sword)} alt="" className="pixelated" style={{ width: u(16), height: u(16) }} draggable={false} />
                <span className="txt-o" style={{ fontSize: u(11), fontWeight: 700, color: have >= n ? '#7cff9e' : '#ff8a8a' }}>
                  {Math.min(have, n)}/{n}
                </span>
              </span>
            )
          })}
        </span>
      </span>
    </button>
  )
}

export function InventoryPanel() {
  const inv = useGame((s) => s.me.inv)
  const armor = useGame((s) => s.me.armor)
  const sword = useGame((s) => s.profile.sword)
  const close = useGame((s) => s.closePanel)
  const [picked, setPicked] = useState(-1)
  // Whether you stand at a crafting table, checked every half second while this is open.
  useNow(500)
  const atTable = nearCraftingTable()
  /** Phones: the bag and crafting take turns (tabs); bigger screens show both. */
  const [tab, setTab] = useState('bag')
  useEffect(() => {
    exitPointerLock()
  }, [])
  const pick = (i) => {
    if (picked < 0) {
      if (!inv[i]) return
      setPicked(i)
      sfx.select()
      return
    }
    if (picked !== i) actions.swap(picked, i)
    sfx.click()
    setPicked(-1)
  }
  const set = ARMOR[armor?.tier]
  const row = (from, count) => Array.from({ length: count }, (_, k) => from + k)
  return (
    <div className="panel-wrap in-fight absolute inset-0 z-30 flex items-center justify-center bg-black/45" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="inv-panel mc-gui pop-in pointer-events-auto flex" data-tab={tab} style={{ padding: u(14), gap: u(16) }}>
      <div className="inv-head flex items-center justify-between" style={{ gap: u(12) }}>
        <Fancy size={28} from="#ffffff" to="#ffd23b">
          {t('INVENTORY')}
        </Fancy>
        {/* Phones only (CSS): bag or crafting. */}
        <div className="inv-tabs" style={{ gap: u(6) }}>
          {[
            ['bag', t('BAG')],
            ['craft', t('CRAFTING')],
          ].map(([id, label]) => (
            <button key={id} type="button" className={`mc-stone ${tab === id ? 'on' : ''}`} style={{ padding: `${u(4)} ${u(12)}`, fontSize: u(14) }} onPointerDown={(e) => {
              e.stopPropagation()
              setTab(id)
              sfx.select()
            }}>
              {label}
            </button>
          ))}
        </div>
        <Button color="#d8443a" style={{ width: u(42), height: u(42), fontSize: u(22), flex: 'none' }} onClick={close}>
          ✕
        </Button>
      </div>
      <div className="inv-main flex flex-col" style={{ gap: u(10) }}>
        <div className="inv-top flex" style={{ gap: u(16) }}>
          {/* Armour, read-only: what each piece has left. */}
          <div className="inv-armor flex flex-col" style={{ gap: u(4) }}>
            {ARMOR_PIECES.map((name, i) => (
              <div key={name} className="slot flex flex-col items-center justify-center" style={{ width: 'calc(var(--inv-slot) * 1.15)', height: 'var(--inv-slot)', opacity: set?.color ? 1 : 0.4 }} title={`${set?.name || ''} ${name}`}>
                <span className="txt-o" style={{ fontSize: u(10), color: '#cfc6ee' }}>
                  {t(name.toUpperCase())}
                </span>
                <span className="txt-o" style={{ fontSize: u(15), fontWeight: 700, color: set?.color || '#888' }}>
                  {armor?.dura?.[i] ?? 0}
                </span>
              </div>
            ))}
          </div>
          <div className="inv-off flex flex-col items-center justify-end" style={{ gap: u(6) }}>
            <span className="txt-o" style={{ fontSize: u(12), color: '#ffd23b' }}>
              {t('OFFHAND')}
            </span>
            <Slot index={OFFHAND} slot={inv[OFFHAND]} picked={picked === OFFHAND} onPick={pick} sword={sword} label="🛡" big />
            <span className="inv-tip txt-o text-center" style={{ fontSize: u(11), color: '#cfc6ee', maxWidth: u(150), lineHeight: 1.2 }}>
              {t('Shield here: right click blocks with your sword in hand. F swaps hands.')}
            </span>
          </div>
        </div>
        <span className="txt-o" style={{ fontSize: u(12), color: '#cfc6ee' }}>
          {t('BAG')}
        </span>
        {[0, 1, 2].map((r) => (
          <div key={r} className="flex" style={{ gap: u(4) }}>
            {row(HOTBAR + r * 9, 9).map((i) => (
              <Slot key={i} index={i} slot={inv[i]} picked={picked === i} onPick={pick} sword={sword} />
            ))}
          </div>
        ))}
        <span className="txt-o" style={{ fontSize: u(12), color: '#cfc6ee' }}>
          {t('HOTBAR')}
        </span>
        <div className="flex" style={{ gap: u(4) }}>
          {row(0, HOTBAR).map((i) => (
            <Slot key={i} index={i} slot={inv[i]} picked={picked === i} onPick={pick} sword={sword} label={String(i + 1)} />
          ))}
        </div>
        <span className="txt-o" style={{ fontSize: u(12), color: picked < 0 ? '#bdb3e0' : '#ffd23b' }}>
          {picked < 0 ? t('Tap an item, then where it goes · E or Esc closes') : t('Now tap where it goes (the same item stacks)')}
        </span>
      </div>
      {/* Crafting: what you mined turns into things that keep you alive. */}
      <div className="craft-col flex flex-col" style={{ gap: u(6), width: u(250) }}>
        <div className="craft-head flex flex-col" style={{ gap: u(4) }}>
          <Fancy size={22} from="#ffffff" to="#7cff9e">
            {t('CRAFTING')}
          </Fancy>
          <span className="txt-o" style={{ fontSize: u(11), color: '#cfc6ee', lineHeight: 1.2 }}>
            {t('Blocks you mine land in your inventory. Turn them into gear:')}
          </span>
        </div>
        {RECIPES.map((r) => (
          <Recipe key={r.id} r={r} inv={inv} sword={sword} atTable={atTable} />
        ))}
      </div>
      </div>
    </div>
  )
}
