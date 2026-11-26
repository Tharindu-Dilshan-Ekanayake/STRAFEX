# Lucky Sky Brawl - client

React + react-three-fiber. Everything you see is generated in code at start-up (block
textures, item models, capes, sounds), so there are no model or texture downloads.

```
npm run dev        # http://localhost:5173 - finds the game server on :2567, else plays offline with bots
npm run build      # production build in dist/
```

URL flags: `?offline` (always play against bots in this tab), `?perf` (render numbers on
`window.__perf`; in development also the r3f-perf overlay), `?debug` (internals on
`window.__pp`), `?server=http://host:port` (development only: a specific server).

Controls: WASD move, Space jump, Shift sneak (you never fall off an edge while sneaking),
Ctrl or double-tap W sprint, left mouse break / hit, right mouse place / use (hold to draw
a bow), 1-9 or the wheel pick a slot, V switch camera, E open a case in the lobby. Phones
get a stick, drag-to-look and buttons.
