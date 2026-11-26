/**
 * Player intents. The UI and the controller never change game state themselves: they
 * send one of these, the authority (the Colyseus room, or the offline host in this
 * tab) checks it, and the result comes back as events.
 */

let transport = null

/** Installs the active connection: `{ send(type, payload) }`. */
export function setTransport(next) {
  transport = next
}

export function send(type, payload) {
  if (!transport) return
  transport.send(type, payload)
}

export const actions = {
  openCase: (caseId) => send('openCase', { caseId }),
  equip: (kind, id) => send('equip', { kind, id }),
  claimDaily: () => send('claimDaily'),
  welcomeGift: () => send('welcomeGift'),
  tutorialDone: () => send('tutorialDone'),
  quickChat: (i) => send('qc', { i }),
  /** Into the queue for a duel mode (a bot steps in if nobody else is waiting). */
  queue: (mode) => send('queue', { mode }),
  unqueue: () => send('unqueue'),
  voteMap: (map) => send('voteMap', { map }),
  /** After a duel: straight back into the same queue. */
  requeue: () => send('requeue'),
  /** Into Spirelands, then pick a kit to spawn with. */
  ffa: () => send('ffa'),
  kit: (mode) => send('kit', { mode }),
  toLobby: () => send('lobby'),
  /** Swap two inventory slots (0-8 hotbar, 9-35 bag, 36 offhand). */
  swap: (a, b) => send('swap', { a, b }),
  /** The held item and the offhand trade places. */
  swapHands: () => send('swapHands'),
  select: (slot) => send('sel', { slot }),
  /** A rewarded ad Boxity says was watched; the server verifies the token. */
  adReward: (placement, rewardToken) => send('adReward', { placement, rewardToken }),
  /** Asks the server to apply any Gems purchases Boxity has confirmed. */
  gemsCheck: () => send('gemsCheck'),
}
