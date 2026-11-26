/**
 * Pixel-art icons for the Minecraft-style UI: 16x16 pictures written as rows of letters
 * (one letter per pixel, '.' empty), drawn as crisp SVG at any size. No image files.
 */

const COLORS = {
  k: '#1b1430', // outline
  b: '#3f6fd8', // blue
  y: '#ffd23b', // gold
  w: '#dfe4ec', // light stone
  s: '#9aa3b2', // stone
  g: '#5cb83c', // grass
  d: '#7a5530', // dirt
  a: '#3f8cff', // water
  W: '#ffffff', // white
  G: '#d9dde5', // iron
  D: '#8a93a3', // iron shade
  e: '#36d27a', // emerald
  E: '#1f9c55', // emerald shade
  c: '#a8703a', // wood
  C: '#6b4420', // wood shade
  r: '#e8463a', // red
  B: '#5fb8ff', // light blue
  t: '#f4e6c0', // paper
  T: '#cdb98a', // paper shade
  Y: '#c28a12', // gold shade
  q: '#bfe6ff', // bubble
  Q: '#4f9bff', // bubble shade
}

const PIXEL_ICONS = {
  /** Air: one breath bubble. */
  bubble: [
    '................',
    '.....kkkkkk.....',
    '....kqqqqqqk....',
    '...kqWWqqqqQk...',
    '..kqWWqqqqqqQk..',
    '..kqWqqqqqqqQk..',
    '..kqqqqqqqqqQk..',
    '..kqqqqqqqqqQk..',
    '..kqqqqqqqqQQk..',
    '..kQqqqqqqQQQk..',
    '...kQQqqqQQQk...',
    '....kQQQQQQk....',
    '.....kkkkkk.....',
  ],
  /** Shop: an emerald. */
  shop: [
    '................',
    '................',
    '......kkkk......',
    '.....keeeek.....',
    '....keWeeeEk....',
    '...keWeeeeeEk...',
    '..keeeeeeeeeEk..',
    '..keeeeeeeeeEk..',
    '..kEeeeeeeeEEk..',
    '...kEeeeeeEEk...',
    '....kEeeeEEk....',
    '.....kEEEEk.....',
    '......kkkk......',
  ],
  /** Cases: a chest with a gold lock. */
  chest: [
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kcccccccccccCk.',
    '.kcccccccccccCk.',
    '.kCCCCCCCCCCCCk.',
    '.kkkkkkyykkkkkk.',
    '.kccccckYkcccCk.',
    '.kcccccccccccCk.',
    '.kcccccccccccCk.',
    '.kcccccccccccCk.',
    '.kCCCCCCCCCCCCk.',
    '.kkkkkkkkkkkkkk.',
  ],
  /** Backpack. */
  backpack: [
    '................',
    '.....kkkkkk.....',
    '....kk....kk....',
    '..kkkkkkkkkkkk..',
    '..kcccccccccCk..',
    '..kCCCCCCCCCCk..',
    '..kccccyycccCk..',
    '..kcccccccccCk..',
    '..kcccccccccCk..',
    '..kckkkkkkkcCk..',
    '..kckcccccckCk..',
    '..kckkkkkkkkCk..',
    '..kcccccccccCk..',
    '..kkkkkkkkkkkk..',
  ],
  /** Daily: a present with a red ribbon. */
  gift: [
    '................',
    '....kk....kk....',
    '...krrk..krrk...',
    '....krrkkrrk....',
    '.kkkkkkkkkkkkkk.',
    '.kBBBBBrrBBBBBk.',
    '.kBBBBBrrBBBBBk.',
    '.kkkkkkkkkkkkkk.',
    '..kBBBBrrBBBBk..',
    '..kBBBBrrBBBBk..',
    '..kBBBBrrBBBBk..',
    '..kBBBBrrBBBBk..',
    '..kkkkkkkkkkkk..',
  ],
  /** Quests: a scroll with writing. */
  scroll: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kTttttttttttTk.',
    '..kttttttttttk..',
    '..ktkkkkkkkttk..',
    '..kttttttttttk..',
    '..ktkkkkkktttk..',
    '..kttttttttttk..',
    '..ktkkkkkkkttk..',
    '..kttttttttttk..',
    '..ktkkkkkttttk..',
    '..kttttttttttk..',
    '.kTttttttttttTk.',
    '..kkkkkkkkkkkk..',
  ],
  /** Leaderboards: a gold cup. */
  trophy: [
    '................',
    '...kkkkkkkkkk...',
    '.kkkyyyyyyyykkk.',
    'kyykyWyyyyyYkyyk',
    'ky.kyWyyyyyYk.yk',
    'kyykyyyyyyyYkyyk',
    '.kkkyyyyyyyYkkk.',
    '....kyyyyyYk....',
    '.....kyyyYk.....',
    '......kyYk......',
    '......kyYk......',
    '....kkkkkkkk....',
    '....kYYYYYYk....',
    '....kkkkkkkk....',
  ],
  /** Spirelands: a spire with a blue roof and a gold flag, on an island in the sea. */
  spire: [
    '........yy......',
    '........yyy.....',
    '........k.......',
    '.......kbk......',
    '......kbbbk.....',
    '.....kbbbbbk....',
    '....kkkkkkkkk...',
    '.....kwwswwk....',
    '.....kwkkwsk....',
    '.....kswwwwk....',
    '..kkkkwwkkwkkk..',
    '.kgggggggggggggk',
    '.kdgddddddgdddk.',
    'aakdddddddddkaaa',
    'aaakkdddddkkaaaa',
    'aaaaakkkkkaaaaaa',
  ],
  /** Quick chat: a speech bubble with three dots. */
  chat: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kWWWWWWWWWWWWk.',
    '.kWWWWWWWWWWWWk.',
    '.kWWWWWWWWWWWWk.',
    '.kWWkkWWkkWWkkk.',
    '.kWWkkWWkkWWkkk.',
    '.kWWWWWWWWWWWWk.',
    '.kWWWWWWWWWWWWk.',
    '..kkkWWkkkkkkk..',
    '....kWWk........',
    '....kWk.........',
    '....kk..........',
    '................',
    '................',
    '................',
  ],
  /** Settings: an iron gear. */
  gear: [
    '................',
    '......kkkk......',
    '...kk.kGGk.kk...',
    '..kGGkkGGkkGGk..',
    '..kGGGGGGGGGGk..',
    '...kGGGDDGGGk...',
    '.kkkGGDkkDGGkkk.',
    '.kGGGGDk.kDGGGk.',
    '.kGGGGDk.kDGGGk.',
    '.kkkGGDkkDGGkkk.',
    '...kGGGDDGGGk...',
    '..kGGGGGGGGGGk..',
    '..kGGkkGGkkGGk..',
    '...kk.kGGk.kk...',
    '......kkkk......',
    '................',
  ],
}

/** A pixel icon by name (or raw rows), `size` as any CSS length. */
export default function PixelIcon({ name, rows = PIXEL_ICONS[name], size, className = 'play-icon' }) {
  const rects = []
  rows.forEach((line, y) => {
    const row = line.padEnd(16, '.').slice(0, 16)
    for (let x = 0; x < row.length; x += 1) {
      const c = COLORS[row[x]]
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={c} />)
    }
  })
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  )
}
