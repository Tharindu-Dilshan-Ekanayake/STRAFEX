import { useEffect, useState } from 'react'

import { ARMOR, ARMOR_PIECES, HOTBAR, ITEMS, OFFHAND } from '@shared/balance'

import { sfx } from '../../audio/sfx'
import { itemIcon } from '../../game/art/items'
import { exitPointerLock } from '../../game/input'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import { u } from '../format'
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
      style={{ width: big ? u(62) : u(54), height: big ? u(62) : u(54), outline: picked ? `${u(3)} solid #ffd23b` : 'none' }}
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

export function InventoryPanel() {
  const inv = useGame((s) => s.me.inv)
  const armor = useGame((s) => s.me.armor)
  const sword = useGame((s) => s.profile.sword)
  const close = useGame((s) => s.closePanel)
  const [picked, setPicked] = useState(-1)
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
    <div className="panel-wrap absolute inset-0 z-30 flex items-center justify-center bg-black/45" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mc-panel pop-in pointer-events-auto flex flex-col text-white" style={{ padding: u(14), gap: u(10) }}>
        <div className="flex items-center justify-between" style={{ gap: u(16) }}>
          <Fancy size={28} from="#ffffff" to="#ffd23b">
            {t('INVENTORY')}
          </Fancy>
          <Button color="#d8443a" style={{ width: u(42), height: u(42), fontSize: u(22) }} onClick={close}>
            ✕
          </Button>
        </div>
        <div className="flex" style={{ gap: u(16) }}>
          {/* Armour, read-only: what each piece has left. */}
          <div className="flex flex-col" style={{ gap: u(4) }}>
            {ARMOR_PIECES.map((name, i) => (
              <div key={name} className="slot flex flex-col items-center justify-center" style={{ width: u(62), height: u(54), opacity: set?.color ? 1 : 0.4 }} title={`${set?.name || ''} ${name}`}>
                <span className="txt-o" style={{ fontSize: u(10), color: '#cfc6ee' }}>
                  {t(name.toUpperCase())}
                </span>
                <span className="txt-o" style={{ fontSize: u(15), fontWeight: 700, color: set?.color || '#888' }}>
                  {armor?.dura?.[i] ?? 0}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-end" style={{ gap: u(6) }}>
            <span className="txt-o" style={{ fontSize: u(12), color: '#ffd23b' }}>
              {t('OFFHAND')}
            </span>
            <Slot index={OFFHAND} slot={inv[OFFHAND]} picked={picked === OFFHAND} onPick={pick} sword={sword} label="🛡" big />
            <span className="txt-o text-center" style={{ fontSize: u(11), color: '#cfc6ee', maxWidth: u(150), lineHeight: 1.2 }}>
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
        <span className="txt-o" style={{ fontSize: u(12), color: '#bdb3e0' }}>
          {picked < 0 ? t('Click an item, then where it goes · E or Esc closes') : t('Now click where it goes (the same item stacks)')}
        </span>
      </div>
    </div>
  )
}
