import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CAPES, casePool, DAY_MS, GEM_PRODUCTS, RARITY_ORDER, SWORD_SKINS } from '../../shared/balance.js'
import { GameHost } from '../../shared/host.js'
import { applyGemGrant, applyRoundResult, createProfile, refreshQuests } from '../../shared/logic.js'
import { mulberry32 } from '../../shared/rng.js'
import { PlayerSession } from '../../shared/session.js'

const NOW = 20_100 * DAY_MS + 1000

test('gem exclusives never come out of a cash case; mythic cases are Epic or better', () => {
  for (const id of ['cape', 'sword']) {
    const table = id === 'cape' ? CAPES : SWORD_SKINS
    assert.ok(casePool(id).every((e) => !table[e.id].gemOnly))
  }
  for (const id of ['mythic_cape', 'mythic_sword']) {
    const pool = casePool(id)
    assert.ok(pool.length > 0)
    assert.ok(pool.every((e) => RARITY_ORDER.indexOf(e.rarity) >= RARITY_ORDER.indexOf('epic')))
    assert.ok(Math.abs(pool.reduce((s, e) => s + e.chance, 0) - 1) < 1e-9)
  }
  // Every exclusive product points at a real gem-only cosmetic.
  for (const p of Object.values(GEM_PRODUCTS).filter((x) => x.group === 'exclusive')) {
    if (p.grant.cape) assert.ok(CAPES[p.grant.cape]?.gemOnly)
    if (p.grant.sword) assert.ok(SWORD_SKINS[p.grant.sword]?.gemOnly)
  }
})

test('gem products grant what they say', () => {
  const p = createProfile('g1', 'Gem')
  applyGemGrant(p, 'cape_aurora', NOW)
  assert.ok(p.capes.includes('aurora'))
  const opened = applyGemGrant(p, 'mythic_sword_case', NOW, mulberry32(3))
  assert.ok(opened.caseResult.ok)
  assert.ok(RARITY_ORDER.indexOf(SWORD_SKINS[opened.caseResult.id].rarity) >= RARITY_ORDER.indexOf('epic'))
  // XP: the pass is +50%, the boost doubles for an hour; they stack.
  const base = applyRoundResult(createProfile('x', 'X'), { kills: 1 }, NOW).xp
  applyGemGrant(p, 'xp_pass', NOW)
  applyGemGrant(p, 'xp_boost', NOW)
  assert.equal(applyRoundResult(p, { kills: 1 }, NOW + 1000).xp, Math.round(base * 3))
  assert.equal(applyRoundResult(p, { kills: 1 }, NOW + 61 * 60 * 1000).xp, Math.round(base * 1.5))
  // New quests: a different set today.
  refreshQuests(p, NOW + 2000)
  const before = p.quests.list.map((q) => q.id).join()
  applyGemGrant(p, 'quest_refresh', NOW + 3000)
  assert.notEqual(p.quests.list.map((q) => q.id).join(), before)
  assert.equal(p.quests.list.length, 3)
})

test('VIP shows in the roster; a case bought with gems opens on screen', () => {
  const profile = createProfile('v', 'Vee')
  const emitted = []
  const session = new PlayerSession(profile, { now: NOW, emit: (type, payload) => emitted.push({ type, payload }), rand: mulberry32(2) })
  session.grantGemProduct('vip', NOW)
  session.grantGemProduct('mythic_cape_case', NOW)
  assert.ok(emitted.some((e) => e.type === 'caseResult' && e.payload.gift && e.payload.ok))
  let t = NOW
  const sent = []
  const host = new GameHost({ send: (cid, type, payload) => sent.push({ type, payload }), now: () => t, random: mulberry32(1), log: () => {} })
  host.join('v', 'Vee', session.look())
  t += 50
  host.tick(0.05)
  const roster = [...sent].reverse().find((m) => m.type === 'roster').payload.list
  assert.equal(roster.find((e) => e.name === 'Vee').vip, true)
})
