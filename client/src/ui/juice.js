/**
 * Hit feedback, drawn straight into the DOM (no React work per hit): the X over the
 * crosshair when your hit lands, and the damage number that floats up from it.
 */

const MAX_NUMBERS = 8
let live = 0

export function showHit(dmg = 0) {
  const marker = document.getElementById('hitmarker')
  if (marker) {
    marker.classList.remove('on')
    // Restart the animation.
    void marker.offsetWidth
    marker.classList.add('on')
  }
  const layer = document.getElementById('dmg-layer')
  if (!layer || !dmg || live >= MAX_NUMBERS) return
  const el = document.createElement('div')
  el.className = 'dmg-num fancy'
  const text = `-${dmg}`
  el.textContent = text
  el.dataset.text = text
  const big = dmg >= 6
  el.style.setProperty('--fs', `calc(var(--u) * ${big ? 30 : 24})`)
  el.style.setProperty('--f1', big ? '#fff3b0' : '#ffffff')
  el.style.setProperty('--f2', big ? '#ff7a1a' : '#ffd23b')
  el.style.left = `calc(50% + ${Math.round((Math.random() - 0.5) * 70)}px)`
  el.style.top = `calc(50% - ${30 + Math.round(Math.random() * 20)}px)`
  layer.appendChild(el)
  live += 1
  setTimeout(() => {
    el.remove()
    live -= 1
  }, 800)
}
