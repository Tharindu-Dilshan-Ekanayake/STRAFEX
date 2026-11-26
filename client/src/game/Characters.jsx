import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three'

import { LOBBY_SWORD, TEAMS } from '@shared/balance'

import { bubbleFor } from '../bloxity/chat'
import { quickBubble } from '../net/quickChat'
import { getGame } from '../store/game'
import { getQuality } from '../store/quality'
import { capeUV, getCapeAtlas } from './art/capes'
import { itemModel } from './art/items'
import { avatarShown } from './avatar/state'
import { runtime } from './runtime'

/**
 * Every player and bot as a blocky figure: head, hair, eyes, body, arms and legs are
 * all instances of one box (one draw call for everyone), capes are instances of a
 * second box textured from the cape atlas (one more), and the item in each hand is a
 * shared model. Names float above as HTML labels.
 */

const MAX = 16
const PARTS = 10
const SKINS = ['#f2c9a0', '#e0ac7e', '#c68b59', '#8d5a3b', '#5c3a24', '#ffd9b8']
const HAIR = ['#3b2414', '#1b1b1b', '#a8692b', '#e8c25a', '#6b3a1e', '#b8432f', '#ececec']
const SHIRTS = ['#3fa2ff', '#e8463a', '#46c25a', '#f6b52d', '#a35cff', '#22c3c3', '#ff7bc0', '#f2f2f2', '#333a4d']
const PANTS = ['#2b3a73', '#3a3a3a', '#5a3a24', '#1f4d2b', '#4a2b5c']

function hashName(name) {
  let h = 2166136261
  for (let i = 0; i < name.length; i += 1) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

const lookCache = new Map()
/** Skin, hair, shirt and pants colours picked from the name, so everyone keeps their look. */
function lookFor(name) {
  if (lookCache.has(name)) return lookCache.get(name)
  const h = hashName(name || 'Player')
  const look = {
    skin: new Color(SKINS[h % SKINS.length]),
    hair: new Color(HAIR[(h >>> 4) % HAIR.length]),
    shirt: new Color(SHIRTS[(h >>> 8) % SHIRTS.length]),
    pants: new Color(PANTS[(h >>> 12) % PANTS.length]),
  }
  lookCache.set(name, look)
  return look
}
const EYE = new Color('#1a1a2e')

/** A unit box with each face shaded (lit from above) baked into vertex colours. */
function shadedBox() {
  const geo = new BoxGeometry(1, 1, 1)
  const shade = [0.82, 0.72, 1, 0.55, 0.9, 0.7]
  const colors = []
  for (let f = 0; f < 6; f += 1) for (let v = 0; v < 4; v += 1) colors.push(shade[f], shade[f], shade[f])
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

const partGeometry = shadedBox()
const partMaterial = new MeshBasicMaterial({ vertexColors: true })

/** The cape: a thin box whose big faces show this instance's cell of the cape atlas. */
const capeGeometry = new BoxGeometry(1, 1, 1)
const capeMaterial = new MeshBasicMaterial({ color: '#ffffff' })
capeMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 capeUv;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = capeUv.xy + uv * capeUv.zw;\n#endif')
}

// Scratch objects, reused every frame.
const tmp = new Object3D()
const root = new Matrix4()
const local = new Matrix4()
const pivot = new Matrix4()
const m4 = new Matrix4()
const q = new Quaternion()
const v = new Vector3()
const s = new Vector3()
const tint = new Color()
const HURT = new Color('#ff5050')
const handMatrix = new Matrix4()
const bodyPivot = new Matrix4()
const headPivot = new Matrix4()

/** Matrix for a box `w x h x d` hanging from `pivot` (top centre) rotated by (rx, 0, rz). */
function limb(out, base, px, py, pz, rx, rz, w, h, d, ox = 0, oy = -h / 2, oz = 0) {
  tmp.position.set(px, py, pz)
  tmp.rotation.set(rx, 0, rz)
  tmp.scale.set(1, 1, 1)
  tmp.updateMatrix()
  pivot.multiplyMatrices(base, tmp.matrix)
  local.compose(v.set(ox, oy, oz), q.identity(), s.set(w, h, d))
  out.multiplyMatrices(pivot, local)
  return pivot
}

export default function Characters() {
  const { group, parts, capes, capeUvAttr, hands, labels } = useMemo(() => {
    const g = new Group()
    const p = new InstancedMesh(partGeometry, partMaterial, MAX * PARTS)
    p.instanceMatrix.setUsage(DynamicDrawUsage)
    p.count = 0
    p.frustumCulled = false
    const c = new InstancedMesh(capeGeometry, capeMaterial, MAX)
    c.instanceMatrix.setUsage(DynamicDrawUsage)
    c.count = 0
    c.frustumCulled = false
    const uv = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4)
    uv.setUsage(DynamicDrawUsage)
    capeGeometry.setAttribute('capeUv', uv)
    const h = []
    for (let i = 0; i < MAX; i += 1) {
      const mesh = new Mesh(undefined, undefined)
      mesh.matrixAutoUpdate = false
      mesh.visible = false
      mesh.userData.item = null
      h.push(mesh)
      g.add(mesh)
    }
    g.add(p, c)
    return { group: g, parts: p, capes: c, capeUvAttr: uv, hands: h, labels: [] }
  }, [])

  useEffect(() => {
    capeMaterial.map = getCapeAtlas()
    capeMaterial.needsUpdate = true
    // Name labels: plain divs over the canvas, moved every frame.
    const layer = document.getElementById('nameplates')
    if (layer) {
      for (let i = 0; i < MAX; i += 1) {
        const el = document.createElement('div')
        el.className = 'nameplate'
        el.style.display = 'none'
        el.innerHTML = '<div class="np-bubble"></div><span class="np-lvl"></span><div class="np-name"></div>'
        layer.appendChild(el)
        labels.push({ el, bubble: el.firstChild, lvl: el.children[1], name: el.lastChild, text: '', lvlText: '', bubbleText: '', shown: false })
      }
    }
    return () => {
      for (const l of labels) l.el.remove()
      labels.length = 0
    }
  }, [labels])

  useFrame(({ camera, size }) => {
    const now = performance.now()
    const q8 = getQuality()
    let n = 0
    let ci = 0
    const list = drawList(q8.remoteDrawDistance, camera)
    for (let i = 0; i < list.length && i < MAX; i += 1) {
      const c = list[i]
      const label = labels[i]
      if (label) placeLabel(label, c, camera, size, q8.remoteNameDistance, now)
      // Drawn as their Bloxity avatar (avatar/Avatars.jsx): only the name label here.
      if (avatarShown.has(c.self ? 'self' : c.eid)) {
        hands[i].visible = false
        continue
      }
      const look = lookFor(c.name)
      const hurt = now - c.hurtAt < 280
      // Root: feet at (x, y, z), facing yaw.
      tmp.position.set(c.x, c.y, c.z)
      tmp.rotation.set(0, c.yaw, 0)
      tmp.scale.set(1, 1, 1)
      tmp.updateMatrix()
      root.copy(tmp.matrix)

      const walk = Math.min(1, c.speed / 4)
      const phase = c.walkPhase
      const air = c.anim === 4
      const sneak = c.anim === 3
      const legSwing = air ? 0.35 : Math.sin(phase) * 0.75 * walk
      const armSwing = air ? -0.4 : -Math.sin(phase) * 0.6 * walk
      const swingT = (now - c.swingAt) / 280
      const swing = swingT >= 0 && swingT < 1 ? Math.sin(swingT * Math.PI) : 0
      const lean = sneak ? 0.45 : 0
      const drop = sneak ? -0.12 : 0
      const put = (color, matrix) => {
        parts.setMatrixAt(n, matrix)
        tint.copy(color)
        if (hurt) tint.lerp(HURT, 0.6)
        parts.setColorAt(n, tint)
        n += 1
      }

      // Legs from the hips.
      limb(m4, root, -0.125, 0.72, sneak ? 0.12 : 0, legSwing, 0, 0.25, 0.72, 0.25)
      put(look.pants, m4)
      limb(m4, root, 0.125, 0.72, sneak ? 0.12 : 0, -legSwing, 0, 0.25, 0.72, 0.25)
      put(look.pants, m4)
      // Body, leaning forward when sneaking.
      bodyPivot.copy(limb(m4, root, 0, 0.72 + drop, 0, -lean, 0, 0.5, 0.64, 0.26, 0, 0.32, 0))
      put(look.shirt, m4)
      const bodyM = bodyPivot
      // Arms from the shoulders (the right one swings when hitting or holding out an item).
      // Positive rotation about x swings a hanging limb forward (toward -z).
      const holdOut = c.held !== 'fist' ? 0.35 : 0
      const rArm = swing * 1.7 + holdOut + armSwing * (c.held !== 'fist' ? 0.4 : 1)
      limb(m4, bodyM, 0.37, 0.62, 0, rArm, 0.05, 0.22, 0.64, 0.22)
      handMatrix.copy(pivot)
      put(look.shirt, m4)
      limb(m4, bodyM, -0.37, 0.62, 0, -armSwing, -0.05, 0.22, 0.64, 0.22)
      put(look.shirt, m4)
      // Head, looking up and down with the camera.
      headPivot.copy(limb(m4, bodyM, 0, 0.64, 0, c.pitch * 0.8 + lean, 0, 0.46, 0.46, 0.46, 0, 0.23, 0))
      put(look.skin, m4)
      // Hair: a cap and the back of the head.
      local.compose(v.set(0, 0.43, 0.01), q.identity(), s.set(0.48, 0.1, 0.48))
      m4.multiplyMatrices(headPivot, local)
      put(look.hair, m4)
      local.compose(v.set(0, 0.29, 0.22), q.identity(), s.set(0.48, 0.3, 0.06))
      m4.multiplyMatrices(headPivot, local)
      put(look.hair, m4)
      // Eyes on the front (-z).
      for (const ex of [-0.1, 0.1]) {
        local.compose(v.set(ex, 0.24, -0.232), q.identity(), s.set(0.075, 0.075, 0.02))
        m4.multiplyMatrices(headPivot, local)
        put(EYE, m4)
      }

      // Cape from the shoulders, lifting with speed.
      if (c.cape && c.cape !== 'none') {
        const lift = 0.12 + Math.min(1.0, c.speed * 0.13) + (air ? 0.3 : 0) + Math.sin(now / 300 + c.eid) * 0.04
        limb(m4, bodyM, 0, 0.62, 0.15, -lift, 0, 0.46, 0.74, 0.035)
        capes.setMatrixAt(ci, m4)
        const uv = capeUV(c.cape)
        capeUvAttr.setXYZW(ci, uv[0], uv[1], uv[2], uv[3])
        ci += 1
      }

      // The item in the right hand.
      const hand = hands[i]
      const model = itemModel(c.held, c.sword)
      if (model) {
        if (hand.userData.item !== model) {
          hand.geometry = model.geometry
          hand.material = model.material
          hand.userData.item = model
        }
        // Sprites are drawn blade-up-right: turned edge-on so the blade points ahead,
        // with the handle (bottom-left of the sprite) in the hand.
        const size = model.block ? 0.28 : 0.62
        if (model.block) {
          tmp.position.set(0, -0.62, -0.1)
          tmp.rotation.set(0, 0.6, 0)
        } else {
          tmp.position.set(0, -0.6 + 0.3 * size, -0.3 * size)
          tmp.rotation.set(0, Math.PI / 2, 0)
        }
        tmp.scale.set(size, size, size)
        tmp.updateMatrix()
        hand.matrix.multiplyMatrices(handMatrix, tmp.matrix)
        hand.visible = true
      } else {
        hand.visible = false
      }
    }
    for (let i = list.length; i < MAX; i += 1) {
      hands[i].visible = false
      const label = labels[i]
      if (label?.shown) {
        label.el.style.display = 'none'
        label.shown = false
      }
    }
    parts.count = n
    capes.count = ci
    parts.instanceMatrix.needsUpdate = true
    if (parts.instanceColor) parts.instanceColor.needsUpdate = true
    capes.instanceMatrix.needsUpdate = true
    capeUvAttr.needsUpdate = true
  })

  return <primitive object={group} />
}

/** Who to draw this frame: everyone near enough, plus you in third person. */
const list = []
const selfEntry = { eid: -1, name: '', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 0, held: 'fist', speed: 0, walkPhase: 0, swingAt: 0, hurtAt: 0, cape: 'none', sword: 'classic', self: true }
function drawList(maxDist, camera) {
  list.length = 0
  for (const r of runtime.remotes.values()) {
    if (Math.hypot(r.x - camera.position.x, r.z - camera.position.z) <= maxDist) list.push(r)
  }
  const thirdPerson = runtime.camera.mode === 'third' || runtime.zone === 'lobby'
  if (thirdPerson && runtime.zone !== 'spec') {
    const p = runtime.player
    const game = getGame()
    const e = selfEntry
    e.eid = runtime.eid
    e.name = game.profile.name
    e.x = p.body.x
    e.y = p.body.y
    e.z = p.body.z
    e.yaw = p.yaw
    e.pitch = p.pitch
    e.anim = p.anim
    e.held = runtime.zone === 'match' ? runtime.me.inv?.[runtime.me.sel]?.id || 'fist' : runtime.zone === 'lobby' ? LOBBY_SWORD : 'fist'
    e.speed = p.speed
    e.walkPhase = p.walkPhase
    e.swingAt = runtime.swingAt
    e.cape = game.profile.cape
    e.sword = game.profile.sword
    list.push(selfEntry)
  }
  return list
}

const proj = new Vector3()
function placeLabel(label, c, camera, size, maxDist, now) {
  if (c.self) {
    if (label.shown) {
      label.el.style.display = 'none'
      label.shown = false
    }
    return
  }
  proj.set(c.x, c.y + 2.15, c.z)
  const d = proj.distanceTo(camera.position)
  proj.project(camera)
  const visible = d < maxDist && proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1
  if (!visible) {
    if (label.shown) {
      label.el.style.display = 'none'
      label.shown = false
    }
    return
  }
  if (!label.shown) {
    label.el.style.display = 'block'
    label.shown = true
  }
  // Whole pixels, and only when it moved: most frames a standing player costs no style write.
  const x = Math.round((proj.x * 0.5 + 0.5) * size.width)
  const y = Math.round((-proj.y * 0.5 + 0.5) * size.height)
  if (x !== label.px || y !== label.py) {
    label.px = x
    label.py = y
    label.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`
  }
  const shownName = c.vip ? `👑 ${c.name}` : c.name
  if (label.text !== shownName) {
    label.text = shownName
    label.name.textContent = shownName
    label.name.classList.toggle('np-vip', Boolean(c.vip))
  }
  const lvl = c.level ? String(c.level) : ''
  if (label.lvlText !== lvl) {
    label.lvlText = lvl
    label.lvl.textContent = lvl
    label.lvl.style.display = lvl ? 'inline-block' : 'none'
  }
  // Team modes: the label wears the team colour (teammates also get a marker).
  const team = runtime.teamSize > 1 && runtime.zone !== 'lobby' ? c.team ?? -1 : -1
  if (label.team !== team) {
    label.team = team
    const t = team >= 0 ? TEAMS[team % TEAMS.length] : null
    label.name.style.background = t ? `${t.color}cc` : ''
    label.name.style.color = t ? '#0d0a18' : ''
    label.name.textContent = team >= 0 && team === runtime.myTeam ? `▼ ${shownName}` : shownName
  }
  const bubble = quickBubble(c.eid, now) || bubbleFor(null, c.name, now) || ''
  if (bubble !== label.bubbleText) {
    label.bubbleText = bubble
    label.bubble.textContent = bubble
    label.bubble.style.display = bubble ? 'block' : 'none'
  }
}
