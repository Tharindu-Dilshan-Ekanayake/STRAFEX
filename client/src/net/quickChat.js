import { QUICK_CHAT } from '@shared/balance'

/** Quick chat bubbles by eid: `{ text, until }`. Read by the nameplates every frame. */
const bubbles = new Map()
const SHOW_MS = 3500

export function showQuickChat(eid, i) {
  const text = QUICK_CHAT[i]
  if (text) bubbles.set(eid, { text, until: performance.now() + SHOW_MS })
  return text
}

export function quickBubble(eid, now = performance.now()) {
  const b = bubbles.get(eid)
  if (!b) return null
  if (b.until <= now) {
    bubbles.delete(eid)
    return null
  }
  return b.text
}
