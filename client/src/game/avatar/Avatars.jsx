import { useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, Mesh, MeshLambertMaterial, Vector3 } from 'three'

import { LOBBY_SWORD } from '@shared/balance'

import { useBloxity } from '../../bloxity/BloxityContext'
import ErrorBoundary from '../../ui/ErrorBoundary'
import { getGame, useGame } from '../../store/game'
import { getQuality } from '../../store/quality'
import { capeUV, getCapeAtlas } from '../art/capes'
import { itemModel } from '../art/items'
import { runtime } from '../runtime'
import BloxityAvatar from './BloxityAvatar'
import { avatarShown } from './state'

/**
 * Everyone as their Bloxity avatar: you (seen in third person and in the lobby) and
 * every other player, dressed as their account is - bots wear the base body. Each
 * carries the item in their hand and their cape. Until an avatar has loaded (or if it
 * can't), the blocky stand-in in Characters.jsx shows instead.
 *
 * Which avatars exist is decided four times a second (React state, never from the frame
 * loop); where they stand and how they move is set every frame from `runtime`.
 */

const REFRESH_MS = 250

export default function Avatars() {
  const [slots, setSlots] = useState([])

  useEffect(() => {
    let lastKey = ''
    /** eids that have an avatar now: kept while they stay fairly near (building an
     * avatar is the expensive part, so slots don't flip as people move about). */
    let members = new Set()
    const refresh = () => {
      const q = getQuality()
      const slotsFree = Math.max(0, q.avatarCount - 1)
      const b = runtime.player.body
      // Real players before bots, then nearest first; bots only where the preset allows.
      const ranked = [...runtime.remotes.values()]
        .map((r) => ({ r, d: Math.hypot(r.x - b.x, r.z - b.z) }))
        .filter(({ r, d }) => d <= q.avatarDistance && (q.botAvatars || !r.bot))
        .sort((a, c) => (a.r.bot ? 1 : 0) - (c.r.bot ? 1 : 0) || a.d - c.d)
      const keepRank = slotsFree + 2
      const next = new Set()
      ranked.forEach(({ r }, i) => {
        if (members.has(r.eid) && i < keepRank && next.size < slotsFree) next.add(r.eid)
      })
      for (const { r } of ranked) {
        if (next.size >= slotsFree) break
        next.add(r.eid)
      }
      members = next
      const list = ranked
        .filter(({ r }) => next.has(r.eid))
        .map(({ r }) => ({ key: `e${r.eid}`, eid: r.eid, lookKey: r.lookKey || '', cape: r.cape || 'none' }))
        .sort((a, c) => a.eid - c.eid)
      const key = list.map((s) => `${s.key}:${s.lookKey}:${s.cape}`).join('|')
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
        <RemoteAvatar key={`${s.key}:${s.lookKey}`} eid={s.eid} lookKey={s.lookKey} capeId={s.cape} />
      ))}
    </>
  )
}

function SelfAvatar() {
  const { avatar, proportions } = useBloxity()
  const capeId = useGame((s) => s.profile.cape)
  return <AvatarSlot id="self" equipped={avatar} proportions={proportions} capeId={capeId} local />
}

function RemoteAvatar({ eid, lookKey, capeId }) {
  const look = useMemo(() => {
    try {
      return lookKey ? JSON.parse(lookKey) : null
    } catch {
      return null
    }
  }, [lookKey])
  return <AvatarSlot id={eid} equipped={look?.equipped || null} proportions={look?.proportions || null} capeId={capeId} />
}

/** A thin box with its big faces showing one cell of the cape atlas, hanging from its top. */
function capeGeometry(id) {
  const geo = new BoxGeometry(0.56, 0.86, 0.035)
  geo.translate(0, -0.43, 0)
  const [u0, v0, du, dv] = capeUV(id)
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv)
  return geo
}
const capeMaterial = new MeshLambertMaterial()
const _dir = new Vector3()

function AvatarSlot({ id, equipped, proportions, capeId, local = false }) {
  const outer = useRef(null)
  const hand = useRef(null)
  const back = useRef(null)
  const motion = useRef({ walkPhase: 0, speed: 0, anim: 0, swing: 0, holding: false, pitch: 0, time: 0 })
  /** Whether the body is posed this frame (see the frame loop). */
  const active = useRef(true)
  const frame = useRef(0)
  const [ready, setReady] = useState(false)
  const itemMesh = useMemo(() => {
    const m = new Mesh(undefined, undefined)
    m.visible = false
    return m
  }, [])
  const hasCape = Boolean(capeId && capeId !== 'none')
  const cape = useMemo(() => {
    const c = new Mesh(hasCape ? capeGeometry(capeId) : undefined, capeMaterial)
    c.visible = hasCape
    return c
  }, [capeId, hasCape])
  /** Your own body's state each frame (reused; nothing allocated in the loop). */
  const selfSrc = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 0, speed: 0, walkPhase: 0, swingAt: 0 }), [])

  const onReady = useCallback(() => {
    setReady(true)
    avatarShown.add(id)
  }, [id])
  useEffect(() => () => avatarShown.delete(id), [id])
  useEffect(() => () => cape.geometry?.dispose(), [cape])
  useEffect(() => {
    if (!capeMaterial.map) {
      capeMaterial.map = getCapeAtlas()
      capeMaterial.needsUpdate = true
    }
  }, [])

  useFrame(({ camera }) => {
    const g = outer.current
    if (!g) return
    const now = performance.now()
    let src
    let visible = true
    let held = 'fist'
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
      src.anim = p.anim
      src.speed = p.speed
      src.walkPhase = p.walkPhase
      src.swingAt = runtime.swingAt
      held = runtime.zone === 'match' ? runtime.me.inv?.[runtime.me.sel]?.id || 'fist' : runtime.zone === 'lobby' ? LOBBY_SWORD : 'fist'
      sword = getGame().profile.sword
    } else {
      src = runtime.remotes.get(id)
      if (src) {
        held = src.held
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
    // The rig faces +Z; the game's characters face -Z at yaw 0.
    g.rotation.y = src.yaw + Math.PI
    const m = motion.current
    m.walkPhase = src.walkPhase
    m.speed = src.speed
    m.anim = src.anim
    m.pitch = src.pitch
    m.time = now / 1000
    const t = (now - src.swingAt) / 280
    m.swing = t >= 0 && t < 1 ? Math.sin(t * Math.PI) : 0
    m.holding = held !== 'fist'

    // The held item, handle in the palm, blade pointing ahead.
    const model = itemModel(held, sword)
    if (model) {
      if (itemMesh.geometry !== model.geometry) {
        itemMesh.geometry = model.geometry
        itemMesh.material = model.material
      }
      const size = model.block ? 0.28 : 0.72
      itemMesh.scale.setScalar(size)
      if (model.block) {
        itemMesh.position.set(0, -0.08, 0.1)
        itemMesh.rotation.set(0, 0.6, 0)
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

    // The cape lifts as they run.
    if (hasCape) {
      cape.position.set(0, -0.02, -0.2)
      cape.rotation.x = 0.12 + Math.min(1.0, src.speed * 0.13) + (src.anim === 4 ? 0.3 : 0) + Math.sin(now / 300 + (Number(id) || 0)) * 0.04
    }
  })

  return (
    <group ref={outer} visible={false}>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <BloxityAvatar equipped={equipped} proportions={proportions} motionRef={motion} handRef={hand} backRef={back} activeRef={active} onReady={onReady} local={local} />
        </Suspense>
      </ErrorBoundary>
      <group ref={hand}>
        <primitive object={itemMesh} />
      </group>
      <group ref={back}>
        <primitive object={cape} />
      </group>
    </group>
  )
}
