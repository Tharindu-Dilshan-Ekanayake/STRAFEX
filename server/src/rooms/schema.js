import { schema, t } from '@colyseus/schema'

/**
 * Synced state, kept deliberately small: who is in the room, for the platform's
 * presence (friends joining, player counts). The game itself - positions, rounds,
 * blocks - travels as GameHost messages, the same ones the offline game uses.
 */
export const PlayerState = schema(
  {
    name: t.string(),
    /** Their verified Boxity account id ('' for guests), so chat can be matched to them. */
    uid: t.string(),
    wins: t.uint32(),
    kills: t.uint32(),
  },
  'PlayerState',
)

export const GameState = schema(
  {
    /** sessionId -> player */
    players: t.map(PlayerState),
    /** Short code for private lobbies ('' for public ones). */
    code: t.string(),
    isPrivate: t.boolean(),
  },
  'GameState',
)
