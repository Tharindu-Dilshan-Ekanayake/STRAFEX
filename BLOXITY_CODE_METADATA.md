---
canDie: true
hasScore: true
---

# STRAFEX: Boxity integration

Competitive block PvP. The STRAFEX hub is a floating island built for a full server of
50: a giant sword monument on the plaza, the Duels colosseum, the Spirelands portal on a
slate hill, the market (case stalls and the leaderboard), training grounds with dummies
to practise combos on, a parkour tower (a daily cash reward for reaching the top), a
lake with a lighthouse, waterfalls, and jump pads up to a sky island. From there you
queue for a 1v1 duel in one of nine modes (each a kit: STRAFEX, Sword, Axe, Crystal,
UHC, Mace, Spear Mace, Pot, SMP) or drop into Spirelands, a free-for-all island in the
open sea: beaches with palms, a pier, a shipwreck, a lighthouse and islets round the
coast, a river, the ruined Spire Keep in the middle, slate spires joined by plank
bridges, a village, ruins, ponds and jump pads. You can swim (hold jump to rise) and
climb back out onto the shore. Duels look for a real player
first (anyone searching, any mode); nobody within 10 seconds and an easy bot steps in
(searching from Spirelands waits for a real player). When an opponent is found both vote for one of six
arenas (Suncourt, Meadow, Mirage, Bastion, Glade, Dunes), then fight rounds until
someone reaches the mode's "first to" score; leaving mid-duel is a forfeit. In
Spirelands you pick a kit, kills heal you and pay out, a three-kill streak puts a bounty
on your head (whoever ends it earns extra), dying sends you back to the kit picker, and
broken ground grows back. Easy bots keep it at ten fighters, one leaving for each real
player who joins (1 player: 9 bots ... 9 players: 1 bot); from ten real players on it's
people only, up to
all 30 on the server (a full server: Legion's matchmaker starts another).

Two hands: kits put a shield (or a revive charm) in the offhand, so right click blocks
with the sword still held; E opens the whole inventory (armour, offhand, a 27-slot bag
and the hotbar; click two slots to swap or stack them), F swaps the held item and the
offhand. Right click uses the right hand's item if it does something, else the left's
(eat an apple from the offhand without switching).

Mining and crafting: blocks you break go into your inventory (in a duel, the ones you
placed; in Spirelands, anything) and the inventory's crafting column turns them into gear:
a shield (6 planks), obsidian for blast-proof walls, a bucket, and a fire bow. Fire bow
arrows set a small patch of ground alight where they land and set whoever they hit on fire
(burning hurts every second, armour doesn't help); flames burn out after a few seconds.
Water puts you out: jump in, or pour a water bucket (on the ground, onto flames, or over
yourself); an empty bucket scoops water back up. UHC, SMP and STRAFEX kits carry a water
bucket; UHC and SMP a fire bow. Each kit has a picture on its card: a fight on the island.

Water flows like Minecraft's: dig beside the sea or pour a bucket and it falls, then
spreads up to seven blocks; flowing water dries up when its source is gone. With your head
under water you have ten bubbles of air, then you drown (a heart a second). Spirelands is
a bigger island (256 x 256) with loot chests all over it: right click (or hit) one for
random gear; it fills again after 45 seconds. Walking, characters turn to face the way
they go. The UI is Minecraft-themed: grey inventory panels, stone buttons, pixel icons
and lettering, Minecraft's hotbar and touch buttons.

Combat: clicks hit (with a short no-damage window after each hit, so timing beats spam),
falling hits crit, sprint hits knock further and spend your sprint (w-tap to get it
back), armour (iron, diamond, cindersteel) soaks damage and wears down, shields block
from the front until an axe knocks them down, the mace smashes harder the further you
fell, gust charges launch everyone near (you highest), the spear lunges, blast crystals
explode on obsidian, splash potions heal, golden apples give absorption hearts, and a
revive charm saves you from one killing blow. The HUD shows keystrokes with clicks per
second, armour durability and your hits, combo and damage.

Progression: duels and Spirelands lives give cash and XP (playing, winning, kills, hits,
bounties); every level pays cash and every fifth a free case. Three daily quests per
player pay cash and XP the moment they're done. Levels show on name tags. Cases unlock
kill effects (a burst in your colours where your victim stood; they use the save's old
cape slots, case and Gems skus, so nothing anyone owned was lost) and sword skins. Quick chat (T or the chat button) sends one of ten fixed lines to everyone
in your lobby or match, so guests and offline players can talk too; Boxity chat bubbles
still show over names.

The game runs in `shared/host.js` (queues, duels, Spirelands, combat, bots), the same
code in the Colyseus room (`server/src/rooms/GameRoom.js`, up to 30 players per server)
and in the offline stand-in in the browser (`client/src/net/localServer.js`). Player
saves are `shared/logic.js` profiles. The host checks every reported position
(`shared/movecheck.js`: speed budget, flying, walking through walls) and puts cheaters
back; reach, attack speed per weapon and dig time are checked too. `npm run loadtest` in
`server/` drives fake players against a local server.

## Leaderboards

Scores are reported by the **game server**, never by the client
(`server/src/bloxityLeaderboards.js`, `BLOXITY_LEADERBOARDS`). Every ~20 s and when a
player leaves, each pod sends the changed scores of its verified players to
`POST {api}/v1/leaderboards/hosted/{BLOXITY_GAME_ID}/report` as `legion_<userId>`.

| Board      | Label          | Score                                | Format |
|------------|----------------|--------------------------------------|--------|
| `wins`     | Wins           | `profile.wins`                       | number |
| `kills`    | Kills          | `profile.kills`                      | number |
| `games`    | Duels Played   | `profile.games`                      | number |
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
| `vip`        | x2 cash from every duel (permanent)            |
| `starter`    | Flame Burst kill effect + Inferno sword skin + 1,000 cash |

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
sneaking, jumping, weapon swings, raising a shield and looking up and down, carries the
held item in its right hand and the equipped cape on its back. Until an avatar has loaded (or if its
assets fail), a blocky stand-in is drawn. The nearest 4 / 10 / 12 characters (LOW /
MEDIUM / HIGH) are avatars; anyone further away is a blocky figure.

## Server environment

| Variable                | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `BLOXITY_REPORT_TOKEN`  | Token for leaderboard and room reports (none set = no reports) |
| `MATCHMAKER_REPORT_URL` | Where the Open Rooms reporter posts (injected by Boxity hosting) |
| `BLOXITY_GAME_ID`       | Hosted game id for reports (default `strafex`)              |
| `LEGION_WEBHOOK_SECRET` | Must match the webhook's `x-legion-webhook-secret` header     |
| `MONGODB_URI`           | Shared database for profiles and Gems grants (SQLite without) |
| `BLOXITY_API_URL` etc.  | Platform URLs; production defaults (`server/src/bloxityEnv.js`) |
