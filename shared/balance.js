import { B } from './voxel.js'

/**
 * Every number that shapes the game: round timings, items, what lucky blocks give,
 * rewards, cases and their cosmetics, and the Gems products. Shared by the server and
 * the client so both always agree.
 */

// --- The round ------------------------------------------------------------------------

export const ROUND = {
  /**
   * Lobby time before a round, in three steps: a countdown (`waitMs`), the mode vote
   * (`modeVoteMs`), then the map vote (`mapVoteMs`). A vote step ends early once
   * everyone has voted; the countdown always runs out.
   */
  waitMs: 30_000,
  modeVoteMs: 15_000,
  mapVoteMs: 15_000,
  intermissionMs: 60_000,
  /** The same after a round, when everyone comes back to the lobby. */
  intermissionAfterMs: 60_000,
  /** In the glass cages above your island before they open. */
  cagesMs: 5_000,
  /** Longest a round can last; the lava ends it before then. */
  fightMs: 240_000,
  /** Winner on screen before everyone goes back to the lobby. */
  endMs: 7_000,
  /** Fighters in a round: every empty island is filled with a bot. */
  minFighters: 8,
  maxFighters: 8,
  /** Health in half-hearts (20 = ten hearts). */
  hp: 20,
}

/** The lava: where it starts, when it starts climbing and where it ends. */
export const LAVA = {
  startY: 6,
  riseAfterMs: 50_000,
  /**
   * Two stages: a slow creep up to `surgeY` (under the islands: it threatens nobody
   * standing, it just looks closer), then a surge that floods the islands and ends any
   * stand-off, reaching `endY` `finishEarlyMs` before the clock runs out.
   */
  surgeY: 18,
  surgeAt: 0.53,
  finishEarlyMs: 15_000,
  endY: 40,
  /** Damage every `tickMs` while you stand in it. */
  damage: 4,
  tickMs: 500,
}

/** Lava height `ms` into the fight. */
export function lavaHeight(ms, mode = 'classic') {
  const m = MODES[mode] || MODES.classic
  const start = LAVA.riseAfterMs * m.lavaDelay
  if (ms <= start) return LAVA.startY
  const end = m.lavaEndMs || ROUND.fightMs - LAVA.finishEarlyMs
  const t = Math.min(1, (ms - start) / (end - start))
  if (t < LAVA.surgeAt) return LAVA.startY + (LAVA.surgeY - LAVA.startY) * (t / LAVA.surgeAt)
  return LAVA.surgeY + (LAVA.endY - LAVA.surgeY) * ((t - LAVA.surgeAt) / (1 - LAVA.surgeAt))
}

/** Game modes the lobby votes on. */
export const MODES = {
  classic: {
    name: 'Solo',
    blurb: 'Free for all: every player for themselves. Last one standing wins!',
    color: '#f6b52d',
    teams: 0,
    luckyPerIsland: 3,
    rareChance: 0.05,
    hpBonus: 0,
    lavaDelay: 1,
    rolls: 1,
  },
  teams4: {
    name: '4 Teams',
    blurb: '2v2v2v2: teams of two on neighbouring islands. Last team standing wins!',
    color: '#3fa2ff',
    teams: 4,
    luckyPerIsland: 3,
    rareChance: 0.08,
    hpBonus: 0,
    lavaDelay: 1,
    rolls: 1,
  },
  teams3: {
    name: '3 Teams',
    blurb: '3v3v2 (the team of two gets extra hearts). Last team standing wins!',
    color: '#e0782b',
    teams: 3,
    luckyPerIsland: 3,
    rareChance: 0.09,
    hpBonus: 2,
    lavaDelay: 1,
    rolls: 1,
  },
  teams2: {
    name: '2 Teams',
    blurb: '4v4: one half of the ring each. Bridge across together and push!',
    color: '#2bb37a',
    teams: 2,
    luckyPerIsland: 3,
    rareChance: 0.1,
    hpBonus: 4,
    lavaDelay: 1,
    rolls: 1,
  },
  maxluck: {
    name: 'Max Luck',
    blurb: 'Every lucky block is a Mega Lucky Block, and they give double!',
    color: '#b34cf0',
    teams: 0,
    luckyPerIsland: 4,
    rareChance: 1,
    hpBonus: 10,
    lavaDelay: 1,
    rolls: 2,
  },
  lavarush: {
    name: 'Lava Rush',
    blurb: 'The lava starts rising right away. Build fast!',
    color: '#ef4b2b',
    teams: 0,
    luckyPerIsland: 3,
    rareChance: 0.15,
    hpBonus: 0,
    lavaDelay: 0.15,
    /** The lava is done by this far into the fight (the default is fightMs - finishEarlyMs). */
    lavaEndMs: 170_000,
    rolls: 1,
  },
}

/** How hard bots play: how well they aim and time hits, and how hard they hit. */
export const BOT_LEVELS = {
  off: { name: 'No bots', skill: [0.5, 0.85], damage: 0.8, reaction: 1, color: '#8b84a8' },
  easy: { name: 'Easy', skill: [0.3, 0.5], damage: 0.6, reaction: 1.6, color: '#5ee26a' },
  normal: { name: 'Medium', skill: [0.5, 0.85], damage: 0.8, reaction: 1, color: '#f6b52d' },
  hard: { name: 'Hard', skill: [0.8, 0.98], damage: 1, reaction: 0.6, color: '#ff5a4a' },
}
export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS)

/** Team colours, by team index (team modes only). */
export const TEAMS = [
  { name: 'Blue', color: '#3fa2ff' },
  { name: 'Red', color: '#ff5a4a' },
  { name: 'Green', color: '#5ee26a' },
  { name: 'Yellow', color: '#ffd23b' },
]
export const MODE_IDS = Object.keys(MODES)

// --- Items ------------------------------------------------------------------------------

/**
 * Everything that can sit in the hotbar. `kind`:
 * - sword / tool: melee, `dmg` per hit (tool also breaks blocks `mine` times faster)
 * - bow: shoots arrows; the stack count is its arrows
 * - throw: thrown projectile (snowball knocks back, pearl teleports you)
 * - tnt: placed like a block, lights itself and explodes
 * - food / potion / heart: used up with right click
 * - block: builds; `block` is the block it places
 */
export const ITEMS = {
  fist: { name: 'Fist', kind: 'none', dmg: 1, icon: 'fist' },
  wood_sword: { name: 'Wooden Sword', kind: 'sword', dmg: 4, icon: 'sword', tier: 'wood', stack: 1 },
  stone_sword: { name: 'Stone Sword', kind: 'sword', dmg: 5, icon: 'sword', tier: 'stone', stack: 1 },
  iron_sword: { name: 'Iron Sword', kind: 'sword', dmg: 6, icon: 'sword', tier: 'iron', stack: 1 },
  diamond_sword: { name: 'Diamond Sword', kind: 'sword', dmg: 7, icon: 'sword', tier: 'diamond', stack: 1 },
  blaze_sword: { name: 'Blaze Sword', kind: 'sword', dmg: 8, burn: 3, icon: 'sword', tier: 'blaze', stack: 1 },
  pickaxe: { name: 'Lucky Pickaxe', kind: 'tool', dmg: 3, mine: 3, icon: 'pickaxe', stack: 1 },
  bow: { name: 'Bow', kind: 'bow', dmg: 6, icon: 'bow', stack: 32 },
  snowball: { name: 'Snowball', kind: 'throw', dmg: 1, knock: 9, icon: 'snowball', stack: 16 },
  pearl: { name: 'Warp Pearl', kind: 'throw', dmg: 0, icon: 'pearl', stack: 8 },
  tnt: { name: 'TNT', kind: 'tnt', icon: 'tnt', stack: 8 },
  bread: { name: 'Bread', kind: 'food', heal: 5, icon: 'bread', stack: 16 },
  gapple: { name: 'Golden Apple', kind: 'food', heal: 10, regen: 6, icon: 'gapple', stack: 8 },
  potion_speed: { name: 'Speed Potion', kind: 'potion', effect: 'speed', dur: 25, icon: 'potion', color: '#5fd3ff', stack: 4 },
  potion_jump: { name: 'Jump Potion', kind: 'potion', effect: 'jump', dur: 25, icon: 'potion', color: '#7cff6b', stack: 4 },
  potion_strength: { name: 'Strength Potion', kind: 'potion', effect: 'strength', dur: 20, icon: 'potion', color: '#ff5050', stack: 4 },
  potion_heal: { name: 'Healing Potion', kind: 'potion', heal: 8, icon: 'potion', color: '#ff7bd5', stack: 4 },
  heart: { name: 'Heart Crystal', kind: 'heart', maxHp: 4, icon: 'heart', stack: 4 },
  wool: { name: 'Wool', kind: 'block', block: B.WOOL_WHITE, icon: 'block', stack: 64 },
  planks: { name: 'Planks', kind: 'block', block: B.PLANKS, icon: 'block', stack: 64 },
  stone_bricks: { name: 'Stone Bricks', kind: 'block', block: B.STONE_BRICKS, icon: 'block', stack: 64 },
  dirt: { name: 'Dirt', kind: 'block', block: B.DIRT, icon: 'block', stack: 64 },
  sandstone: { name: 'Sandstone', kind: 'block', block: B.SANDSTONE, icon: 'block', stack: 64 },
  snow: { name: 'Snow', kind: 'block', block: B.SNOW, icon: 'block', stack: 64 },
  candy: { name: 'Candy', kind: 'block', block: B.CANDY_PINK, icon: 'block', stack: 64 },
}

/** What everyone holds in the lobby (shown with their sword skin; it does no damage). */
export const LOBBY_SWORD = 'diamond_sword'

/** The hotbar has this many slots. */
export const HOTBAR = 9
/** How far you reach to break, place and hit (blocks). */
export const REACH = 5
export const MELEE_REACH = 3.6
/** Fastest you can swing (ms between hits that count). */
export const ATTACK_COOLDOWN_MS = 420
/** Seconds to break a block by hand, before tools. */
export const breakSeconds = (hard, item) => (ITEMS[item]?.mine ? hard / ITEMS[item].mine : hard)

/** Potion effects: what they multiply. */
export const EFFECTS = {
  speed: { speedMul: 1.35 },
  jump: { jumpMul: 1.3 },
  strength: { dmgAdd: 3 },
  regen: {},
  burn: {},
}

/** Projectiles: launch speed (blocks/s), gravity, and lifetime. */
export const PROJECTILES = {
  arrow: { speed: 34, gravity: 18, life: 3, size: 0.25 },
  snowball: { speed: 26, gravity: 16, life: 2.5, size: 0.3 },
  pearl: { speed: 24, gravity: 16, life: 3, size: 0.3 },
}

export const TNT = { fuseMs: 2600, radius: 3.4, damage: 14, knock: 13 }

// --- Lucky blocks -----------------------------------------------------------------------

/**
 * What a lucky block gives: `give` = items, `bad` = an unlucky surprise. `w` is the
 * weight for a regular block, `rw` for a Mega one. Every lucky block also gives a few
 * blocks on top (LUCKY_BONUS_BLOCKS), so nobody is ever stuck on their island.
 */
export const LUCKY_LOOT = [
  { w: 12, rw: 4, give: [['wool', 16]], text: 'Wool!' },
  { w: 9, rw: 4, give: [['planks', 24]], text: 'Planks!' },
  { w: 9, rw: 1, give: [['stone_sword', 1]], text: 'Stone Sword!' },
  { w: 6, rw: 5, give: [['iron_sword', 1]], text: 'Iron Sword!' },
  { w: 2.4, rw: 7, give: [['diamond_sword', 1]], text: 'Diamond Sword!' },
  { w: 0.8, rw: 4, give: [['blaze_sword', 1]], text: 'BLAZE SWORD!' },
  { w: 5, rw: 6, give: [['bow', 10]], text: 'Bow & arrows!' },
  { w: 6, rw: 3, give: [['bread', 3]], text: 'Bread!' },
  { w: 2.5, rw: 5, give: [['gapple', 1]], text: 'Golden Apple!' },
  { w: 6, rw: 3, give: [['snowball', 8]], text: 'Snowballs!' },
  { w: 3, rw: 4, give: [['pearl', 2]], text: 'Warp Pearls!' },
  { w: 3, rw: 4, give: [['tnt', 2]], text: 'TNT!' },
  { w: 3.5, rw: 3, give: [['potion_speed', 1]], text: 'Speed Potion!' },
  { w: 3.5, rw: 3, give: [['potion_jump', 1]], text: 'Jump Potion!' },
  { w: 2.5, rw: 4, give: [['potion_strength', 1]], text: 'Strength Potion!' },
  { w: 3, rw: 3, give: [['potion_heal', 1]], text: 'Healing Potion!' },
  { w: 2, rw: 4, give: [['heart', 1]], text: '+2 Max Hearts!' },
  { w: 3.5, rw: 2, give: [['pickaxe', 1]], text: 'Lucky Pickaxe!' },
  { w: 3, rw: 2, give: [['wool', 32], ['stone_bricks', 16]], text: 'Building spree!' },
  { w: 3, rw: 0.5, bad: 'tnt', text: 'UNLUCKY! TNT!' },
  { w: 2, rw: 0.4, bad: 'lightning', text: 'UNLUCKY! Lightning!' },
  { w: 1.6, rw: 0.4, bad: 'launch', text: 'UNLUCKY! Yeet!' },
]
export const LUCKY_BONUS_BLOCKS = 8

/** One draw from the loot table (`rare` = a Mega Lucky Block). */
export function rollLucky(rng, rare = false) {
  const weight = (e) => (rare ? e.rw : e.w)
  const total = LUCKY_LOOT.reduce((s, e) => s + weight(e), 0)
  let r = rng() * total
  for (const entry of LUCKY_LOOT) {
    r -= weight(entry)
    if (r <= 0) return entry
  }
  return LUCKY_LOOT[0]
}

// --- Rewards ----------------------------------------------------------------------------

export const REWARDS = {
  play: 20,
  kill: 40,
  win: 150,
  /** Extra for 2nd and 3rd place. */
  placement: [0, 60, 30],
}

// --- Progression: XP, levels, daily quests ----------------------------------------------

/** XP for a round. Lucky blocks count up to `maxLucky` a round. */
export const XP = { play: 25, kill: 20, lucky: 4, maxLucky: 15, win: 80, placement: [0, 40, 20] }
/** XP from `level` to the next one: 120, 160, 200, ... */
export const levelXp = (level) => 80 + level * 40
/** Cash on reaching a level; every fifth level also gives a free case. */
export const levelCash = (level) => 50 + level * 10
export const LEVEL_CASE_EVERY = 5

/** Three of these each day. `stat` is what a round adds to (see logic.questStats). */
export const QUESTS = {
  kills5: { name: 'Get 5 kills', stat: 'kills', goal: 5, cash: 150, xp: 60 },
  kills12: { name: 'Get 12 kills', stat: 'kills', goal: 12, cash: 300, xp: 120 },
  win1: { name: 'Win a round', stat: 'wins', goal: 1, cash: 200, xp: 80 },
  lucky15: { name: 'Break 15 lucky blocks', stat: 'lucky', goal: 15, cash: 120, xp: 50 },
  lucky40: { name: 'Break 40 lucky blocks', stat: 'lucky', goal: 40, cash: 250, xp: 100 },
  play3: { name: 'Play 3 rounds', stat: 'games', goal: 3, cash: 100, xp: 40 },
  play8: { name: 'Play 8 rounds', stat: 'games', goal: 8, cash: 250, xp: 100 },
  place100: { name: 'Place 100 blocks', stat: 'placed', goal: 100, cash: 120, xp: 50 },
  top3x2: { name: 'Finish top 3 twice', stat: 'top3', goal: 2, cash: 150, xp: 60 },
}
export const QUEST_IDS = Object.keys(QUESTS)
export const QUESTS_PER_DAY = 3

/** How many maps each map vote offers (random, never the one just played). */
export const MAP_CHOICES = 6

// --- Cosmetics and cases ----------------------------------------------------------------

export const RARITIES = {
  common: { name: 'Common', color: '#b9c2cf', weight: 55 },
  uncommon: { name: 'Uncommon', color: '#5ee26a', weight: 27 },
  rare: { name: 'Rare', color: '#3fa2ff', weight: 12 },
  epic: { name: 'Epic', color: '#c25cff', weight: 4.6 },
  legendary: { name: 'Legendary', color: '#ffb52e', weight: 1.2 },
  mythic: { name: 'Mythic', color: '#ff4f6d', weight: 0.2 },
}
export const RARITY_ORDER = Object.keys(RARITIES)

/**
 * Capes, drawn from `pattern` (client/src/game/art/capes.js). `none` is everyone's
 * from the start.
 */
export const CAPES = {
  none: { name: 'No Cape', rarity: 'common', pattern: 'none', owned: true },
  crimson: { name: 'Crimson Cape', rarity: 'common', pattern: 'solid', colors: ['#c72a2a', '#7a1414'] },
  ocean: { name: 'Ocean Cape', rarity: 'common', pattern: 'solid', colors: ['#2a7fd4', '#134a80'] },
  leaf: { name: 'Leaf Cape', rarity: 'common', pattern: 'solid', colors: ['#3fae3a', '#1f6b1d'] },
  checker: { name: 'Checker Cape', rarity: 'uncommon', pattern: 'checker', colors: ['#f2f2f2', '#262626'] },
  pixel: { name: 'Pixel Cape', rarity: 'uncommon', pattern: 'pixels', colors: ['#ff5d5d', '#5db8ff', '#ffe15d', '#6bff6b'] },
  ghost: { name: 'Ghost Cape', rarity: 'uncommon', pattern: 'ghost', colors: ['#c9ccd1', '#1e1e1e'] },
  lucky: { name: 'Lucky Cape', rarity: 'rare', pattern: 'lucky', colors: ['#ffc928', '#ffffff'] },
  mega: { name: 'Mega Lucky Cape', rarity: 'rare', pattern: 'lucky', colors: ['#9b3df0', '#ffffff'] },
  smile: { name: 'Smiley Cape', rarity: 'rare', pattern: 'face', colors: ['#3bd25a', '#0d2b12'] },
  flame: { name: 'Flame Cape', rarity: 'epic', pattern: 'flame', colors: ['#ffe14d', '#ff7a1a', '#c21d0e'] },
  galaxy: { name: 'Galaxy Cape', rarity: 'epic', pattern: 'stars', colors: ['#1a1440', '#ffffff', '#b98cff'] },
  moon: { name: 'Blood Moon Cape', rarity: 'legendary', pattern: 'moon', colors: ['#2a0b12', '#ff3b3b'] },
  rainbow: { name: 'Rainbow Cape', rarity: 'legendary', pattern: 'rainbow', colors: [] },
  void: { name: 'Void Cape', rarity: 'mythic', pattern: 'void', colors: ['#050008', '#d14dff', '#5b1aa6'] },
  // Gem exclusives: never in a cash case.
  phoenix: { name: 'Phoenix Cape', rarity: 'legendary', pattern: 'flame', colors: ['#e6fbff', '#4fc3ff', '#1a4fd1'], gemOnly: true },
  royal: { name: 'Royal Cape', rarity: 'legendary', pattern: 'moon', colors: ['#1a0f2e', '#ffd23b'], gemOnly: true },
  aurora: { name: 'Aurora Cape', rarity: 'mythic', pattern: 'stars', colors: ['#062a2a', '#7affd1', '#3fd2ff'], gemOnly: true },
}

/** Sword skins recolour every sword you hold: blade, edge, guard, handle. */
export const SWORD_SKINS = {
  classic: { name: 'Classic', rarity: 'common', colors: null, owned: true },
  copper: { name: 'Copper', rarity: 'common', colors: ['#e0874a', '#ffc49a', '#7a3b17', '#4a2a14'] },
  leafy: { name: 'Leafy', rarity: 'common', colors: ['#52c447', '#b5ff9e', '#2d6b1e', '#5a3a1a'] },
  frost: { name: 'Frost', rarity: 'uncommon', colors: ['#9fe8ff', '#ffffff', '#3d7fb3', '#2a3d66'] },
  toxic: { name: 'Toxic', rarity: 'uncommon', colors: ['#6bff3b', '#d6ff9e', '#1d5c12', '#222222'] },
  ruby: { name: 'Ruby', rarity: 'rare', colors: ['#ff2f55', '#ffb3c1', '#6b0a1d', '#2a1a1a'] },
  golden: { name: 'Golden', rarity: 'rare', colors: ['#ffd23b', '#fff6c2', '#b37a10', '#5a3a1a'] },
  shadow: { name: 'Shadow', rarity: 'epic', colors: ['#3a2a55', '#9d7bff', '#110a1d', '#000000'] },
  inferno: { name: 'Inferno', rarity: 'epic', colors: ['#ff6a1a', '#ffe14d', '#8a1405', '#3a0a05'] },
  prism: { name: 'Prism', rarity: 'legendary', colors: ['#ff63e6', '#7af7ff', '#7a3bff', '#ffffff'] },
  voidblade: { name: 'Voidblade', rarity: 'mythic', colors: ['#0d0014', '#e15cff', '#5b1aa6', '#e15cff'] },
  // Gem exclusives: never in a cash case.
  dragon: { name: 'Dragonfang', rarity: 'legendary', colors: ['#2bd96b', '#d9ffe6', '#0d5c2e', '#3a2a1a'], gemOnly: true },
  obsidian: { name: 'Magma Obsidian', rarity: 'legendary', colors: ['#1c1626', '#ff5a2a', '#0a0612', '#ff5a2a'], gemOnly: true },
  celestial: { name: 'Celestial', rarity: 'mythic', colors: ['#ffffff', '#ffe8a3', '#7ab8ff', '#ffd23b'], gemOnly: true },
}

/** Cases, bought with cash in the lobby. */
export const CASES = {
  cape: { name: 'Cape Case', price: 400, kind: 'cape', color: '#ffb52e' },
  sword: { name: 'Sword Case', price: 600, kind: 'sword', color: '#3fa2ff' },
  // Bought with Gems (GEM_PRODUCTS): Epic or better, guaranteed.
  mythic_cape: { name: 'Mythic Cape Case', price: 0, kind: 'cape', color: '#ff4f6d', gems: true, minRarity: 'epic' },
  mythic_sword: { name: 'Mythic Sword Case', price: 0, kind: 'sword', color: '#ff4f6d', gems: true, minRarity: 'epic' },
}
/** A duplicate gives this share of the case price back. */
export const DUPLICATE_REFUND = 0.4

/** The cosmetics a case can give: `[{ id, rarity, chance }]`, chances summing to 1. */
export function casePool(caseId) {
  const c = CASES[caseId]
  if (!c) return []
  const table = c.kind === 'cape' ? CAPES : SWORD_SKINS
  const min = c.minRarity ? RARITY_ORDER.indexOf(c.minRarity) : 0
  const entries = Object.entries(table).filter(([, v]) => !v.owned && !v.gemOnly && RARITY_ORDER.indexOf(v.rarity) >= min)
  const byRarity = {}
  for (const [id, v] of entries) (byRarity[v.rarity] ||= []).push(id)
  const present = RARITY_ORDER.filter((r) => byRarity[r])
  const total = present.reduce((s, r) => s + RARITIES[r].weight, 0)
  const out = []
  for (const r of present) {
    for (const id of byRarity[r]) out.push({ id, rarity: r, chance: RARITIES[r].weight / total / byRarity[r].length })
  }
  return out
}

/** One draw from a case: the cosmetic id. */
export function rollCase(caseId, rng) {
  const pool = casePool(caseId)
  let r = rng()
  for (const e of pool) {
    r -= e.chance
    if (r <= 0) return e.id
  }
  return pool[pool.length - 1]?.id
}

// --- Daily rewards, Gems, ads -----------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000
/** Cash for each day of a login streak (day 7 repeats). */
export const DAILY_REWARDS = [100, 150, 200, 250, 300, 400, 600]

/**
 * Gems products (Boxity). Boxity owns prices; the server applies `grant` once Boxity
 * confirms a purchase (see server/src/gems.js).
 */
export const GEM_PRODUCTS = {
  // Exclusives: only with Gems.
  cape_aurora: { group: 'exclusive', name: 'Aurora Cape', blurb: 'Mythic. Only with Gems.', icon: 'cape', grant: { cape: 'aurora' } },
  cape_phoenix: { group: 'exclusive', name: 'Phoenix Cape', blurb: 'Legendary blue fire. Only with Gems.', icon: 'cape', grant: { cape: 'phoenix' } },
  cape_royal: { group: 'exclusive', name: 'Royal Cape', blurb: 'Legendary. Only with Gems.', icon: 'cape', grant: { cape: 'royal' } },
  sword_celestial: { group: 'exclusive', name: 'Celestial Sword', blurb: 'Mythic skin for every sword. Only with Gems.', icon: 'sword', grant: { sword: 'celestial' } },
  sword_dragon: { group: 'exclusive', name: 'Dragonfang Sword', blurb: 'Legendary skin. Only with Gems.', icon: 'sword', grant: { sword: 'dragon' } },
  sword_obsidian: { group: 'exclusive', name: 'Magma Obsidian Sword', blurb: 'Legendary skin. Only with Gems.', icon: 'sword', grant: { sword: 'obsidian' } },
  // Cases and boosts.
  mythic_cape_case: { group: 'cases', name: 'Mythic Cape Case', blurb: 'Epic, Legendary or Mythic cape - guaranteed', icon: 'case', grant: { case: 'mythic_cape' } },
  mythic_sword_case: { group: 'cases', name: 'Mythic Sword Case', blurb: 'Epic, Legendary or Mythic sword skin - guaranteed', icon: 'case', grant: { case: 'mythic_sword' } },
  vip: { group: 'boosts', name: 'VIP', blurb: 'x2 cash from every round and a crown on your name, forever', icon: 'crown', grant: { pass: 'vip' } },
  xp_pass: { group: 'boosts', name: 'XP Pass', blurb: '+50% XP from every round, forever', icon: 'star', grant: { pass: 'xp' } },
  xp_boost: { group: 'boosts', name: 'XP Boost', blurb: 'Double XP for 1 hour', icon: 'star', grant: { xpBoostMs: 60 * 60 * 1000 } },
  quest_refresh: { group: 'boosts', name: 'New Quests', blurb: "Swap today's quests for three new ones", icon: 'star', grant: { questRefresh: true } },
  starter: { group: 'cash', name: 'Starter Pack', blurb: 'Flame Cape + Inferno sword skin + 1,000 cash', icon: 'gift', grant: { cash: 1000, cape: 'flame', sword: 'inferno' } },
  cash_small: { group: 'cash', name: 'Bag of Cash', blurb: '+1,500 cash', icon: 'cash', grant: { cash: 1500 } },
  cash_big: { group: 'cash', name: 'Vault of Cash', blurb: '+8,000 cash', icon: 'cash', grant: { cash: 8000 } },
}
export const GEM_GROUPS = [
  ['exclusive', 'GEM EXCLUSIVES'],
  ['cases', 'MYTHIC CASES'],
  ['boosts', 'BOOSTS'],
  ['cash', 'CASH'],
]

/** Rewarded ads: watch one, get this. */
export const AD_REWARDS = {
  'free-cash': { label: '+150 Cash', icon: 'cash', grant: { cash: 150 }, cooldownMs: 3 * 60 * 1000 },
}

/** Quick chat: what a player can say with one key (works offline and for guests too). */
export const QUICK_CHAT = ['GG!', 'Nice one!', 'Help!', 'Team up?', 'Run!', 'Oops!', "Let's go!", '😂', '🔥', '👋']
/** At most one quick chat line per this many ms. */
export const QUICK_CHAT_MS = 1500

/** Names for bots that fill empty islands. */
export const BOT_NAMES = [
  'BlockyBen', 'PixelPia', 'LuckyLuca', 'CraftyCam', 'SkySam', 'NoobNoah', 'MinerMia', 'TNTtom',
  'BridgeBob', 'DiamondDee', 'CubeKai', 'LavaLeo', 'ZippyZoe', 'StackSteve', 'AppleAva', 'PearlPip',
]
