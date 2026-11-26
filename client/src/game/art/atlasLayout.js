/**
 * Where each block tile sits in the terrain atlas (atlas.js paints it). Kept free of
 * three.js and the DOM so the mesh worker can use it too.
 *
 * 16x16 tiles in 20x20 cells (a 2-pixel gutter copying each tile's edge), 8 to a row.
 */

export const T = 16
export const PAD = 2
export const CELL = T + PAD * 2
export const GRID = 8
export const SIZE = CELL * GRID

/** Tile order in the atlas; atlas.js has a painter for each. */
export const TILE_ORDER = [
  'dirt', 'grass_top', 'grass_side', 'stone', 'ore', 'stone_bricks', 'brick', 'planks', 'log_side', 'log_top',
  'leaves', 'sand', 'sandstone', 'sandstone_top', 'snow', 'snow_side', 'ice', 'wool_white', 'wool_red', 'wool_blue',
  'wool_yellow', 'candy_pink', 'candy_stripe', 'frosting_top', 'frosting_side', 'glass', 'cage', 'lucky', 'lucky_rare', 'gold',
  'darkstone', 'tnt_side', 'tnt_top', 'lamp', 'cactus_side', 'cactus_top', 'path_top', 'flower_red', 'flower_yellow', 'tall_grass',
  'water', 'quartz', 'quartz_top', 'obsidian', 'crystal', 'corestone', 'clay_orange', 'clay_red', 'mossy_bricks', 'slate',
  'pad_top', 'pad_side', 'azure', 'finish_top', 'hay_top', 'hay_side', 'mushroom', 'lantern', 'lantern_top',
]
const tileIndex = new Map(TILE_ORDER.map((name, i) => [name, i]))

/** UV rectangle of a tile: [u0, v0, u1, v1] (v up, as three.js expects). */
export function tileUV(name) {
  const i = tileIndex.get(name) ?? 0
  const u0 = ((i % GRID) * CELL + PAD) / SIZE
  const v1 = 1 - (Math.floor(i / GRID) * CELL + PAD) / SIZE
  return [u0, v1 - T / SIZE, u0 + T / SIZE, v1]
}

/** Pixel rectangle of a tile in the atlas canvas: [x, y, size]. */
export function tileRect(name) {
  const i = tileIndex.get(name) ?? 0
  return [(i % GRID) * CELL + PAD, Math.floor(i / GRID) * CELL + PAD, T]
}
