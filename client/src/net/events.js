import { ITEMS, MODES, REWARDS } from '@shared/balance'
import { MAPS } from '@shared/maps'

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

let lastPhase = 'waiting'
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
    case 'phase': {
      const phase = { ...p, endsAt: performance.now() + p.left, stageEndsAt: performance.now() + (p.stageLeft || 0) }
      game.setPhase(phase)
      runtime.lava.active = p.phase === 'fight'
      runtime.teamSize = p.teamSize || 1
      runtime.lava.mode = p.mode || 'classic'
      if (p.phase === 'fight') runtime.lava.fightStart = performance.now() - p.elapsed
      if (p.phase !== lastPhase) {
        if (p.phase === 'fight' && lastPhase === 'cages' && runtime.zone === 'match') {
          sfx.cagesOpen()
          game.showToast(t('GO! Break your lucky blocks!'), 'success')
        }
        if (p.phase === 'cages' && runtime.zone === 'match') {
          game.setResult(null)
          game.setRoundReward(null)
          game.showToast(t('{mode} on {map}!', { mode: t(MODES[p.mode]?.name || 'Solo'), map: t(MAPS[p.map]?.name || 'the islands') }), 'info')
        }
        if (p.phase === 'intermission' && lastPhase !== 'intermission') sfx.tick()
        lastPhase = p.phase
      }
      return
    }
    case 'match':
      enterMatch(p)
      runtime.lava.y = 6
      // Into a round: whatever lobby screen was up goes away.
      game.closePanel()
      game.setCaseOpen(null)
      return
    case 'lobby':
      setZone('lobby')
      enterLobby()
      game.setResult(null)
      game.setSpectating(null)
      return
    case 'tp':
      teleport(p)
      return
    case 'edits': {
      const changed = applyEdits(p.e)
      // Blocks others broke near you: a crumble and a few chips.
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
      runtime.me = { ...p, effectsAt: performance.now() }
      game.setMe(p)
      if (p.zone && p.zone !== runtime.zone && p.zone !== 'lobby') setZone(p.zone)
      // Tutorial: holding blocks after the first lucky block.
      if (game.tutorial === 1 && p.inv[p.sel] && ITEMS[p.inv[p.sel].id]?.kind === 'block') game.setTutorial(2)
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
      if (p.eid === runtime.eid) {
        sfx.hurt()
        runtime.camera.hurtTilt = 1
        runtime.camera.shake = Math.max(runtime.camera.shake, 0.25)
        pushFx({ type: 'hurtFlash' })
      } else {
        const r = runtime.remotes.get(p.eid)
        if (r) {
          r.hurtAt = performance.now()
          pushFx({ type: 'hit', x: r.x, y: r.y + 1.2, z: r.z })
          if (p.by === runtime.eid) {
            sfx.hit()
            showHit(p.dmg)
            if (game.tutorial === 3) game.setTutorial(4)
          } else sfx.hit(near(r.x, r.y, r.z) * 0.6)
        }
      }
      return
    }
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
      // Another player mining, eating, drinking or throwing.
      const r = runtime.remotes.get(p.eid)
      if (!r) return
      const now = performance.now()
      if (p.kind === 'dig') {
        r.digAt = { x: p.x, y: p.y, z: p.z, t: now }
        return
      }
      r.swingAt = now
      if (p.kind === 'food' || p.kind === 'potion' || p.kind === 'heart') {
        pushFx({ type: 'use', kind: p.kind, x: r.x, y: r.y + 1.5, z: r.z })
        if (near(r.x, r.y, r.z) > 0.2) (p.kind === 'potion' ? sfx.drink : sfx.eat)()
      }
      return
    }
    case 'loot':
      game.setLoot(p)
      if (p.bad) sfx.unlucky()
      else sfx.lucky(p.rare)
      if (game.tutorial === 0) game.setTutorial(1)
      return
    case 'pop':
      pushFx({ type: 'pop', x: p.x, y: p.y, z: p.z, rare: p.rare, bad: p.bad })
      if (near(p.x, p.y, p.z) > 0.3 && dist(p.x, p.y, p.z) > 4) sfx.pop(near(p.x, p.y, p.z))
      return
    case 'tnt':
      pushFx({ type: 'tnt', x: p.x, y: p.y, z: p.z, fuse: p.fuse })
      if (near(p.x, p.y, p.z) > 0) sfx.fuse(near(p.x, p.y, p.z))
      return
    case 'boom': {
      pushFx({ type: 'boom', x: p.x, y: p.y, z: p.z, r: p.r })
      const k = near(p.x, p.y, p.z)
      sfx.boom(Math.max(0.15, k))
      runtime.camera.shake = Math.max(runtime.camera.shake, k * 0.9)
      return
    }
    case 'bolt':
      pushFx({ type: 'bolt', x: p.x, y: p.y, z: p.z })
      sfx.zap(Math.max(0.3, near(p.x, p.y, p.z)))
      return
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
      else if (item.kind === 'potion' || item.kind === 'heart') sfx.drink()
      else if (item.kind === 'bow') sfx.bow()
      else sfx.throw(1)
      return
    }
    case 'feed':
      game.addFeed(p)
      return
    case 'killed': {
      sfx.kill()
      // Streaks: kills within a few seconds of each other.
      const now = performance.now()
      streak = now - lastKillAt < 6000 ? streak + 1 : 1
      lastKillAt = now
      const names = { 2: 'DOUBLE KILL!', 3: 'TRIPLE KILL!' }
      game.setKillBanner({ name: p.name, streak: streak >= 4 ? 'UNSTOPPABLE!' : names[streak] || null, cash: REWARDS.kill })
      return
    }
    case 'dead':
      sfx.death()
      setZone('spec')
      game.setResult({ kind: 'dead', by: p.by, how: p.how, placement: p.placement })
      return
    case 'win': {
      const me = p.eid === runtime.eid || (p.team >= 0 && p.team === runtime.myTeam)
      if (me) sfx.win()
      if (runtime.zone === 'match' || runtime.zone === 'spec') {
        const prev = game.result
        game.setResult({ kind: me ? 'win' : 'over', winner: p.name, placement: prev?.placement })
      }
      return
    }
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
