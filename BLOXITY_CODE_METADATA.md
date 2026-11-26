---
canDie: true
hasScore: true
---

# Lucky Sky Brawl: Boxity integration

A block-world battle royale on floating islands. Everyone starts in a glass cage above
their own island; when the cages open you break your Lucky Blocks for random items
(swords, bows, potions, TNT, warp pearls, blocks - or an unlucky surprise), build a
bridge to the middle island where the Mega Lucky Blocks are, and fight. The lava sea
below rises through the round. Last one standing wins. The room votes whether bots fill the empty islands (no votes:
no bots; a lone player always gets bots), and once every real player is out the round
ends. Between
rounds the room votes in two steps: first the mode (Solo free-for-all, 4 Teams 2v2v2v2,
3 Teams 3v3v2, 2 Teams 4v4, Max Luck, Lava Rush) with the bots (none / Easy / Normal /
Hard), then the map: six of the twelve maps (Sunny Meadow, Frosty Peaks, Candy Clouds,
Dune Isles, Sky Castle, Ember Isles, Autumn Woods, Marble Temple, Jungle Ruins, Mushroom Grove, Tropical
Bay, Brick Town) are offered each round, never the last one played -
and the round starts. Each step ends as soon as everyone has voted. Players who arrive
mid-round can spectate or join it, taking over a bot (or a free island). In team modes
players are dealt evenly across the teams; there is no friendly fire and the whole
winning team wins. Cases unlock capes and
sword skins with the cash you earn.

Progression: rounds give XP (playing, kills, lucky blocks, placement, wins); every level
pays cash and every fifth a free case. Three daily quests per player pay cash and XP the
moment they're done. Levels show on name tags. Quick chat (T or the chat button) sends
one of ten fixed lines to everyone in your zone, so guests and offline players can talk
too; Boxity chat bubbles still show over names.

The game runs in `shared/host.js` (rounds, rules, bots), the same code in the Colyseus
room (`server/src/rooms/GameRoom.js`) and in the offline stand-in in the browser
(`client/src/net/localServer.js`). Player saves are `shared/logic.js` profiles. The host
checks every reported position (`shared/movecheck.js`: speed budget, flying, walking
through walls) and puts cheaters back; reach, attack speed and dig time were already
checked. `npm run loadtest` in `server/` drives fake players against a local server.

## Leaderboards

Scores are reported by the **game server**, never by the client
(`server/src/bloxityLeaderboards.js`, `BLOXITY_LEADERBOARDS`). Every ~20 s and when a
player leaves, each pod sends the changed scores of its verified players to
`POST {api}/v1/leaderboards/hosted/{BLOXITY_GAME_ID}/report` as `legion_<userId>`.

| Board      | Label          | Score                                | Format |
|------------|----------------|--------------------------------------|--------|
| `wins`     | Wins           | `profile.wins`                       | number |
| `kills`    | Kills          | `profile.kills`                      | number |
| `games`    | Rounds Played  | `profile.games`                      | number |
| `playtime` | Minutes Played | `floor(profile.stats.playtime / 60)` | number |

All four are `order: desc`, `mode: best`, `reset: none`.

## Gems purchases

Boxity's purchase webhook goes to `POST /api/gems/webhook` on the game server. It is
recorded in the database by `transactionId` (idempotent) and applied exactly once by
the pod the buyer plays on. Unknown skus are answered 400 so Boxity refunds them.

| Sku          | Grant                                          |
|--------------|------------------------------------------------|
| `cash_small` | +1,500 cash                                    |
| `cash_big`   | +8,000 cash                                    |
| `vip`        | x2 cash from every round (permanent)           |
| `starter`    | Flame Cape + Inferno sword skin + 1,000 cash   |

## Rewarded ads

The client sends `adReward { placement, rewardToken }`; the server verifies the token
with `POST {api}/v1/ads/reward/verify` before granting anything. Placement:
`free-cash` (+150 cash, 3 min cooldown).

## Open Rooms

Each pod reports its rooms every 2 s to `POST {MATCHMAKER_REPORT_URL}/{BLOXITY_GAME_ID}/rooms`
(`server/src/legionRoomReporter.js`, installed after `listen()`), so they show under
"Open Rooms" on the game page. The client joins `?roomId=` at launch and falls back to
normal matchmaking if that room is gone or full.

## Avatars

Everyone plays as their Bloxity avatar (`client/src/game/avatar/`): the base
`player.glb` rig with the player's skin (shirt, pants and face composited by Boxity),
body parts, hats / hair / masks / back items / accessories, body proportions, or their
own uploaded character (`characterId`). The client sends `look { equipped, proportions }`
when it joins and whenever the outfit changes; the host cleans it (small objects of short
strings and numbers) and shares it in the roster, so every client dresses everyone the
same. Bots wear the base body. Each avatar is posed in code for walking, sprinting,
sneaking, jumping, sword swings and looking up and down, carries the held item in its
right hand and the equipped cape on its back. Until an avatar has loaded (or if its
assets fail), a blocky stand-in is drawn. The nearest 4 / 10 / 12 characters (LOW /
MEDIUM / HIGH) are avatars; anyone further away is a blocky figure.

## Server environment

| Variable                | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `BLOXITY_REPORT_TOKEN`  | Token for leaderboard and room reports (none set = no reports) |
| `MATCHMAKER_REPORT_URL` | Where the Open Rooms reporter posts (injected by Boxity hosting) |
| `BLOXITY_GAME_ID`       | Hosted game id for reports (default `lucky-islands`)              |
| `LEGION_WEBHOOK_SECRET` | Must match the webhook's `x-legion-webhook-secret` header     |
| `MONGODB_URI`           | Shared database for profiles and Gems grants (SQLite without) |
| `BLOXITY_API_URL` etc.  | Platform URLs; production defaults (`server/src/bloxityEnv.js`) |
