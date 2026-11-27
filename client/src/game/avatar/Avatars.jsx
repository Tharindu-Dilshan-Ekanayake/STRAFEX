import { useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mesh, Vector3 } from 'three'

import { LOBBY_SWORD, OFFHAND } from '@shared/balance'

import { bodyTurn } from './bodyTurn'

import { useBloxity } from '../../bloxity/BloxityContext'
import ErrorBoundary from '../../ui/ErrorBoundary'
import { getGame } from '../../store/game'
import { getQuality } from '../../store/quality'
import { itemModel } from '../art/items'
import { frameStats } from '../perf'
import { runtime } from '../runtime'
import BloxityAvatar from './BloxityAvatar'
import { avatarShown } from './state'

/**
 * Everyone as their Bloxity avatar: you (seen in third person and in the lobby) and
 * every other player, dressed as their account is - bots wear the base body. Each
 * carries the item in their hand. Until an avatar has loaded (or if it
 * can't), the blocky stand-in in Characters.jsx shows instead.
 *
 * Which avatars exist is decided four times a second (React state, never from the frame
 * loop); where they stand and how they move is set every frame from `runtime`.
 */

const REFRESH_MS = 250

/**
 * A shield in a hand (`side` 1 = left, -1 = right). The hand's frame turns with the arm,
 * so: hanging at rest, the shield stands upright beside the forearm, its face forward
 * and a little out; raised to block (the arm level, pointing ahead), it lies across the
 * arm - which turns its face straight at whoever is in front.
 */
function placeShield(mesh, raised, side) {
  if (raised) {
    mesh.position.set(0.02 * side, -0.14, 0.04)
    mesh.rotation.set(Math.PI / 2, 0, 0)
  } else {
    // The idle pose holds the forearm out (about a radian): tipped back by that much, the
    // shield stands upright.
    mesh.position.set(0.05 * side, -0.12, 0.08)
    mesh.rotation.set(0.9, 0.3 * side, 0)
  }
}
let shieldModel = null

export default function Avatars() {
  const [slots, setSlots] = useState([])

  useEffect(() => {
    let lastKey = ''
    /**
     * How many avatars there may be right now: as many as the preset allows, unless the
     * last frames went over the preset's draw-call budget (a crowd of players with many
     * accessories) - then the farthest fall back to the light blocky figure until there's
     * room again. A step every refresh at most, and back up only after a while, so it
     * never flickers.
     */
    let cap = Infinity
    let raisedAt = 0
    /** eids that have an avatar now: kept while they stay fairly near (building an
     * avatar is the expensive part, so slots don't flip as people move about). */
    let members = new Set()
    const refresh = () => {
      const q = getQuality()
      const b = runtime.player.body
      const calls = frameStats.calls
      const budget = q.drawBudget || 140
      const wanted = Math.max(0, q.avatarCount - 1) + (q.botAvatarCount ?? 9)
      if (cap > wanted) cap = wanted
      // Over budget: drop as many avatars as it takes (each is about three draws).
      if (calls > budget && cap > 3) cap = Math.max(3, cap - Math.max(1, Math.ceil((calls - budget) / 3)))
      else if (calls < budget - 14 && cap < wanted && performance.now() - raisedAt > 2000) {
        cap += 1
        raisedAt = performance.now()
      }
      // Real players and bots each have their own avatar slots: real players up to the
      // preset's avatarCount (you included), and every bot nearby too (bots only fill
      // Spirelands while few real players are in, so there are never many).
      const ranked = [...runtime.remotes.values()]
        .map((r) => ({ r, d: Math.hypot(r.x - b.x, r.z - b.z) }))
        .filter(({ r, d }) => d <= q.avatarDistance && (q.botAvatars || !r.bot))
        .sort((a, c) => a.d - c.d)
      const next = new Set()
      // Building an avatar is the expensive part: at most one new one per refresh, so
      // walking into a crowd never builds several in the same frame (a hitch).
      let added = 0
      const fill = (list, slots) => {
        let used = 0
        // Keep who already has one while they stay among the nearest.
        list.forEach(({ r }, i) => {
          if (members.has(r.eid) && i < slots + 2 && used < slots) {
            next.add(r.eid)
            used += 1
          }
        })
        for (const { r } of list) {
          if (used >= slots) break
          if (next.has(r.eid)) continue
          if (!members.has(r.eid)) {
            if (added >= 1) continue
            added += 1
          }
          next.add(r.eid)
          used += 1
        }
      }
      // Real players first, nearest first; then bots - within what the budget allows.
      const realSlots = Math.min(Math.max(0, q.avatarCount - 1), cap)
      fill(ranked.filter(({ r }) => !r.bot), realSlots)
      const usedReal = [...next].length
      fill(ranked.filter(({ r, d }) => r.bot && d <= (q.botAvatarDistance ?? q.avatarDistance)), Math.min(q.botAvatarCount ?? 9, Math.max(0, cap - usedReal)))
      members = next
      const list = ranked
        .filter(({ r }) => next.has(r.eid))
        .map(({ r }) => ({ key: `e${r.eid}`, eid: r.eid, lookKey: r.lookKey || '' }))
        .sort((a, c) => a.eid - c.eid)
      const key = list.map((s) => `${s.key}:${s.lookKey}`).join('|')
      if (key !== lastKey) {
        lastKey = key
        setSlots(list)
      }
    }
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <SelfAvatar />
      {slots.map((s) => (
        <RemoteAvatar key={`${s.key}:${s.lookKey}`} eid={s.eid} lookKey={s.lookKey} />
      ))}
    </>
  )
}

function SelfAvatar() {
  const { avatar, proportions } = useBloxity()
  return <AvatarSlot id="self" equipped={avatar} proportions={proportions} local />
}

function RemoteAvatar({ eid, lookKey }) {
  const look = useMemo(() => {
    try {
      return lookKey ? JSON.parse(lookKey) : null
    } catch {
      return null
    }
  }, [lookKey])
  return <AvatarSlot id={eid} equipped={look?.equipped || null} proportions={look?.proportions || null} />
}

const _dir = new Vector3()

function AvatarSlot({ id, equipped, proportions, local = false }) {
  const outer = useRef(null)
  const hand = useRef(null)
  const back = useRef(null)
  const motion = useRef({ walkPhase: 0, speed: 0, anim: 0, swing: 0, holding: false, pitch: 0, time: 0, headTurn: 0 })
  const turn = useRef({})
  /** Whether the body is posed this frame (see the frame loop). */
  const active = useRef(true)
  const frame = useRef(0)
  const [ready, setReady] = useState(false)
  const itemMesh = useMemo(() => {
    const m = new Mesh(undefined, undefined)
    m.visible = false
    return m
  }, [])
  const offMesh = useMemo(() => {
    const m = new Mesh(undefined, undefined)
    m.visible = false
    return m
  }, [])
  const offHand = useRef(null)
  /** Your own body's state each frame (reused; nothing allocated in the loop). */
  const selfSrc = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 0, speed: 0, walkPhase: 0, swingAt: 0 }), [])

  const onReady = useCallback(() => {
    setReady(true)
    avatarShown.add(id)
  }, [id])
  useEffect(() => () => avatarShown.delete(id), [id])

  useFrame(({ camera }) => {
    const g = outer.current
    if (!g) return
    const now = performance.now()
    let src
    let visible = true
    let held = 'fist'
    let off = 'fist'
    let sword = 'classic'
    if (local) {
      const p = runtime.player
      visible = runtime.zone === 'lobby' || (runtime.zone === 'match' && runtime.camera.mode === 'third')
      src = selfSrc
      src.x = p.body.x
      src.y = p.body.y
      src.z = p.body.z
      src.yaw = p.yaw
      src.pitch = p.pitch
      src.anim = runtime.blocking ? 5 : p.anim
      src.speed = p.speed
      src.walkPhase = p.walkPhase
      src.swingAt = runtime.swingAt
      held = runtime.zone === 'match' ? runtime.me.inv?.[runtime.me.sel]?.id || 'fist' : runtime.zone === 'lobby' ? LOBBY_SWORD : 'fist'
      off = runtime.zone === 'match' ? runtime.me.inv?.[OFFHAND]?.id || 'fist' : 'fist'
      sword = getGame().profile.sword
    } else {
      src = runtime.remotes.get(id)
      if (src) {
        held = src.held
        off = src.off || 'fist'
        sword = src.sword
      }
    }
    if (!src) {
      g.visible = false
      active.current = false
      g.matrixWorldAutoUpdate = false
      return
    }
    g.visible = visible && ready
    // Only pose bodies that can be seen: not hidden (you in first person), not behind
    // the camera; far ones every other frame.
    camera.getWorldDirection(_dir)
    const dx = src.x - camera.position.x
    const dy = src.y + 1 - camera.position.y
    const dz = src.z - camera.position.z
    const dist = Math.hypot(dx, dy, dz)
    const behind = dist > 3 && (dx * _dir.x + dy * _dir.y + dz * _dir.z) / dist < -0.2
    frame.current += 1
    // Near: every frame. Further: every other frame. Far: every third (LOW poses fewer).
    const q = getQuality()
    const every = dist < q.avatarPoseFull ? 1 : dist < q.avatarPoseHalf ? 2 : 3
    active.current = g.visible && !behind && frame.current % every === 0
    // Not posed this frame: three needn't walk its ~60 bones either (the pose and place
    // are exactly last frame's).
    g.matrixWorldAutoUpdate = active.current
    if (!active.current) return
    g.position.set(src.x, src.y, src.z)
    // The rig faces +Z; the game's characters face -Z at yaw 0. Walking, the whole figure
    // turns to face the way it's going.
    const turnOff = bodyTurn(turn.current, src.x, src.z, src.yaw, now)
    g.rotation.y = src.yaw + turnOff + Math.PI
    const m = motion.current
    m.headTurn = 0
    m.walkPhase = src.walkPhase
    m.speed = src.speed
    m.anim = src.anim
    m.pitch = src.pitch
    m.time = now / 1000
    const t = (now - src.swingAt) / 280
    m.swing = t >= 0 && t < 1 ? Math.sin(t * Math.PI) : 0
    m.holding = held !== 'fist'
    m.offShield = off === 'shield'
    m.offHolding = off !== 'fist'

    // The held item, handle in the palm, blade pointing ahead.
    shieldModel ||= itemModel('shield')
    const model = itemModel(src.anim === 5 && off !== 'shield' ? 'shield' : held, sword)
    if (model) {
      if (itemMesh.geometry !== model.geometry) {
        itemMesh.geometry = model.geometry
        itemMesh.material = model.material
      }
      const size = model.block ? 0.32 : model === shieldModel ? 0.72 : 0.9
      itemMesh.scale.setScalar(size)
      if (model.block) {
        itemMesh.position.set(0, -0.08, 0.1)
        itemMesh.rotation.set(0, 0.6, 0)
      } else if (model === shieldModel) {
        placeShield(itemMesh, src.anim === 5, -1)
      } else {
        // Sprites are drawn blade up-right: turned so that, with the arm hanging, the
        // blade points ahead and down (it comes level as the arm lifts), handle in hand.
        itemMesh.position.set(0, -0.33 * size, 0.33 * size)
        itemMesh.rotation.set(0, -Math.PI / 2, -Math.PI / 2)
      }
      itemMesh.visible = true
    } else {
      itemMesh.visible = false
    }

    // The left hand's item (a shield faces out from the forearm).
    const offModel = off !== 'fist' ? itemModel(off, sword) : null
    if (offModel) {
      if (offMesh.geometry !== offModel.geometry) {
        offMesh.geometry = offModel.geometry
        offMesh.material = offModel.material
      }
      const size = offModel.block ? 0.28 : 0.72
      offMesh.scale.setScalar(size)
      if (offModel.block) {
        offMesh.position.set(0, -0.08, 0.1)
        offMesh.rotation.set(0, -0.6, 0)
      } else if (off === 'shield') {
        placeShield(offMesh, src.anim === 5, 1)
      } else {
        offMesh.position.set(0, -0.33 * size, 0.33 * size)
        offMesh.rotation.set(0, -Math.PI / 2, -Math.PI / 2)
      }
      offMesh.visible = true
    } else offMesh.visible = false

  })

  return (
    <group ref={outer} visible={false}>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <BloxityAvatar equipped={equipped} proportions={proportions} motionRef={motion} handRef={hand} offHandRef={offHand} backRef={back} activeRef={active} onReady={onReady} local={local} />
        </Suspense>
      </ErrorBoundary>
      <group ref={hand}>
        <primitive object={itemMesh} />
      </group>
      <group ref={offHand}>
        <primitive object={offMesh} />
      </group>
      <group ref={back} />
    </group>
  )
}
