import { ITEMS, MODES, REWARDS } from '@shared/balance'
import { DUEL_MAPS } from '@shared/maps'

import { sfx } from '../audio/sfx'
import { itemModel } from '../game/art/items'
import { selectSlot } from '../game/input'
import { pushFx, runtime } from '../game/runtime'
import { applyEdits, enterLobby, enterMatch, worldState } from '../game/world'
import { getGame } from '../store/game'
import { showHit } from '../ui/juice'
import { showQuickChat } from './quickChat'
import { applyRoster, applySnapshot, clearRemotes } from './remotes'
import { t } from '../ui/i18n'

/**
 * Everything the authority (online room or offline host) tells this client, turned
 * into world changes, effects, sounds and store updates.
 */

const dist = (x, y, z) => {
  const b = runtime.player.body
  return Math.hypot(x - b.x, y - b.y, z - b.z)
}
/** 1 close by, fading to 0 at 40 blocks: loudness of something happening at (x, y, z). */
const near = (x, y, z) => Math.max(0, 1 - dist(x, y, z) / 40)
/** Where an entity is (us or someone else), or null. */
function where(eid) {
  if (eid === runtime.eid) return runtime.player.body
  return runtime.remotes.get(eid) || null
}

let lastPhaseKey = ''
let streak = 0
let lastKillAt = 0

/** Builds the sword models for a skin now, so none is made in the middle of a frame. */
const SWORDS = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'sword')
function warmSwords(skin) {
  if (skin && skin !== 'classic') for (const id of SWORDS) itemModel(id, skin)
}

function setZone(zone) {
  if (runtime.zone === zone) return
  const wasLobby = runtime.zone === 'lobby'
  runtime.zone = zone
  getGame().setZone(zone)
  if ((zone === 'lobby') !== wasLobby) clearRemotes()
}

function teleport({ x, y, z, yaw, zone }) {
  if (zone) {
    // Back in the fight (a new round, or a fresh Spirelands life): the knockout card goes.
    if (zone === 'match' && runtime.zone !== 'match') getGame().setResult(null)
    setZone(zone)
    if (zone === 'lobby' && (worldState.kind !== 'lobby' || !worldState.world)) enterLobby()
  }
  const b = runtime.player.body
  b.x = x
  b.y = y
  b.z = z
  b.vx = b.vy = b.vz = 0
  b.pushX = b.pushZ = 0
  if (typeof yaw === 'number') runtime.player.yaw = yaw
  runtime.snap = true
}

let levelUpTimer = 0

export function handleServerEvent(type, p = {}) {
  const game = getGame()
  switch (type) {
    case 'hello':
      runtime.eid = p.eid
      return
    case 'profile':
      game.setProfile(p.profile, p.session)
      warmSwords(p.profile.sword)
      return
    case 'snap':
      applySnapshot(p.z, p.e)
      return
    case 'roster': {
      applyRoster(p.list)
      for (const e of p.list) warmSwords(e.sword)
      const roster = {}
      for (const e of p.list) roster[e.eid] = e
      runtime.myTeam = roster[runtime.eid]?.team ?? -1
      game.setRoster(roster)
      return
    }
    case 'rstate': {
      // Kills, deaths, zones and armour, without the names and looks (they come with
      // 'roster' only when they change): [eid, zone, arena, alive, kills, streak, armor,
      // team] per player.
      const s = p.s || []
      const roster = { ...game.roster }
      for (let i = 0; i + 7 < s.length; i += 8) {
        const e = roster[s[i]]
        if (!e) continue
        roster[s[i]] = { ...e, zone: s[i + 1], arena: s[i + 2], alive: Boolean(s[i + 3]), kills: s[i + 4], streak: s[i + 5], armor: s[i + 6], team: s[i + 7] }
      }
      applyRoster(Object.values(roster))
      runtime.myTeam = roster[runtime.eid]?.team ?? -1
      game.setRoster(roster)
      return
    }
    case 'phase': {
      const now = performance.now()
      game.setPhase({ ...p, endsAt: now + (p.left || 0), queuedSince: now - (p.queuedMs || 0) })
      // Phase changes worth a sound or a banner.
      const key = `${p.kind}:${p.phase}:${p.round || 0}`
      if (key !== lastPhaseKey) {
        if (p.kind === 'duel' && p.phase === 'fight') {
          sfx.go()
          game.setBanner({ text: t('FIGHT'), sub: t('Good luck!'), color: 'green' })
        }
        if (p.kind === 'duel' && p.phase === 'countdown') {
          game.setResult(null)
          game.setDuelOver(null)
          const ft = MODES[p.mode]?.ft || 1
          game.setBanner({ text: t('ROUND {n}', { n: p.round }), sub: t('{mode} · first to {ft} · {map}', { mode: MODES[p.mode]?.name || '', ft, map: DUEL_MAPS[p.map]?.name || '' }), color: 'gold' })
        }
        if (p.kind === 'duel' && p.phase === 'vote' && !lastPhaseKey.startsWith('duel:vote')) {
          sfx.reward()
          game.closePanel()
        }
        if (p.kind === 'lobby' && lastPhaseKey && !lastPhaseKey.startsWith('lobby')) game.setBanner(null)
        lastPhaseKey = key
      }
      return
    }
    case 'match':
      enterMatch(p)
      // Into a game: whatever lobby screen was up goes away.
      game.closePanel()
      game.setCaseOpen(null)
      game.setResult(null)
      return
    case 'lobby':
      setZone('lobby')
      enterLobby()
      if (game.panel === 'inventory') game.closePanel()
      game.setResult(null)
      game.setSpectating(null)
      game.setDuelOver(null)
      game.setBanner(null)
      return
    case 'tp':
      teleport(p)
      return
    case 'edits': {
      const changed = applyEdits(p.e)
      let pops = 0
      for (const c of changed) {
        if (c.id === 0 && c.before && near(c.x, c.y, c.z) > 0) pushFx({ type: 'break', x: c.x, y: c.y, z: c.z, id: c.before, quiet: true })
        else if (c.id && !c.before && pops < 4 && near(c.x, c.y, c.z) > 0.3) {
          pops += 1
          pushFx({ type: 'place', x: c.x, y: c.y, z: c.z, id: c.id })
        }
      }
      return
    }
    case 'me': {
      const prev = runtime.me
      const now = performance.now()
      runtime.me = { ...p, effectsAt: now, shieldOffAt: now }
      game.setMe(p)
      if (p.zone && p.zone !== runtime.zone && p.zone !== 'lobby') setZone(p.zone)
      if (prev.hp > p.hp && p.alive) runtime.camera.hurtTilt = 1
      // Building and the stack ran out: carry on with the next stack of blocks.
      const was = prev.inv?.[prev.sel]
      if (p.alive && was && ITEMS[was.id]?.kind === 'block' && prev.sel === p.sel && !p.inv[p.sel]) {
        const next = p.inv.findIndex((s) => s && ITEMS[s.id]?.kind === 'block')
        if (next >= 0) selectSlot(next)
      }
      return
    }
    case 'hurt': {
      const at = where(p.eid)
      if (p.eid === runtime.eid) {
        sfx.hurt()
        runtime.camera.hurtTilt = 1
        runtime.camera.shake = Math.max(runtime.camera.shake, 0.22)
        pushFx({ type: 'hurtFlash' })
      } else {
        const r = runtime.remotes.get(p.eid)
        if (r) {
          const now = performance.now()
          // Our own hit was already shown when we swung (Player.jsx): just the number now.
          const shown = p.by === runtime.eid && now - runtime.predictedHitAt < 450
          r.hurtAt = Math.max(r.hurtAt, shown ? r.hurtAt : now)
          if (!shown) pushFx({ type: 'hit', x: r.x, y: r.y + 1.2, z: r.z })
          if (p.by === runtime.eid) {
            if (!shown) sfx.hit()
            showHit(p.dmg)
          } else sfx.hit(near(r.x, r.y, r.z) * 0.6)
        }
      }
      if (p.crit && at) {
        pushFx({ type: 'crit', x: at.x, y: at.y + 1.1, z: at.z })
        sfx.crit(Math.max(0.3, near(at.x, at.y, at.z)))
      }
      return
    }
    case 'blocked': {
      const at = where(p.eid)
      if (at) {
        pushFx({ type: 'blocked', x: at.x, y: at.y + 1.1, z: at.z })
        sfx.block(Math.max(0.3, near(at.x, at.y, at.z)))
      }
      return
    }
    case 'shieldOff': {
      const at = where(p.eid)
      if (at) sfx.shieldBreak()
      if (p.eid === runtime.eid) {
        runtime.blocking = false
        game.showToast(t('Your shield is down!'), 'error')
      }
      return
    }
    case 'charm': {
      pushFx({ type: 'charm', x: p.x, y: p.y + 1, z: p.z })
      sfx.charm()
      if (p.eid === runtime.eid) game.showToast(t('Revive Charm used!'), 'success')
      return
    }
    case 'smash':
      pushFx({ type: 'smash', x: p.x, y: p.y, z: p.z, big: p.big })
      sfx.smash(Math.max(0.3, near(p.x, p.y, p.z)))
      runtime.camera.shake = Math.max(runtime.camera.shake, near(p.x, p.y, p.z) * (p.big ? 0.7 : 0.4))
      return
    case 'kfx':
      pushFx({ type: 'kfx', x: p.x, y: p.y, z: p.z, fx: p.fx })
      return
    case 'gust':
      pushFx({ type: 'gust', x: p.x, y: p.y, z: p.z })
      sfx.gust(Math.max(0.25, near(p.x, p.y, p.z)))
      return
    case 'splash':
      pushFx({ type: 'splash', x: p.x, y: p.y, z: p.z, color: p.color })
      sfx.splash(Math.max(0.25, near(p.x, p.y, p.z)))
      return
    case 'kb': {
      const b = runtime.player.body
      b.pushX += p.x
      b.pushZ += p.z
      b.vy = Math.max(b.vy, p.y)
      b.onGround = false
      return
    }
    case 'swing': {
      const r = runtime.remotes.get(p.eid)
      if (r) r.swingAt = performance.now()
      return
    }
    case 'act': {
      const r = runtime.remotes.get(p.eid)
      if (!r) return
      const now = performance.now()
      if (p.kind === 'dig') {
        r.digAt = { x: p.x, y: p.y, z: p.z, t: now }
        return
      }
      r.swingAt = now
      if (p.kind === 'lunge') {
        pushFx({ type: 'gust', x: r.x, y: r.y + 0.6, z: r.z, small: true })
        sfx.lunge()
        return
      }
      if (p.kind === 'food' || p.kind === 'potion') {
        pushFx({ type: 'use', kind: p.kind, x: r.x, y: r.y + 1.5, z: r.z })
        if (near(r.x, r.y, r.z) > 0.2) (p.kind === 'potion' ? sfx.drink : sfx.eat)()
      }
      return
    }
    case 'boom': {
      pushFx({ type: 'boom', x: p.x, y: p.y, z: p.z, r: p.r })
      const k = near(p.x, p.y, p.z)
      sfx.boom(Math.max(0.15, k))
      runtime.camera.shake = Math.max(runtime.camera.shake, k * 0.9)
      return
    }
    case 'proj':
      pushFx({ type: 'proj', ...p })
      if (p.owner !== runtime.eid && near(p.x, p.y, p.z) > 0.4) sfx.throw(near(p.x, p.y, p.z) * 0.7)
      return
    case 'projEnd':
      pushFx({ type: 'projEnd', ...p })
      return
    case 'used': {
      const item = ITEMS[p.item]
      if (!item) return
      runtime.useAnimUntil = performance.now() + 350
      if (item.kind === 'food') sfx.eat()
      else if (item.kind === 'potion') sfx.drink()
      else if (item.kind === 'bow') sfx.bow()
      else sfx.throw(1)
      return
    }
    case 'feed':
      game.addFeed(p)
      return
    case 'killed': {
      sfx.kill()
      const now = performance.now()
      streak = now - lastKillAt < 8000 ? streak + 1 : 1
      lastKillAt = now
      const names = { 2: 'DOUBLE KILL!', 3: 'TRIPLE KILL!' }
      game.setKillBanner({ name: p.name, streak: streak >= 4 ? 'UNSTOPPABLE!' : names[streak] || null, cash: p.cash ? REWARDS.kill : 0 })
      return
    }
    case 'dead':
      sfx.death()
      setZone('spec')
      if (game.panel === 'inventory') game.closePanel()
      runtime.blocking = false
      game.setResult({ kind: 'dead', by: p.by, how: p.how, mode: p.kind })
      return
    case 'roundEnd': {
      const mine = p.winner === runtime.eid
      game.setBanner({
        text: p.winner ? (mine ? t('ROUND WON') : t('{name} wins the round', { name: p.name })) : t('DRAW'),
        sub: p.score.map((s) => `${s.name} ${s.wins}`).join('  -  '),
        color: p.winner ? (mine ? 'green' : 'red') : 'gold',
      })
      if (mine) sfx.reward()
      return
    }
    case 'duelEnd': {
      const win = p.winner === runtime.eid
      if (win) sfx.win()
      else sfx.death()
      game.setBanner(null)
      game.setResult(null)
      game.setDuelOver({ win, winner: p.name, score: p.score, forfeit: p.forfeit, mode: p.mode })
      return
    }
    case 'duelStats':
      game.setDuelStats(p)
      return
    case 'qc': {
      const text = showQuickChat(p.eid, p.i)
      if (text) {
        sfx.hover()
        game.addFeed({ chat: true, k: p.eid === runtime.eid ? 'You' : p.name, v: text, team: p.team })
      }
      return
    }
    case 'roundReward':
      game.setRoundReward(p)
      return
    case 'levelUp':
      sfx.levelUp()
      game.setLevelUp(p)
      clearTimeout(levelUpTimer)
      levelUpTimer = setTimeout(() => getGame().setLevelUp(null), 4200)
      return
    case 'caseResult':
      game.setCaseOpen(p)
      return
    case 'reward':
      sfx.reward()
      game.showToast(p.label, 'success')
      return
    case 'looted': {
      // What came out of the chest.
      sfx.reward()
      const list = (p.items || []).map(([id, n]) => `${n > 1 ? `${n} x ` : ''}${t(ITEMS[id]?.name || id)}`).join(', ')
      game.showToast(list ? t('Chest: {items}', { items: list }) : t('Your inventory is full'), list ? 'success' : 'error')
      return
    }
    case 'chestOpen':
      pushFx({ type: 'chest', x: p.x, y: p.y, z: p.z })
      if (near(p.x, p.y, p.z) > 0.2) sfx.pop(near(p.x, p.y, p.z) * 0.6)
      return
    case 'pickup':
      // A mined block went into the inventory.
      sfx.pop(0.45)
      return
    case 'crafted':
      sfx.buy()
      game.showToast(t('Crafted {item}', { item: `${p.n > 1 ? `${p.n} x ` : ''}${t(p.name || ITEMS[p.id]?.name || p.id)}` }), 'success')
      return
    case 'douse':
      pushFx({ type: 'douse', x: p.x, y: p.y, z: p.z })
      sfx.splash(Math.max(0.2, near(p.x, p.y, p.z) * 0.8))
      return
    case 'ignite':
      pushFx({ type: 'ignite', x: p.x, y: p.y, z: p.z })
      sfx.fuse(Math.max(0.15, near(p.x, p.y, p.z) * 0.7))
      return
    case 'toast':
      if (p.kind === 'error') sfx.error()
      game.showToast(t(p.text), p.kind || 'info')
      return
    case 'leaderboards':
      game.setLeaderboards(p)
      return
    default:
  }
}
