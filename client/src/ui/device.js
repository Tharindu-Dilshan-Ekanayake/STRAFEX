/**
 * A touch screen (phone, tablet, touch laptop, a portal's mobile preview): touch
 * controls are shown, and mouse-only hints are not. One check for both, so they agree.
 */
export function isTouchDevice() {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0)
}
