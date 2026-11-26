import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three'

import { mulberry32 } from '@shared/rng'

import { useGame } from '../store/game'
import { useQuality } from '../store/quality'
import { makeCrackTexture, makeLiquidTexture } from './art/atlas'
import { runtime } from './runtime'
import { worldState } from './world'

/**
 * The sky (a gradient dome that follows the camera, with the sun), drifting block clouds,
 * the lava sea of a round (or the lobby's water far below), floating embers / pollen,
 * and the outline + cracks on the block you're aiming at.
 */

/** Sky colours per world: zenith, the band above the horizon, the horizon (also the fog). */
const SKIES = {
  lobby: ['#3d9bff', '#8fd3ff', '#cdeeff'],
  meadow: ['#3b8cf0', '#86ccff', '#cbe9ff'],
  castle: ['#4b3fae', '#a98be0', '#ffcfa6'],
  ember: ['#2a0b1a', '#7a2236', '#ff8a4a'],
  autumn: ['#d9733a', '#f2b072', '#ffe6c4'],
  marble: ['#6f8be8', '#b9c6ff', '#f5efff'],
  jungle: ['#2f8f73', '#86d6b0', '#e2fff0'],
  mushroom: ['#6a43b0', '#c58be0', '#ffe0f2'],
  tropical: ['#1a9ee0', '#7fd6ff', '#e3f9ff'],
  bricktown: ['#4a86cc', '#a8c8ea', '#f3eadf'],
  frost: ['#5f8fd6', '#a9c8ef', '#eef5ff'],
  candy: ['#d56bd8', '#ffa3dc', '#ffe6f5'],
  desert: ['#4f9be8', '#ffc98a', '#fff0d9'],
}
/** Where the sun sits (unit vector). */
const SUN_DIR = [0.42, 0.38, -0.82]
const zenith = new Color()
const mid = new Color()
const horizon = new Color()
const sunCol = new Color('#fff3c4')
const tmpCol = new Color()

function skyDome() {
  const geo = new SphereGeometry(400, 32, 16)
  geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3))
  return geo
}

/** Paints the dome: three-stop gradient, brighter towards the sun. */
function paintSky(geo, colors) {
  zenith.set(colors[0])
  mid.set(colors[1])
  horizon.set(colors[2])
  const pos = geo.attributes.position
  const col = geo.attributes.color
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) / 400
    const y = pos.getY(i) / 400
    const z = pos.getZ(i) / 400
    const h = Math.max(0, y)
    if (h < 0.25) tmpCol.copy(horizon).lerp(mid, h / 0.25)
    else tmpCol.copy(mid).lerp(zenith, Math.min(1, (h - 0.25) / 0.6))
    if (y < 0) tmpCol.copy(horizon)
    const toSun = Math.max(0, x * SUN_DIR[0] + y * SUN_DIR[1] + z * SUN_DIR[2])
    tmpCol.lerp(sunCol, toSun ** 6 * 0.55)
    col.setXYZ(i, tmpCol.r, tmpCol.g, tmpCol.b)
  }
  col.needsUpdate = true
}

/** A soft round glow (the sun), drawn once into a small canvas. */
function glowTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,245,1)')
  g.addColorStop(0.12, 'rgba(255,250,220,1)')
  g.addColorStop(0.2, 'rgba(255,236,170,0.55)')
  g.addColorStop(0.5, 'rgba(255,220,150,0.12)')
  g.addColorStop(1, 'rgba(255,220,150,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** A unit box shaded like a cloud: bright top, soft grey-blue underside. */
function cloudGeometry() {
  const geo = new BoxGeometry(1, 1, 1)
  const shade = [
    [0.93, 0.95, 1],
    [0.93, 0.95, 1],
    [1, 1, 1],
    [0.78, 0.83, 0.93],
    [0.95, 0.96, 1],
    [0.9, 0.92, 0.99],
  ]
  const colors = []
  for (let f = 0; f < 6; f += 1) for (let v = 0; v < 4; v += 1) colors.push(...shade[f])
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

const MAX_CLOUDS = 48

export function Sky() {
  const zone = useGame((s) => s.zone)
  const map = useGame((s) => s.phase.map)
  const clouds = useQuality((s) => s.settings.cloudCount)
  const scene = useThree((s) => s.scene)
  const { dome, sun, cloudMesh, group } = useMemo(() => {
    const g = new Group()
    const d = new Mesh(skyDome(), new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }))
    d.renderOrder = -10
    const sn = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }))
    sn.renderOrder = -9
    sn.scale.set(150, 150, 1)
    const c = new InstancedMesh(cloudGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false, fog: false }), MAX_CLOUDS)
    c.frustumCulled = false
    c.renderOrder = -8
    g.add(d, sn, c)
    return { dome: d, sun: sn, cloudMesh: c, group: g }
  }, [])

  // Colours per map; the fog takes the horizon colour so far islands melt into the sky.
  useEffect(() => {
    const colors = SKIES[zone === 'lobby' ? 'lobby' : map] || SKIES.meadow
    paintSky(dome.geometry, colors)
    if (scene.fog) scene.fog.color.set(colors[2])
    scene.background = new Color(colors[2])
  }, [zone, map, dome, scene])

  // Two layers: big flat clouds overhead, and low banks out past the islands.
  useEffect(() => {
    const rng = mulberry32(7)
    const o = new Object3D()
    for (let i = 0; i < MAX_CLOUDS; i += 1) {
      const a = rng() * Math.PI * 2
      if (i % 3 === 2) {
        const r = 120 + rng() * 90
        o.position.set(56 + Math.cos(a) * r, 40 + rng() * 14, 56 + Math.sin(a) * r)
        o.scale.set(16 + rng() * 26, 4 + rng() * 4, 12 + rng() * 18)
      } else {
        const r = 30 + rng() * 170
        o.position.set(56 + Math.cos(a) * r, 72 + rng() * 14, 56 + Math.sin(a) * r)
        o.scale.set(10 + rng() * 22, 2.4 + rng() * 1.2, 8 + rng() * 14)
      }
      o.updateMatrix()
      cloudMesh.setMatrixAt(i, o.matrix)
    }
    cloudMesh.count = Math.min(MAX_CLOUDS, clouds)
    cloudMesh.instanceMatrix.needsUpdate = true
  }, [cloudMesh, clouds])

  useFrame(({ camera }, dt) => {
    dome.position.copy(camera.position)
    sun.position.set(camera.position.x + SUN_DIR[0] * 360, camera.position.y + SUN_DIR[1] * 360, camera.position.z + SUN_DIR[2] * 360)
    cloudMesh.position.x = ((cloudMesh.position.x + dt * 0.8 + 120) % 240) - 120
  })

  useEffect(
    () => () => {
      dome.geometry.dispose()
      dome.material.dispose()
      sun.material.map.dispose()
      sun.material.dispose()
      cloudMesh.geometry.dispose()
      cloudMesh.material.dispose()
    },
    [dome, sun, cloudMesh],
  )

  return <primitive object={group} />
}

/**
 * The lava sea in a round (rising with the clock), water far under the lobby. Each is a
 * base layer plus, from MEDIUM up, a second brighter layer drifting the other way on
 * top, so the surface churns (lava) or glints (water).
 */
export function Liquid() {
  const shimmer = useQuality((s) => s.settings.particles)
  const { lava, lavaGlow, water, waterGlint } = useMemo(() => {
    const geo = new PlaneGeometry(700, 700)
    geo.rotateX(-Math.PI / 2)
    const tex = (kind, repeat) => {
      const t = makeLiquidTexture(kind)
      t.repeat.set(repeat, repeat)
      return t
    }
    const l = new Mesh(geo, new MeshBasicMaterial({ map: tex('lava', 140) }))
    const lg = new Mesh(geo, new MeshBasicMaterial({ map: tex('lavaGlow', 90), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.7 }))
    const w = new Mesh(geo, new MeshBasicMaterial({ map: tex('water', 160), transparent: true, opacity: 0.94 }))
    const wg = new Mesh(geo, new MeshBasicMaterial({ map: tex('waterGlint', 110), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55 }))
    l.position.set(56, 6, 56)
    lg.position.set(56, 6.06, 56)
    w.position.set(36, 4, 36)
    wg.position.set(36, 4.05, 36)
    return { lava: l, lavaGlow: lg, water: w, waterGlint: wg }
  }, [])

  useFrame((_, dt) => {
    const inMatch = worldState.kind === 'match'
    lava.visible = inMatch
    lavaGlow.visible = inMatch && shimmer
    water.visible = !inMatch
    waterGlint.visible = !inMatch && shimmer
    const scroll = (mesh, sx, sz) => {
      const o = mesh.material.map.offset
      o.x = (o.x + dt * sx) % 1
      o.y = (o.y + dt * sz) % 1
    }
    scroll(lava, 0.02, 0.012)
    if (lavaGlow.visible) {
      scroll(lavaGlow, -0.013, 0.021)
      lavaGlow.material.opacity = 0.55 + Math.sin(performance.now() / 700) * 0.15
    }
    scroll(water, 0.01, 0.004)
    if (waterGlint.visible) scroll(waterGlint, -0.008, 0.011)
    if (inMatch) {
      lava.position.y = runtime.lava.y - 0.08
      lavaGlow.position.y = runtime.lava.y - 0.02
    }
  })

  useEffect(
    () => () => {
      lava.geometry.dispose()
      for (const m of [lava, lavaGlow, water, waterGlint]) {
        m.material.map.dispose()
        m.material.dispose()
      }
    },
    [lava, lavaGlow, water, waterGlint],
  )

  return (
    <>
      <primitive object={lava} />
      <primitive object={lavaGlow} />
      <primitive object={water} />
      <primitive object={waterGlint} />
    </>
  )
}

const MAX_MOTES = 80
const _mote = new Object3D()

/**
 * Floating motes around you: embers rising off the lava in a round, drifting pollen in
 * the lobby. MEDIUM and HIGH only (one instanced mesh, positions from a fixed pool).
 */
export function Motes() {
  const enabled = useQuality((s) => s.settings.particles)
  const { mesh, motes } = useMemo(() => {
    const m = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: AdditiveBlending, depthWrite: false }), MAX_MOTES)
    m.frustumCulled = false
    const rng = mulberry32(11)
    const list = Array.from({ length: MAX_MOTES }, () => ({ ox: rng() * 60 - 30, oz: rng() * 60 - 30, h: rng(), speed: 0.3 + rng() * 0.7, phase: rng() * 6.3, size: 0.05 + rng() * 0.07 }))
    return { mesh: m, motes: list }
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  useFrame(({ camera }) => {
    mesh.visible = enabled
    if (!enabled) return
    const t = performance.now() / 1000
    const inMatch = worldState.kind === 'match'
    mesh.material.color.set(inMatch ? '#ff8a2a' : '#fff6c8')
    const cx = camera.position.x
    const cz = camera.position.z
    const base = inMatch ? runtime.lava.y : camera.position.y - 6
    const span = inMatch ? 28 : 14
    for (let i = 0; i < MAX_MOTES; i += 1) {
      const m = motes[i]
      // Each rises through its band and wraps; the field repeats around the camera.
      const h = (m.h + t * m.speed * (inMatch ? 0.05 : 0.015)) % 1
      const x = cx + ((((m.ox + Math.sin(t * 0.4 + m.phase) * 2 - cx) % 60) + 90) % 60) - 30
      const z = cz + ((((m.oz + Math.cos(t * 0.3 + m.phase) * 2 - cz) % 60) + 90) % 60) - 30
      _mote.position.set(x, base + h * span, z)
      _mote.rotation.set(t + m.phase, t * 0.7, 0)
      _mote.scale.setScalar(m.size * Math.sin(h * Math.PI))
      _mote.updateMatrix()
      mesh.setMatrixAt(i, _mote.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive object={mesh} />
}

/**
 * Black outline on the block you're aiming at, its cracks while you break it, and a
 * glowing see-through box where a held block would go (Player.findPlacement).
 */
export function BlockOutline() {
  const { outline, crack, ghost } = useMemo(() => {
    const box = new BoxGeometry(1.004, 1.004, 1.004)
    const o = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: '#111111', transparent: true, opacity: 0.7 }))
    o.visible = false
    const tex = makeCrackTexture()
    tex.repeat.set(1, 0.2)
    const c = new Mesh(
      new BoxGeometry(1.006, 1.006, 1.006),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    c.visible = false
    const gBox = new BoxGeometry(1.002, 1.002, 1.002)
    const g = new Mesh(gBox, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false }))
    const gEdges = new LineSegments(new EdgesGeometry(gBox), new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95 }))
    g.add(gEdges)
    g.visible = false
    return { outline: o, crack: c, ghost: g }
  }, [])

  useFrame(() => {
    const t = runtime.target
    const show = t.kind === 'block' && runtime.zone === 'match'
    outline.visible = show
    const pl = runtime.place
    ghost.visible = pl.ok && runtime.zone === 'match'
    if (ghost.visible) {
      ghost.position.set(pl.x + 0.5, pl.y + 0.5, pl.z + 0.5)
      ghost.material.opacity = 0.16 + Math.sin(performance.now() / 160) * 0.08
    }
    if (show) outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5)
    const d = runtime.dig
    const digging = show && d.progress > 0.02 && d.x === t.x && d.y === t.y && d.z === t.z
    crack.visible = digging
    if (digging) {
      crack.position.set(d.x + 0.5, d.y + 0.5, d.z + 0.5)
      const stage = Math.min(4, Math.floor(d.progress * 5))
      crack.material.map.offset.y = stage * 0.2
    }
  })

  useEffect(
    () => () => {
      outline.geometry.dispose()
      outline.material.dispose()
      crack.geometry.dispose()
      crack.material.map.dispose()
      crack.material.dispose()
      ghost.geometry.dispose()
      ghost.material.dispose()
      ghost.children[0].geometry.dispose()
      ghost.children[0].material.dispose()
    },
    [outline, crack, ghost],
  )

  return (
    <>
      <primitive object={outline} />
      <primitive object={crack} />
      <primitive object={ghost} />
    </>
  )
}
