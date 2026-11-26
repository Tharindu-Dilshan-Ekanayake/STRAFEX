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
  vote: (mode) => send('vote', { mode }),
  quickChat: (i) => send('qc', { i }),
  voteMap: (map) => send('voteMap', { map }),
  voteBots: (level) => send('voteBots', { level }),
  afk: (on) => send('afk', { on }),
  spectate: () => send('spectate'),
  joinRound: () => send('joinRound'),
  toLobby: () => send('lobby'),
  select: (slot) => send('sel', { slot }),
  /** A rewarded ad Boxity says was watched; the server verifies the token. */
  adReward: (placement, rewardToken) => send('adReward', { placement, rewardToken }),
  /** Asks the server to apply any Gems purchases Boxity has confirmed. */
  gemsCheck: () => send('gemsCheck'),
}
