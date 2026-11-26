# STRAFEX - client

React + react-three-fiber. Everything you see is generated in code at start-up (block
textures, item models, capes, map previews, sounds), so there are no model or texture
downloads.

```
npm run dev        # http://localhost:5173 - finds the game server on :2567, else plays offline with bots
npm run build      # production build in dist/
```

URL flags: `?offline` (always play against bots in this tab), `?perf` (render numbers on
`window.__perf`; in development also the r3f-perf overlay), `?debug` (internals on
`window.__pp`), `?server=http://host:port` (development only: a specific server).

Controls: WASD move, Space jump, Shift or double-tap W sprint, C sneak (a sprint hit
spends it: let go of W or Shift to get it back - the w-tap), left mouse hit (every click counts;
the CPS meter shows your rate) / break, right mouse block with a shield / eat and drink
(hold) / throw / shoot (hold to draw) / lunge with the spear / place blocks and blast
crystals (with the right hand's item, else the offhand's), 1-9 or the wheel pick a slot,
V switch camera, E use a lobby station (Duels, Spirelands, cases) - in a fight E opens the
inventory (click two slots to swap them; the offhand slot holds a shield that blocks with
your sword in hand) and F swaps hands, R play again after a duel. In the lobby: hit the training dummies,
run the parkour (gold block to the finish plate), ride the jump pads to the sky island. Phones get a stick, drag-to-look and
buttons.
