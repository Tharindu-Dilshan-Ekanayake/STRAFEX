/**
 * Starts with touch controls: a phone or tablet, where a finger is the main way in (the
 * primary pointer is coarse), or an iPad that reports itself as a Mac. A laptop with a
 * touch screen is NOT one: its main pointer is the mouse or trackpad (pointer: fine), so
 * it starts with mouse controls; TouchControls switches over the moment the screen is
 * actually touched, and back once the mouse or keyboard is used again. Touch controls and
 * mouse-only hints read this one check, so they agree.
 */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(pointer: coarse)').matches) return true
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)
}
