/** Little pixel armour pieces, tinted per tier (cached data URLs). */
const iconCache = new Map()
const SHAPES = [
  ['xxxxxx', 'x....x', 'x....x'],
  ['xx..xx', 'xxxxxx', '.xxxx.', '.xxxx.', '.xxxx.'],
  ['xxxxxx', 'xx..xx', 'xx..xx', 'xx..xx'],
  ['xx..xx', 'xx..xx', 'xx..xx'],
]
export function armorIcon(piece, color) {
  const key = `${piece}:${color}`
  if (iconCache.has(key)) return iconCache.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  const rows = SHAPES[piece]
  const oy = Math.floor((8 - rows.length) / 2)
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'x') return
      ctx.fillStyle = '#120c1e'
      ctx.fillRect(x, y + oy, 3, 2)
    }),
  )
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'x') return
      ctx.fillStyle = y === 0 ? '#ffffff' : color
      ctx.fillRect(x + 1, y + oy, 1, 1)
    }),
  )
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}
