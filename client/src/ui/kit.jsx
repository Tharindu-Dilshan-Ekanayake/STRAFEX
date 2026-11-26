import { useState } from 'react'

import { heartUrl, u } from './format'

/** A blocky button. `color` is its face colour. */
export function Button({ color = '#4a8f2c', className = '', style, children, ...props }) {
  return (
    <button type="button" className={`mc-btn txt-o ${className}`} style={{ '--c': color, ...style }} {...props}>
      {children}
    </button>
  )
}

/** Health as hearts (half-hearts per point), with golden absorption hearts after them. */
export function Hearts({ hp, maxHp, absorb = 0, size = 22 }) {
  // Remember the last health to tell a hit from a heal (React's "previous render" pattern).
  const [last, setLast] = useState(hp)
  const [change, setChange] = useState({ kind: '', n: 0 })
  if (hp !== last) {
    setLast(hp)
    setChange((c) => ({ kind: hp < last ? 'hearts-hurt' : 'hearts-heal', n: c.n + 1 }))
  }
  const count = Math.ceil(maxHp / 2)
  const low = hp > 0 && hp <= 6
  const hearts = []
  for (let i = 0; i < count; i += 1) {
    const v = hp - i * 2
    hearts.push(v >= 1.75 ? 'full' : v >= 0.75 ? 'half' : 'empty')
  }
  for (let i = 0; i < Math.ceil(absorb / 2 - 0.1); i += 1) {
    const v = absorb - i * 2
    hearts.push(v >= 1.75 ? 'gold' : 'goldHalf')
  }
  return (
    <div key={change.n} className={`flex flex-wrap ${change.kind}`} style={{ width: u(size * 10 + 14), gap: u(1) }}>
      {hearts.map((kind, i) => (
        <img
          key={i}
          src={heartUrl(kind)}
          alt=""
          className={`pixelated ${low && (kind === 'full' || kind === 'half') ? 'heart-low' : ''}`}
          style={{ width: u(size), height: u(size * 0.9), animationDelay: `${(i * 70) % 420}ms` }}
          draggable={false}
        />
      ))}
    </div>
  )
}

/**
 * Title text: gradient fill, thick outline, drop shadow (see .fancy in index.css).
 * `children` must be a plain string.
 */
export function Fancy({ children, size = 30, from = '#ffffff', to = '#ffd23b', stroke = '#1a0f2e', className = '', style }) {
  const text = String(children)
  return (
    <span className={`fancy ${className}`} data-text={text} style={{ '--fs': `calc(var(--u) * ${size})`, '--f1': from, '--f2': to, '--st': stroke, ...style }}>
      {text}
    </span>
  )
}
