import { B } from './voxel.js'

/**
 * Every number that shapes STRAFEX: duel and Spirelands timings, the kits, items and
 * armour, combat rules, rewards, quests, cases and their cosmetics, and the Gems
 * products. Shared by the server and the client so both always agree.
 */

// --- Duels ------------------------------------------------------------------------------

export const DUEL = {
  /** Both players pick a map (ends early once both have voted). */
  voteMs: 10_000,
  /** Frozen on your spawn before each round: 3, 2, 1, FIGHT. */
  countdownMs: 3_000,
  /** Longest a round lasts; then the healthier player takes it. */
  roundMs: 150_000,
  /** The round winner on screen before the arena resets. */
  betweenMs: 2_800,
  /** The duel's winner on screen before both go back to the lobby. */
  endMs: 6_500,
  /**
   * Duels are against real players: you wait in the queue until someone else joins it,
   * online and offline. (`botFillMs` / `soloBotMs` only apply to test hosts made with
   * `duelBots`.)
   */
  botFillMs: 8_000,
  soloBotMs: 2_200,
}

/** Spirelands, the free-for-all world. */
export const FFA = {
  /**
   * Spirelands is kept at this many fighters: bots fill the places real players don't
   * (1 player: 9 bots ... 9 players: 1 bot); from this many real players on, no bots.
   */
  population: 10,
  /** Everyone a server holds can be in Spirelands at once. */
  maxPlayers: 30,
  /** A dead bot comes back after this. */
  botRespawnMs: 6_000,
  /** Broken ground grows back and placed blocks crumble after this. */
  restoreMs: 90_000,
  /** A kill heals the killer this much. */
  killHeal: 6,
}

/** Health in half-hearts (20 = ten hearts). */
export const HP = 20

// --- Combat -----------------------------------------------------------------------------

export const COMBAT = {
  /** After a hit lands, the target can't take another for this long (no damage stacking). */
  iframesMs: 450,
  /** Base knockback of a melee hit (blocks/s), and the boost for a sprinting hitter. */
  knock: 6.4,
  knockUp: 6,
  sprintKnock: 1.45,
  /** A hit while falling: this many times the damage. */
  critMul: 1.5,
  /** Melee reach (blocks, eye to the nearest point of the target), and the spear's. */
  reach: 3.1,
  /** Shield: raised this long before it blocks; an axe hit puts it down for `shieldOffMs`. */
  shieldWindupMs: 120,
  shieldOffMs: 5_000,
  /** Mace smash: extra damage per block fallen (first 3 blocks, then after), capped. */
  maceFirst: 4,
  maceAfter: 2,
  maceCap: 24,
  /** Falls longer than this many blocks hurt, a half-heart per block more. */
  safeFall: 3.2,
  /** Out of a fight this long, you heal (kits with natural regeneration). */
  regenDelayMs: 5_000,
  regenMs: 2_500,
  /** Spear lunge: dash speed, how long the next hit is boosted, and the boost. */
  lungeSpeed: 15,
  lungeLift: 3.5,
  lungeHitMs: 700,
  lungeBonus: 3,
}

/** Bots: how well they aim and time hits, how hard they hit, and how fast they react. */
export const BOT_LEVELS = {
  easy: { name: 'Easy', skill: [0.3, 0.5], damage: 0.6, reaction: 1.7, color: '#5ee26a' },
  normal: { name: 'Medium', skill: [0.55, 0.8], damage: 0.85, reaction: 1.1, color: '#f6b52d' },
  hard: { name: 'Hard', skill: [0.8, 0.97], damage: 1, reaction: 0.75, color: '#ff5a4a' },
}
export const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS)

/** The two sides of a duel (index 0 and 1) and Spirelands kill-feed colours. */
export const TEAMS = [
  { name: 'Blue', color: '#3fa2ff' },
  { name: 'Red', color: '#ff5a4a' },
]

// --- Armour -----------------------------------------------------------------------------

/**
 * Armour sets: protection points and durability per piece (helmet, chestplate, leggings,
 * boots), toughness, and knockback resistance. Damage taken is reduced by the points
 * (less so against big hits, more with toughness); each hit wears every piece down.
 */
export const ARMOR = {
  none: { name: 'No armour', points: [0, 0, 0, 0], dura: [0, 0, 0, 0], tough: 0, kbRes: 0, color: null },
  iron: { name: 'Iron', points: [2, 6, 5, 2], dura: [165, 240, 225, 195], tough: 0, kbRes: 0, color: '#d6dbe2' },
  diamond: { name: 'Diamond', points: [3, 8, 6, 3], dura: [363, 528, 495, 429], tough: 2, kbRes: 0, color: '#4fd8e6' },
  cindersteel: { name: 'Cindersteel', points: [3, 8, 6, 3], dura: [407, 592, 555, 481], tough: 3, kbRes: 0.25, color: '#6b4fa8' },
}
export const ARMOR_PIECES = ['Helmet', 'Chestplate', 'Leggings', 'Boots']

/** Damage left after armour: `points` still unbroken, `tough` the set's toughness. */
export function armorReduce(dmg, points, tough) {
  if (points <= 0) return dmg
  const def = Math.min(20, Math.max(points / 5, points - (4 * dmg) / (tough + 8)))
  return dmg * (1 - def / 25)
}

// --- Items ------------------------------------------------------------------------------

/**
 * Everything that can sit in the hotbar. `kind`:
 * - sword / axe / mace / spear: melee, `dmg` per hit, `cd` ms between swings that count
 *   (axe: also knocks a raised shield down; mace: smashes harder the further you fell;
 *   spear: longer reach, right click lunges forward)
 * - shield: hold right click (with a weapon or the shield in hand) to block from the front
 * - bow: shoots arrows; the stack count is its arrows (`fire`: they set where they land
 *   alight, and whoever they hit burns)
 * - bucket: right click water to fill it; a full one pours water (puts out fire - on you
 *   too - and breaks a fall into it)
 * - throw: thrown projectile (pearl teleports you, gust bursts and launches everyone near)
 * - splash: a thrown potion that heals everyone where it breaks
 * - crystal: placed on obsidian or corestone; hit it and it explodes
 * - charm: kept anywhere in your hotbar, it saves you once from a killing blow
 * - food / potion: used up with right click
 * - block: builds; `block` is the block it places
 */
export const ITEMS = {
  fist: { name: 'Fist', kind: 'none', dmg: 1, cd: 250, icon: 'fist' },
  iron_sword: { name: 'Iron Sword', kind: 'sword', dmg: 6, cd: 90, icon: 'sword', tier: 'iron', stack: 1 },
  diamond_sword: { name: 'Diamond Sword', kind: 'sword', dmg: 7, cd: 90, icon: 'sword', tier: 'diamond', stack: 1 },
  cinder_sword: { name: 'Cindersteel Sword', kind: 'sword', dmg: 8, cd: 90, icon: 'sword', tier: 'cinder', stack: 1 },
  diamond_axe: { name: 'Diamond Axe', kind: 'axe', dmg: 9, cd: 850, icon: 'axe', tier: 'diamond', stack: 1 },
  cinder_axe: { name: 'Cindersteel Axe', kind: 'axe', dmg: 10, cd: 850, icon: 'axe', tier: 'cinder', stack: 1 },
  mace: { name: 'Mace', kind: 'mace', dmg: 6, cd: 550, icon: 'mace', stack: 1 },
  spear: { name: 'Spear', kind: 'spear', dmg: 5, cd: 450, reach: 4.6, lungeCd: 1_700, icon: 'spear', stack: 1 },
  shield: { name: 'Shield', kind: 'shield', dmg: 1, cd: 250, icon: 'shield', stack: 1 },
  bow: { name: 'Bow', kind: 'bow', dmg: 6, icon: 'bow', stack: 32 },
  pearl: { name: 'Warp Pearl', kind: 'throw', proj: 'pearl', dmg: 0, icon: 'pearl', stack: 16 },
  gust: { name: 'Gust Charge', kind: 'throw', proj: 'gust', dmg: 1, icon: 'gust', stack: 32 },
  splash_heal: { name: 'Splash Healing', kind: 'splash', proj: 'splash', heal: 8, icon: 'splash', color: '#ff4f6d', stack: 16 },
  crystal: { name: 'Blast Crystal', kind: 'crystal', icon: 'crystal', stack: 64 },
  charm: { name: 'Revive Charm', kind: 'charm', icon: 'charm', stack: 1 },
  gapple: { name: 'Golden Apple', kind: 'food', heal: 2, absorb: 4, regen: 5, icon: 'gapple', stack: 64 },
  potion_speed: { name: 'Speed Potion', kind: 'potion', effect: 'speed', dur: 45, icon: 'potion', color: '#5fd3ff', stack: 4 },
  potion_strength: { name: 'Strength Potion', kind: 'potion', effect: 'strength', dur: 30, icon: 'potion', color: '#ff5050', stack: 4 },
  wool: { name: 'Wool', kind: 'block', block: B.WOOL_WHITE, icon: 'block', stack: 64 },
  planks: { name: 'Planks', kind: 'block', block: B.PLANKS, icon: 'block', stack: 64 },
  stone_bricks: { name: 'Stone Bricks', kind: 'block', block: B.STONE_BRICKS, icon: 'block', stack: 64 },
  sandstone: { name: 'Sandstone', kind: 'block', block: B.SANDSTONE, icon: 'block', stack: 64 },
  dirt: { name: 'Dirt', kind: 'block', block: B.DIRT, icon: 'block', stack: 64 },
  obsidian: { name: 'Obsidian', kind: 'block', block: B.OBSIDIAN, icon: 'block', stack: 64 },
  flame_bow: { name: 'Fire Bow', kind: 'bow', fire: true, dmg: 5, icon: 'bow', color: '#ff7a1a', stack: 32 },
  bucket: { name: 'Bucket', kind: 'bucket', icon: 'bucket', stack: 1 },
  water_bucket: { name: 'Water Bucket', kind: 'bucket', fill: 'water', icon: 'bucket', color: '#3f8cff', stack: 1 },
  // Picked from bushes in Spirelands: eat one and for a few seconds you jump ten times as high.
  jump_berry: { name: 'Jump Berry', kind: 'food', heal: 1, effect: 'leap', dur: 8, icon: 'berry', stack: 64 },
  // Light for the night (crafted from wood). `sprite`: shown as a picture, not a cube.
  torch: { name: 'Torch', kind: 'block', block: B.TORCH, icon: 'torch', sprite: true, stack: 64 },
  campfire: { name: 'Campfire', kind: 'block', block: B.CAMPFIRE, icon: 'campfire', sprite: true, stack: 16 },
  // Mined in Spirelands (iron ore, diamond ore) and made into upgrades at a crafting table.
  iron: { name: 'Iron Ingot', kind: 'material', icon: 'ingot', stack: 64 },
  diamond: { name: 'Diamond', kind: 'material', icon: 'gem', stack: 64 },
  crafting_table: { name: 'Crafting Table', kind: 'block', block: B.CRAFTING_TABLE, icon: 'block', stack: 16 },
  // Mines stone and ore `mine` times as fast (and hits like a light weapon).
  iron_pickaxe: { name: 'Iron Pickaxe', kind: 'pickaxe', dmg: 3, cd: 250, icon: 'pickaxe', tier: 'iron', mine: 3, stack: 1 },
}

/** A campfire warms whoever is within `radius`: `heal` every `everyMs`. */
export const CAMPFIRE = {
  radius: 3.5,
  heal: 1,
  everyMs: 2_000,
}

/**
 * Fire from fire arrows: a small patch where one lands (up to `cells`, within `radius`)
 * burns for `lifeMs`. Hit by one, or standing in flames, you burn for `burnMs`, losing
 * `dmg` every `tickMs` (armour doesn't help). Water - a bucket's, or jumping in - puts
 * it out.
 */
export const FIRE = {
  radius: 1.4,
  cells: 5,
  lifeMs: 6_000,
  burnMs: 4_000,
  tickMs: 1_000,
  dmg: 1,
  /** Most flames in one world at once. */
  max: 60,
  /** A poured bucket puts out flames this far away (and anyone burning nearby). */
  douse: 2.6,
}

/**
 * Flowing water: it settles a step every `stepMs` (falls first, then spreads up to 7 blocks
 * from its source), at most `perStep` blocks a step per world.
 */
export const WATER = {
  stepMs: 250,
  perStep: 300,
}

/**
 * Spirelands' loot chests: opening one gives `rolls` picks from `table` ([item, count,
 * weight]); the chest is gone until it fills again after `refillMs`.
 */
export const LOOT = {
  rolls: 3,
  refillMs: 45_000,
  table: [
    ['gapple', 2, 10],
    ['pearl', 2, 8],
    ['splash_heal', 2, 8],
    ['planks', 32, 10],
    ['stone_bricks', 16, 8],
    ['flame_bow', 8, 6],
    ['water_bucket', 1, 6],
    ['gust', 4, 6],
    ['shield', 1, 5],
    ['potion_speed', 1, 5],
    ['potion_strength', 1, 4],
    ['obsidian', 8, 3],
    ['diamond_axe', 1, 3],
    ['bucket', 1, 3],
    ['charm', 1, 2],
    ['jump_berry', 3, 8],
    ['iron', 4, 8],
    ['diamond', 1, 3],
    ['crafting_table', 1, 2],
  ],
}

/** Armour tiers, worst to best (crafting only ever upgrades). */
export const ARMOR_RANK = { none: 0, iron: 1, diamond: 2, cindersteel: 3 }
/** A crafting table within this many blocks counts as "at" one. */
export const TABLE_REACH = 4

/**
 * Breath: with your head under water you have `ms` of air (shown as `bubbles`); then you
 * drown, losing `dmg` every `tickMs`. Out of the water it comes back `refill` times as fast.
 */
export const AIR = {
  ms: 10_000,
  bubbles: 10,
  dmg: 2,
  tickMs: 1_000,
  refill: 5,
}

/**
 * Crafting (E in a fight): what you mine goes into your inventory (in a duel, the blocks
 * you placed; in Spirelands, anything), and turns into things that keep you alive.
 */
export const RECIPES = [
  { id: 'shield', out: ['shield', 1], need: [['planks', 6]], blurb: 'Block hits from the front' },
  { id: 'obsidian', out: ['obsidian', 2], need: [['stone_bricks', 4]], blurb: 'Blast-proof walls' },
  { id: 'bucket', out: ['bucket', 1], need: [['stone_bricks', 3]], blurb: 'Carry water: put out fire' },
  { id: 'flame_bow', out: ['flame_bow', 8], need: [['planks', 3], ['stone_bricks', 1]], blurb: 'Arrows that set the ground alight' },
  { id: 'gapple', out: ['gapple', 1], need: [['jump_berry', 4]], blurb: 'Heals and shields you' },
  { id: 'torch', out: ['torch', 4], need: [['planks', 2]], blurb: 'Light the night' },
  { id: 'campfire', out: ['campfire', 1], need: [['planks', 4], ['stone_bricks', 2]], blurb: 'Big light; sit by it to heal' },
  { id: 'crafting_table', out: ['crafting_table', 1], need: [['planks', 4]], blurb: 'Upgrades and new weapons are made at one' },
  // At a crafting table (`table`): mined iron and diamonds into better gear.
  { id: 'iron_pickaxe', table: true, out: ['iron_pickaxe', 1], need: [['iron', 3], ['planks', 2]], blurb: 'Mines stone and ore 3x faster' },
  { id: 'diamond_sword', table: true, out: ['diamond_sword', 1], need: [['diamond', 2], ['planks', 1]], blurb: 'A diamond blade' },
  { id: 'diamond_axe', table: true, out: ['diamond_axe', 1], need: [['diamond', 3], ['planks', 2]], blurb: 'Knocks shields down' },
  { id: 'cinder_sword', table: true, out: ['cinder_sword', 1], need: [['diamond_sword', 1], ['diamond', 2], ['obsidian', 2]], blurb: 'Upgrade: diamond sword to Cindersteel' },
  { id: 'cinder_axe', table: true, out: ['cinder_axe', 1], need: [['diamond_axe', 1], ['diamond', 2], ['obsidian', 2]], blurb: 'Upgrade: diamond axe to Cindersteel' },
  { id: 'mace', table: true, out: ['mace', 1], need: [['iron', 4], ['diamond', 1]], blurb: 'Smashes harder the further you fall' },
  { id: 'spear', table: true, out: ['spear', 1], need: [['planks', 3], ['iron', 2]], blurb: 'Long reach; right click lunges' },
  { id: 'bow', table: true, out: ['bow', 16], need: [['planks', 3], ['iron', 1]], blurb: 'A bow and 16 arrows' },
  // Armour: a whole set at once (only up), or mended back to full.
  { id: 'armor_iron', table: true, armor: 'iron', name: 'Iron Armour', need: [['iron', 10]], blurb: 'A full set of iron armour' },
  { id: 'armor_diamond', table: true, armor: 'diamond', name: 'Diamond Armour', need: [['diamond', 10]], blurb: 'A full set of diamond armour' },
  { id: 'armor_cinder', table: true, armor: 'cindersteel', name: 'Cindersteel Armour', need: [['diamond', 6], ['obsidian', 6]], blurb: 'Upgrade: the toughest armour' },
  { id: 'armor_repair', table: true, repair: true, name: 'Repair Armour', need: [['iron', 3]], blurb: 'Your armour back to full' },
]

/** Melee weapons (what a hit counts as, and what bots pick to fight with). */
export const MELEE_KINDS = new Set(['sword', 'axe', 'mace', 'spear', 'none', 'shield', 'pickaxe'])

/** What everyone holds in the lobby (shown with their sword skin; it does no damage). */
export const LOBBY_SWORD = 'diamond_sword'

/** The hotbar has this many slots. */
export const HOTBAR = 9
/**
 * The whole inventory, one array: slots 0-8 the hotbar, 9-35 the bag (27), 36 the
 * offhand (the left hand: a shield there blocks while your sword stays in the right).
 */
export const BAG = 27
export const OFFHAND = HOTBAR + BAG
export const INV_SIZE = OFFHAND + 1
/** How far you reach to break and place (blocks). */
export const REACH = 5
export const MELEE_REACH = COMBAT.reach
/** Fastest the client sends swings (ms); the real limit is each weapon's `cd`. */
export const ATTACK_COOLDOWN_MS = 90
/** Seconds to break a block by hand (no tools in STRAFEX). */
export const breakSeconds = (hard, mine = 1) => hard / mine

/** How much faster the item `id` mines a block this hard (a pickaxe on stone and ore). */
export const mineSpeed = (id, hard) => (ITEMS[id]?.mine && hard >= 1 ? ITEMS[id].mine : 1)

/** Potion effects: what they multiply. */
export const EFFECTS = {
  speed: { speedMul: 1.3 },
  jump: { jumpMul: 1.3 },
  /** Jump berries: about ten times as high (3.2x the speed), and no fall damage meanwhile. */
  leap: { jumpMul: 3.2 },
  strength: { dmgAdd: 3 },
  regen: {},
  burn: {},
}

/** Projectiles: launch speed (blocks/s), gravity, lifetime and size. */
export const PROJECTILES = {
  arrow: { speed: 36, gravity: 18, life: 3, size: 0.25 },
  pearl: { speed: 26, gravity: 16, life: 3, size: 0.3 },
  gust: { speed: 24, gravity: 6, life: 1.6, size: 0.35 },
  splash: { speed: 18, gravity: 20, life: 2.5, size: 0.3 },
}

/** A gust charge's burst: radius, push, and the launch for whoever threw it. */
export const GUST = { radius: 2.8, push: 11, lift: 9, selfLift: 15.5 }
/** A splash potion's reach (full effect at the middle, half at the edge). */
export const SPLASH = { radius: 3.6 }
/** A blast crystal's explosion. */
export const CRYSTAL = { radius: 4.6, damage: 17, knock: 13 }

// --- Kits (the modes) ---------------------------------------------------------------------

/**
 * Every mode is a kit: what you start with, your armour, whether you heal on your own,
 * and how many rounds win a duel (`ft`, first to). The same kits are picked in
 * Spirelands. `hotbar` is slot by slot: `[itemId, count]` or null; `offhand` what starts
 * in your left hand; `bag` the refills in the rest of the inventory (E to open it).
 */
export const MODES = {
  strafex: {
    name: 'STRAFEX',
    blurb: 'UHC + Mace + Gust Charges + Utility',
    color: '#ffb21a',
    armor: 'diamond',
    regen: false,
    ft: 2,
    hotbar: [['diamond_sword', 1], ['mace', 1], ['gust', 8], ['bow', 12], ['gapple', 6], ['wool', 64], ['planks', 64], ['pearl', 2], ['water_bucket', 1]],
    offhand: ['charm', 1],
    bag: [['gust', 8], ['gapple', 4], ['wool', 64], ['pearl', 2]],
  },
  sword: {
    name: 'SWORD',
    blurb: 'Pure sword combat and combos',
    color: '#45dbe6',
    armor: 'diamond',
    regen: true,
    ft: 3,
    hotbar: [['diamond_sword', 1]],
    bag: [],
  },
  axe: {
    name: 'AXE',
    blurb: 'Axe + Shield timing battles',
    color: '#9fe6ff',
    armor: 'diamond',
    regen: true,
    ft: 2,
    hotbar: [['diamond_axe', 1], ['diamond_sword', 1], ['bow', 12], ['gapple', 4]],
    offhand: ['shield', 1],
    bag: [['gapple', 2]],
  },
  crystal: {
    name: 'CRYSTAL',
    blurb: 'Blast Crystals + Obsidian + Explosions',
    color: '#d05cff',
    armor: 'cindersteel',
    regen: true,
    ft: 2,
    hotbar: [['cinder_sword', 1], ['crystal', 64], ['obsidian', 64], ['gapple', 16], ['pearl', 8], ['shield', 1], ['splash_heal', 4]],
    offhand: ['charm', 1],
    bag: [['crystal', 64], ['obsidian', 64], ['charm', 1], ['charm', 1], ['gapple', 16], ['splash_heal', 4]],
  },
  uhc: {
    name: 'UHC',
    blurb: 'Classic UHC - no natural regen',
    color: '#ffd23b',
    armor: 'diamond',
    regen: false,
    ft: 2,
    hotbar: [['diamond_sword', 1], ['diamond_axe', 1], ['bow', 16], ['gapple', 6], ['planks', 64], ['stone_bricks', 64], ['water_bucket', 1], ['flame_bow', 8]],
    offhand: ['shield', 1],
    bag: [['planks', 64], ['gapple', 2]],
  },
  mace: {
    name: 'MACE',
    blurb: 'Mace + Gust Charges',
    color: '#b8c2d6',
    armor: 'diamond',
    regen: true,
    ft: 2,
    hotbar: [['mace', 1], ['diamond_sword', 1], ['gust', 16], ['gapple', 6], ['pearl', 4]],
    offhand: ['shield', 1],
    bag: [['gust', 16], ['gapple', 4]],
  },
  spear: {
    name: 'SPEAR MACE',
    blurb: 'Spear Lunge + Mace',
    color: '#5ee26a',
    armor: 'diamond',
    regen: true,
    ft: 2,
    hotbar: [['spear', 1], ['mace', 1], ['gust', 8], ['gapple', 6], ['diamond_sword', 1]],
    bag: [['gust', 8], ['gapple', 2]],
  },
  pot: {
    name: 'POT',
    blurb: 'Diamond + healing potions',
    color: '#ff4f6d',
    armor: 'diamond',
    regen: false,
    ft: 2,
    hotbar: [['diamond_sword', 1], ['splash_heal', 16], ['potion_speed', 2], ['potion_strength', 1], ['pearl', 4], ['splash_heal', 8]],
    bag: [['splash_heal', 16], ['splash_heal', 16], ['potion_speed', 2], ['potion_strength', 2]],
  },
  smp: {
    name: 'SMP',
    blurb: 'Cindersteel, pearls, charms, potions',
    color: '#8a6bd8',
    armor: 'cindersteel',
    regen: true,
    ft: 1,
    hotbar: [['cinder_sword', 1], ['cinder_axe', 1], ['pearl', 8], ['gapple', 12], ['splash_heal', 6], ['potion_speed', 2], ['charm', 1], ['flame_bow', 8], ['water_bucket', 1]],
    offhand: ['shield', 1],
    bag: [['pearl', 8], ['gapple', 8], ['splash_heal', 6], ['charm', 1]],
  },
}
export const MODE_IDS = Object.keys(MODES)

/** A fresh inventory from a kit: hotbar, bag and offhand (each stack its own object). */
export function kitHotbar(modeId) {
  const kit = MODES[modeId] || MODES.sword
  const inv = new Array(INV_SIZE).fill(null)
  kit.hotbar.forEach((slot, i) => {
    if (slot && i < HOTBAR) inv[i] = { id: slot[0], n: slot[1] }
  })
  ;(kit.bag || []).forEach((slot, i) => {
    if (slot && i < BAG) inv[HOTBAR + i] = { id: slot[0], n: slot[1] }
  })
  if (kit.offhand) inv[OFFHAND] = { id: kit.offhand[0], n: kit.offhand[1] }
  return inv
}

/** Fresh armour for a kit: `{ tier, dura: [...] }`. */
export function kitArmor(modeId) {
  const tier = (MODES[modeId] || MODES.sword).armor || 'none'
  return { tier, dura: [...ARMOR[tier].dura] }
}

// --- Rewards ----------------------------------------------------------------------------

/** Cash: for a duel played / won, and per kill (kills in Spirelands pay as they happen). */
export const REWARDS = {
  play: 20,
  win: 100,
  kill: 25,
  /** Killing someone on a streak of `BOUNTY_STREAK` or more in Spirelands. */
  bounty: 75,
  /** Reaching the top of the lobby's parkour, once a day. */
  parkour: 150,
}
/** Kills in one Spirelands life that put a bounty on your head. */
export const BOUNTY_STREAK = 3

// --- Progression: XP, levels, daily quests ----------------------------------------------

/** XP for a duel or a Spirelands life. */
export const XP = { play: 20, win: 60, kill: 15, perHits: 1, maxHits: 30 }
/** XP from `level` to the next one: 120, 160, 200, ... */
export const levelXp = (level) => 80 + level * 40
/** Cash on reaching a level; every fifth level also gives a free case. */
export const levelCash = (level) => 50 + level * 10
export const LEVEL_CASE_EVERY = 5

/** Three of these each day. `stat` is what a duel or a life adds to (see logic.questStats). */
export const QUESTS = {
  win1: { name: 'Win a duel', stat: 'wins', goal: 1, cash: 150, xp: 60 },
  win4: { name: 'Win 4 duels', stat: 'wins', goal: 4, cash: 350, xp: 140 },
  duels3: { name: 'Play 3 duels', stat: 'duels', goal: 3, cash: 100, xp: 40 },
  duels8: { name: 'Play 8 duels', stat: 'duels', goal: 8, cash: 250, xp: 100 },
  kills5: { name: 'Get 5 kills', stat: 'kills', goal: 5, cash: 150, xp: 60 },
  kills15: { name: 'Get 15 kills', stat: 'kills', goal: 15, cash: 320, xp: 130 },
  ffa5: { name: 'Get 5 kills in Spirelands', stat: 'ffaKills', goal: 5, cash: 180, xp: 70 },
  hits150: { name: 'Land 150 hits', stat: 'hits', goal: 150, cash: 140, xp: 55 },
  combo8: { name: 'Hit an 8-hit combo', stat: 'combo8', goal: 1, cash: 160, xp: 60 },
}
export const QUEST_IDS = Object.keys(QUESTS)
export const QUESTS_PER_DAY = 3

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
 * Kill effects: the burst where your victim stood, in your colours and style (`pattern`,
 * see client/src/game/art/killfx.js). They live in the save's old cape slots (`capes`,
 * `cape`, the 'cape' case and Gems skus), so everything players already own carries
 * over. `none` is everyone's from the start.
 */
export const CAPES = {
  none: { name: 'No Kill Effect', rarity: 'common', pattern: 'none', owned: true },
  crimson: { name: 'Crimson Burst', rarity: 'common', pattern: 'solid', colors: ['#ff3b3b', '#9a1414'] },
  ocean: { name: 'Ocean Burst', rarity: 'common', pattern: 'solid', colors: ['#3fa2ff', '#134a80'] },
  leaf: { name: 'Leaf Burst', rarity: 'common', pattern: 'solid', colors: ['#5ee26a', '#1f6b1d'] },
  checker: { name: 'Checker Pop', rarity: 'uncommon', pattern: 'checker', colors: ['#f2f2f2', '#262626'] },
  pixel: { name: 'Pixel Party', rarity: 'uncommon', pattern: 'pixels', colors: ['#ff5d5d', '#5db8ff', '#ffe15d', '#6bff6b'] },
  ghost: { name: 'Ghost Puff', rarity: 'uncommon', pattern: 'ghost', colors: ['#e6e9f0', '#8b8f99'] },
  lucky: { name: 'Lucky Sparks', rarity: 'rare', pattern: 'lucky', colors: ['#ffc928', '#ffffff'] },
  mega: { name: 'Mega Sparks', rarity: 'rare', pattern: 'lucky', colors: ['#b45cff', '#ffffff'] },
  smile: { name: 'Smiley Pop', rarity: 'rare', pattern: 'face', colors: ['#3bd25a', '#ffe14d'] },
  flame: { name: 'Flame Burst', rarity: 'epic', pattern: 'flame', colors: ['#ffe14d', '#ff7a1a', '#c21d0e'] },
  galaxy: { name: 'Galaxy Swirl', rarity: 'epic', pattern: 'stars', colors: ['#5a3cc8', '#ffffff', '#b98cff'] },
  moon: { name: 'Blood Moon', rarity: 'legendary', pattern: 'moon', colors: ['#2a0b12', '#ff3b3b'] },
  rainbow: { name: 'Rainbow Ring', rarity: 'legendary', pattern: 'rainbow', colors: [] },
  void: { name: 'Void Implosion', rarity: 'mythic', pattern: 'void', colors: ['#1a0026', '#d14dff', '#5b1aa6'] },
  // Gem exclusives: never in a cash case.
  phoenix: { name: 'Phoenix Fire', rarity: 'legendary', pattern: 'flame', colors: ['#e6fbff', '#4fc3ff', '#1a4fd1'], gemOnly: true },
  royal: { name: 'Royal Crown', rarity: 'legendary', pattern: 'moon', colors: ['#1a0f2e', '#ffd23b'], gemOnly: true },
  aurora: { name: 'Aurora Wave', rarity: 'mythic', pattern: 'stars', colors: ['#0a4a4a', '#7affd1', '#3fd2ff'], gemOnly: true },
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
  cape: { name: 'Kill FX Case', price: 400, kind: 'cape', color: '#ffb52e' },
  sword: { name: 'Sword Case', price: 600, kind: 'sword', color: '#3fa2ff' },
  // Bought with Gems (GEM_PRODUCTS): Epic or better, guaranteed.
  mythic_cape: { name: 'Mythic Kill FX Case', price: 0, kind: 'cape', color: '#ff4f6d', gems: true, minRarity: 'epic' },
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
  cape_aurora: { group: 'exclusive', name: 'Aurora Wave', blurb: 'Mythic kill effect. Only with Gems.', icon: 'star', grant: { cape: 'aurora' } },
  cape_phoenix: { group: 'exclusive', name: 'Phoenix Fire', blurb: 'Legendary blue-fire kill effect. Only with Gems.', icon: 'star', grant: { cape: 'phoenix' } },
  cape_royal: { group: 'exclusive', name: 'Royal Crown', blurb: 'Legendary kill effect. Only with Gems.', icon: 'star', grant: { cape: 'royal' } },
  sword_celestial: { group: 'exclusive', name: 'Celestial Sword', blurb: 'Mythic skin for every sword. Only with Gems.', icon: 'sword', grant: { sword: 'celestial' } },
  sword_dragon: { group: 'exclusive', name: 'Dragonfang Sword', blurb: 'Legendary skin. Only with Gems.', icon: 'sword', grant: { sword: 'dragon' } },
  sword_obsidian: { group: 'exclusive', name: 'Magma Obsidian Sword', blurb: 'Legendary skin. Only with Gems.', icon: 'sword', grant: { sword: 'obsidian' } },
  // Cases and boosts.
  mythic_cape_case: { group: 'cases', name: 'Mythic Kill FX Case', blurb: 'Epic, Legendary or Mythic kill effect - guaranteed', icon: 'case', grant: { case: 'mythic_cape' } },
  mythic_sword_case: { group: 'cases', name: 'Mythic Sword Case', blurb: 'Epic, Legendary or Mythic sword skin - guaranteed', icon: 'case', grant: { case: 'mythic_sword' } },
  vip: { group: 'boosts', name: 'VIP', blurb: 'x2 cash from every duel and a crown on your name, forever', icon: 'crown', grant: { pass: 'vip' } },
  xp_pass: { group: 'boosts', name: 'XP Pass', blurb: '+50% XP from every duel, forever', icon: 'star', grant: { pass: 'xp' } },
  xp_boost: { group: 'boosts', name: 'XP Boost', blurb: 'Double XP for 1 hour', icon: 'star', grant: { xpBoostMs: 60 * 60 * 1000 } },
  quest_refresh: { group: 'boosts', name: 'New Quests', blurb: "Swap today's quests for three new ones", icon: 'star', grant: { questRefresh: true } },
  starter: { group: 'cash', name: 'Starter Pack', blurb: 'Flame Burst kill effect + Inferno sword skin + 1,000 cash', icon: 'gift', grant: { cash: 1000, cape: 'flame', sword: 'inferno' } },
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
export const QUICK_CHAT = ['GG!', 'Nice one!', 'Rematch?', 'Good fight!', 'Close one!', 'Oops!', "Let's go!", '😂', '🔥', '👋']
/** At most one quick chat line per this many ms. */
export const QUICK_CHAT_MS = 1500

/** Names for bots (duel opponents when nobody else is queued, and Spirelands regulars). */
export const BOT_NAMES = [
  'VektorVibe', 'PixelPia', 'StrafeLuca', 'ComboCam', 'SkySam', 'NoobNoah', 'BlockMia', 'ClutchTom',
  'BridgeBob', 'DiamondDee', 'CubeKai', 'MaceLeo', 'ZippyZoe', 'StackSteve', 'AppleAva', 'PearlPip',
]
