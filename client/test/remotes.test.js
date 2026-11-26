import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ITEM_IDS } from '@shared/protocol'

import { runtime } from '../src/game/runtime'
import { applySnapshot, clearRemotes, INTERP_MS, interpolateRemotes } from '../src/net/remotes'
import { quickBubble, showQuickChat } from '../src/net/quickChat'

const entry = (eid, x, z, held = 'fist') => [eid, x * 100, 3000, z * 100, 0, 0, 1, ITEM_IDS.indexOf(held)]

describe('remote players', () => {
  beforeEach(() => {
    clearRemotes()
    runtime.fx.length = 0
    runtime.eid = 1
    runtime.zone = 'match'
  })

  it('draws others between snapshots, a little in the past', () => {
    let t = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    applySnapshot('match', [...entry(2, 0, 0), ...entry(1, 9, 9)])
    t += 100
    applySnapshot('match', entry(2, 1, 0, 'stone_sword'))
    expect(runtime.remotes.has(1)).toBe(false) // never ourselves
    const r = runtime.remotes.get(2)
    expect(r.held).toBe('stone_sword')
    // INTERP_MS behind "now": halfway between the two snapshots.
    t = 10_000 + 50 + INTERP_MS
    interpolateRemotes(1 / 60)
    expect(r.x).toBeCloseTo(0.5, 5)
    vi.restoreAllMocks()
  })

  it('keeps at most 20 snapshots per player and reuses them', () => {
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    for (let i = 0; i < 50; i += 1) {
      t += 50
      applySnapshot('match', entry(2, i, 0))
    }
    const r = runtime.remotes.get(2)
    expect(r.snaps.length).toBe(20)
    const first = r.snaps[0]
    t += 50
    applySnapshot('match', entry(2, 99, 0))
    expect(r.snaps.at(-1)).toBe(first) // the oldest entry, recycled
    vi.restoreAllMocks()
  })

  it('ignores the other zone, and puffs smoke when someone vanishes mid-round', () => {
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    applySnapshot('lobby', entry(3, 0, 0))
    expect(runtime.remotes.size).toBe(0)
    applySnapshot('match', entry(3, 4, 4))
    t += 1000
    applySnapshot('match', entry(3, 4, 4))
    t += 50
    applySnapshot('match', [])
    expect(runtime.remotes.size).toBe(0)
    expect(runtime.fx.some((f) => f.type === 'poof')).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('quick chat bubbles', () => {
  it('shows a line for a few seconds', () => {
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    expect(showQuickChat(7, 0)).toBe('GG!')
    expect(quickBubble(7)).toBe('GG!')
    t += 4000
    expect(quickBubble(7)).toBe(null)
    expect(showQuickChat(7, 999)).toBeUndefined()
    vi.restoreAllMocks()
  })
})
