import {
  AD_REWARDS,
  CAPES,
  CASES,
  DAILY_REWARDS,
  DAY_MS,
  DUPLICATE_REFUND,
  GEM_PRODUCTS,
  LEVEL_CASE_EVERY,
  levelCash,
  levelXp,
  QUEST_IDS,
  QUESTS,
  QUESTS_PER_DAY,
  REWARDS,
  rollCase,
  SWORD_SKINS,
  XP,
} from './balance.js'
import { mulberry32 } from './rng.js'

/**
 * The saved profile and the pure rules that change it: round rewards, cases, equipping,
 * daily rewards, Gems and ad grants. No I/O here - the server and the offline stand-in
 * both call these and persist the result their own way.
 */

export const PROFILE_VERSION = 1
export const START_CASH = 300

export function createProfile(id, name) {
  return {
    version: PROFILE_VERSION,
    id,
    name,
    cash: START_CASH,
    wins: 0,
    kills: 0,
    games: 0,
    capes: ['none'],
    swords: ['classic'],
    cape: 'none',
    sword: 'classic',
    passes: {},
    daily: { lastDay: -1, streak: 0 },
    adAt: {},
    tutorial: false,
    welcomeGift: false,
    level: 1,
    xp: 0,
    /** Timed boosts: `{ xpUntil }` (ms timestamps). */
    boosts: {},
    quests: { day: -1, list: [] },
    stats: { playtime: 0, bestKills: 0, cashEarned: 0, casesOpened: 0 },
    createdAt: Date.now(),
    lastSeen: Date.now(),
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** Any stored (or missing, or old) profile made safe to use. */
export function normalizeProfile(raw, id, name) {
  const base = createProfile(id, name)
  if (!raw || typeof raw !== 'object' || raw.version !== PROFILE_VERSION) return base
  const p = { ...base, ...raw, id, name: name || raw.name || base.name }
  for (const k of ['cash', 'wins', 'kills', 'games']) p[k] = isNum(p[k]) ? Math.max(0, Math.floor(p[k])) : 0
  p.capes = [...new Set(['none', ...(Array.isArray(raw.capes) ? raw.capes.filter((c) => CAPES[c]) : [])])]
  p.swords = [...new Set(['classic', ...(Array.isArray(raw.swords) ? raw.swords.filter((s) => SWORD_SKINS[s]) : [])])]
  if (!p.capes.includes(p.cape)) p.cape = 'none'
  if (!p.swords.includes(p.sword)) p.sword = 'classic'
  p.passes = raw.passes && typeof raw.passes === 'object' ? { ...raw.passes } : {}
  p.daily = { lastDay: isNum(raw.daily?.lastDay) ? raw.daily.lastDay : -1, streak: isNum(raw.daily?.streak) ? raw.daily.streak : 0 }
  p.adAt = raw.adAt && typeof raw.adAt === 'object' ? { ...raw.adAt } : {}
  p.boosts = raw.boosts && typeof raw.boosts === 'object' && isNum(raw.boosts.xpUntil) ? { xpUntil: raw.boosts.xpUntil } : {}
  p.level = isNum(raw.level) ? Math.max(1, Math.floor(raw.level)) : 1
  p.xp = isNum(raw.xp) ? Math.max(0, Math.floor(raw.xp)) : 0
  const q = raw.quests
  p.quests = {
    day: isNum(q?.day) ? q.day : -1,
    swaps: isNum(q?.swaps) ? q.swaps : 0,
    list: Array.isArray(q?.list)
      ? q.list.filter((e) => e && QUESTS[e.id]).map((e) => ({ id: e.id, progress: isNum(e.progress) ? Math.max(0, e.progress) : 0, done: Boolean(e.done) }))
      : [],
  }
  p.stats = { ...base.stats, ...(raw.stats || {}) }
  for (const k of Object.keys(base.stats)) if (!isNum(p.stats[k])) p.stats[k] = 0
  return p
}

/** Per-connection state the UI also reads. */
export function createSession(now) {
  return { startedAt: now }
}

export const dayNumber = (now) => Math.floor(now / DAY_MS)

/** `{ level, xp, need }`: where you are on the way to the next level. */
export function levelProgress(profile) {
  return { level: profile.level, xp: profile.xp, need: levelXp(profile.level) }
}

/**
 * Adds XP and handles the level-ups it causes: cash each level, a free case (capes and
 * swords in turn) every fifth. Returns `[{ level, cash, case? }]`, one per level gained.
 */
export function addXp(profile, xp, rng = Math.random) {
  const ups = []
  profile.xp += Math.max(0, Math.floor(xp))
  while (profile.xp >= levelXp(profile.level)) {
    profile.xp -= levelXp(profile.level)
    profile.level += 1
    const up = { level: profile.level, cash: levelCash(profile.level) }
    profile.cash += up.cash
    if (profile.level % LEVEL_CASE_EVERY === 0) {
      const caseId = (profile.level / LEVEL_CASE_EVERY) % 2 ? 'cape' : 'sword'
      up.case = openCase(profile, caseId, rng, true)
    }
    ups.push(up)
  }
  return ups
}

/**
 * Today's quests (picked from the day and your id, so they're the same on every device).
 * `force` swaps them for a different three (the New Quests product).
 */
export function refreshQuests(profile, now, force = false) {
  const today = dayNumber(now)
  if (!force && profile.quests.day === today && profile.quests.list.length) return false
  const swaps = force ? (profile.quests.day === today ? profile.quests.swaps || 0 : 0) + 1 : 0
  const old = force ? new Set(profile.quests.list.map((q) => q.id)) : new Set()
  let h = today + swaps * 7919
  for (const ch of String(profile.id)) h = (h * 31 + ch.charCodeAt(0)) | 0
  const rng = mulberry32(h)
  const pool = [...QUEST_IDS]
  const list = []
  while (list.length < QUESTS_PER_DAY && pool.length) {
    const id = pool.splice(Math.floor(rng() * pool.length), 1)[0]
    // One quest per kind of stat a day; a swap brings different ones where it can.
    if (list.some((q) => QUESTS[q.id].stat === QUESTS[id].stat)) continue
    if (old.has(id) && pool.length > QUESTS_PER_DAY - list.length) continue
    list.push({ id, progress: 0, done: false })
  }
  profile.quests = { day: today, list, swaps }
  return true
}

/** What a round adds to each quest stat. */
export const questStats = ({ kills = 0, placement = 99, win = false, lucky = 0, placed = 0 }) => ({
  kills,
  wins: win ? 1 : 0,
  lucky,
  games: 1,
  placed,
  top3: placement <= 3 ? 1 : 0,
})

/** Moves today's quests along; finished ones pay out. Returns the ones just finished. */
export function progressQuests(profile, stats, now) {
  refreshQuests(profile, now)
  const done = []
  for (const q of profile.quests.list) {
    if (q.done) continue
    const def = QUESTS[q.id]
    q.progress = Math.min(def.goal, q.progress + (stats[def.stat] || 0))
    if (q.progress >= def.goal) {
      q.done = true
      profile.cash += def.cash
      done.push({ id: q.id, name: def.name, cash: def.cash, xp: def.xp })
    }
  }
  return done
}

/**
 * A finished round: cash, XP, quest progress and any level-ups, all applied to the
 * profile. `lucky` and `placed` are the lucky blocks broken and blocks placed.
 */
export function applyRoundResult(profile, { kills = 0, placement = 99, win = false, lucky = 0, placed = 0 }, now = Date.now(), rng = Math.random) {
  let cash = REWARDS.play + kills * REWARDS.kill
  if (win) cash += REWARDS.win
  cash += REWARDS.placement[placement - 1] || 0
  if (profile.passes.vip) cash *= 2
  profile.cash += cash
  profile.kills += kills
  profile.games += 1
  if (win) profile.wins += 1
  profile.stats.bestKills = Math.max(profile.stats.bestKills, kills)
  profile.stats.cashEarned += cash

  let xp = XP.play + kills * XP.kill + Math.min(lucky, XP.maxLucky) * XP.lucky + (XP.placement[placement - 1] || 0)
  if (win) xp += XP.win
  // XP Pass (+50%) and an active XP Boost (x2) stack.
  const xpMul = (profile.passes.xp ? 1.5 : 1) * ((profile.boosts?.xpUntil || 0) > now ? 2 : 1)
  xp = Math.round(xp * xpMul)
  const quests = progressQuests(profile, questStats({ kills, placement, win, lucky, placed }), now)
  const questXp = quests.reduce((s, q) => s + q.xp, 0)
  const levelUps = addXp(profile, xp + questXp, rng)
  return { cash, kills, placement, win, xp, quests, levelUps, level: profile.level }
}

/**
 * Opens case `caseId`: takes the price, draws a cosmetic. A duplicate gives part of the
 * price back. Returns `{ ok, error?, id, kind, duplicate, refund }`.
 */
export function openCase(profile, caseId, rng = Math.random, free = false) {
  const c = CASES[caseId]
  if (!c) return { ok: false, error: 'Unknown case' }
  if (!free && profile.cash < c.price) return { ok: false, error: 'Not enough cash' }
  if (!free) profile.cash -= c.price
  const id = rollCase(caseId, rng)
  const list = c.kind === 'cape' ? profile.capes : profile.swords
  const duplicate = list.includes(id)
  let refund = 0
  if (duplicate) {
    refund = Math.round(c.price * DUPLICATE_REFUND)
    profile.cash += refund
  } else {
    list.push(id)
  }
  profile.stats.casesOpened += 1
  return { ok: true, caseId, id, kind: c.kind, duplicate, refund }
}

export function equip(profile, kind, id) {
  if (kind === 'cape' && profile.capes.includes(id)) {
    profile.cape = id
    return true
  }
  if (kind === 'sword' && profile.swords.includes(id)) {
    profile.sword = id
    return true
  }
  return false
}

/** `{ day, ready, streak, reward }` for today's daily reward. */
export function dailyStatus(profile, now) {
  const today = dayNumber(now)
  const ready = profile.daily.lastDay !== today
  const continues = profile.daily.lastDay === today - 1
  const streak = ready ? (continues ? profile.daily.streak + 1 : 1) : profile.daily.streak
  const reward = DAILY_REWARDS[Math.min(streak, DAILY_REWARDS.length) - 1] || DAILY_REWARDS[0]
  return { ready, streak, reward }
}

export function claimDaily(profile, now) {
  const status = dailyStatus(profile, now)
  if (!status.ready) return { ok: false }
  profile.daily = { lastDay: dayNumber(now), streak: status.streak }
  profile.cash += status.reward
  return { ok: true, cash: status.reward, streak: status.streak }
}

/**
 * Applies a Gems product's grant. Returns `{ label, caseResult? }` (a case product opens
 * its case at once), or null for an unknown product.
 */
export function applyGemGrant(profile, sku, now = Date.now(), rng = Math.random) {
  const product = GEM_PRODUCTS[sku]
  if (!product) return null
  const g = product.grant
  if (g.cash) profile.cash += g.cash
  if (g.pass) profile.passes[g.pass] = true
  if (g.cape && !profile.capes.includes(g.cape)) profile.capes.push(g.cape)
  if (g.sword && !profile.swords.includes(g.sword)) profile.swords.push(g.sword)
  if (g.xpBoostMs) profile.boosts = { ...profile.boosts, xpUntil: Math.max(now, profile.boosts?.xpUntil || 0) + g.xpBoostMs }
  if (g.questRefresh) refreshQuests(profile, now, true)
  const caseResult = g.case ? openCase(profile, g.case, rng, true) : null
  return { label: product.name, caseResult }
}

export function applyAdReward(profile, placement, now) {
  const ad = AD_REWARDS[placement]
  if (!ad) return null
  if (now - (profile.adAt[placement] || 0) < ad.cooldownMs) return null
  profile.adAt[placement] = now
  if (ad.grant.cash) profile.cash += ad.grant.cash
  return ad.label
}

/** Nothing accrues while away in this game. Kept for the server's join flow. */
export function applyOfflineProgress() {
  return null
}
