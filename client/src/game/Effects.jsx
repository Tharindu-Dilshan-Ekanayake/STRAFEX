import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from 'three'

import { PROJECTILES } from '@shared/balance'
import { isSolidBlock } from '@shared/voxel'

import { sfx } from '../audio/sfx'
import { getQuality } from '../store/quality'
import { blockColor } from './art/atlas'
import { killFxBurst } from './art/killfx'
import { runtime } from './runtime'
import { worldState } from './world'

/**
 * Short-lived effects, all pooled (fixed-size instanced meshes, nothing allocated while
 * playing): block chips, hit sparks and crits, shield blocks, revive charms, mace
 * smashes, gust bursts, potion splashes, explosions, and thrown things and arrows.
 * Particles are skipped on the LOW preset (the burst flashes and projectiles stay:
 * they're gameplay).
 */

const MAX_PARTICLES = 220
const MAX_PROJ = 32
const MAX_BOOMS = 6
const MAX_POPS = 12
const POP_S = 0.22

let vignette = null
let lastVignette = -1
const tmp = new Object3D()
const col = new Color()

/** Pool of particle state, parallel to the instanced mesh. */
function makeParticles() {
  return Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.1, g: 18, r: 1, gc: 1, b: 1 }))
}

let lastFlames = 0
let lastBeat = 0
let lastCrackle = 0
let lastBubble = 0
let burnEl = null
let lastBurn = false
/** Whether you're on fire right now (the host's `me.effects.burn`, counted down here). */
function selfBurning(now) {
  const left = runtime.me.effects?.burn
  return Boolean(left && runtime.me.alive !== false && now - (runtime.me.effectsAt || 0) < left)
}

export default function Effects() {
  const pools = useMemo(() => {
    const group = new Group()
    const cube = new BoxGeometry(1, 1, 1)
    const particles = new InstancedMesh(cube, new MeshBasicMaterial({ color: '#ffffff' }), MAX_PARTICLES)
    particles.instanceMatrix.setUsage(DynamicDrawUsage)
    particles.frustumCulled = false
    particles.count = 0
    const projMeshes = Array.from({ length: MAX_PROJ }, () => {
      const m = new Mesh(cube, new MeshBasicMaterial({ color: '#ffffff' }))
      m.visible = false
      group.add(m)
      return m
    })
    const booms = Array.from({ length: MAX_BOOMS }, () => {
      const m = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: '#fff1c4', transparent: true, blending: AdditiveBlending, depthWrite: false }))
      m.visible = false
      group.add(m)
      return m
    })
    // Block place pops: a bright shell that swells off the new block and fades (additive,
    // so the instance colour is its brightness - black is invisible).
    const pops = new InstancedMesh(cube, new MeshBasicMaterial({ color: '#ffffff', blending: AdditiveBlending, transparent: true, depthWrite: false }), MAX_POPS)
    pops.instanceMatrix.setUsage(DynamicDrawUsage)
    pops.frustumCulled = false
    pops.count = 0
    group.add(pops)
    group.add(particles)
    return {
      group,
      particles,
      parts: makeParticles(),
      projMeshes,
      projs: Array.from({ length: MAX_PROJ }, () => ({ id: 0, kind: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false, stuck: 0 })),
      booms,
      boomState: booms.map(() => ({ t: 0, r: 1 })),
      nextPart: 0,
      digChipsAt: 0,
      pops,
      popState: Array.from({ length: MAX_POPS }, () => ({ t: 0, x: 0, y: 0, z: 0 })),
      nextPop: 0,
    }
  }, [])

  // Events queued while we weren't mounted (in the lobby) are stale.
  useEffect(() => {
    runtime.fx.length = 0
  }, [])

  useEffect(
    () => () => {
      pools.particles.geometry.dispose()
      pools.particles.material.dispose()
      pools.pops.material.dispose()
      for (const m of pools.projMeshes) m.material.dispose()
      for (const m of pools.booms) {
        m.geometry.dispose()
        m.material.dispose()
      }
    },
    [pools],
  )

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(0.05, rawDt)
    const now = performance.now()
    const q = getQuality()
    const P = pools

    /** A bright expanding shell (explosions, bursts): pooled, shown on every preset. */
    const flash = (x, y, z, r, color) => {
      const i = P.boomState.findIndex((b) => b.t <= 0)
      const k = i >= 0 ? i : 0
      P.boomState[k].t = 0.35
      P.boomState[k].r = r
      P.booms[k].position.set(x, y, z)
      P.booms[k].material.color.set(color)
      P.booms[k].visible = true
    }
    const spawn = (x, y, z, color, count, speed = 3, size = 0.12, life = 0.7, gravity = 18) => {
      if (!q.particles) return
      for (let i = 0; i < count; i += 1) {
        const p = P.parts[P.nextPart]
        P.nextPart = (P.nextPart + 1) % MAX_PARTICLES
        p.life = p.max = life * (0.6 + Math.random() * 0.6)
        p.x = x + (Math.random() - 0.5) * 0.6
        p.y = y + (Math.random() - 0.5) * 0.6
        p.z = z + (Math.random() - 0.5) * 0.6
        p.vx = (Math.random() - 0.5) * speed
        p.vy = Math.random() * speed * 0.9 + speed * 0.3
        p.vz = (Math.random() - 0.5) * speed
        p.s = size * (0.6 + Math.random() * 0.8)
        p.g = gravity
        p.r = color[0]
        p.gc = color[1]
        p.b = color[2]
      }
    }

    // New events from the network and the controller.
    for (const fx of runtime.fx) {
      switch (fx.type) {
        case 'break':
          spawn(fx.x + 0.5, fx.y + 0.5, fx.z + 0.5, blockColor(fx.id), fx.quiet ? 6 : 12, 3.5)
          break
        case 'kfx': {
          // The killer's kill effect: a burst in its colours, and its flash (every preset).
          const b = killFxBurst(fx.fx)
          if (!b) break
          const per = Math.ceil(b.count / b.colors.length)
          for (const c of b.colors) spawn(fx.x, fx.y + 1, fx.z, c, per, b.speed, 0.16, 1.1, b.gravity)
          flash(fx.x, fx.y + 1, fx.z, 1.9, b.flash)
          break
        }
        case 'pad':
          spawn(fx.x, fx.y + 0.1, fx.z, [0.4, 1, 0.5], 12, 3, 0.1, 0.5, 6)
          break
        case 'crit':
          spawn(fx.x, fx.y, fx.z, [1, 1, 0.85], 10, 4, 0.08, 0.5, 6)
          break
        case 'blocked':
          spawn(fx.x, fx.y, fx.z, [0.85, 0.65, 0.4], 6, 2.5, 0.08, 0.35, 12)
          break
        case 'charm':
          // A burst of gold and green, rising.
          spawn(fx.x, fx.y, fx.z, [1, 0.85, 0.25], 26, 5, 0.14, 1.2, -3)
          spawn(fx.x, fx.y, fx.z, [0.35, 1, 0.5], 18, 4, 0.12, 1.1, -2)
          flash(fx.x, fx.y, fx.z, 1.6, '#fff2a0')
          break
        case 'smash': {
          // The mace lands: a ring of dust and stone chips.
          const n = fx.big ? 18 : 10
          for (let k = 0; k < n; k += 1) {
            const a = (k / n) * Math.PI * 2
            spawn(fx.x + Math.cos(a) * 0.8, fx.y + 0.15, fx.z + Math.sin(a) * 0.8, [0.6, 0.58, 0.55], 1, 3, 0.16, 0.6, 14)
          }
          flash(fx.x, fx.y + 0.3, fx.z, fx.big ? 2.2 : 1.4, '#e8e2d6')
          break
        }
        case 'gust':
          spawn(fx.x, fx.y, fx.z, [0.9, 0.97, 1], fx.small ? 6 : 22, fx.small ? 2 : 6, 0.12, 0.6, -2)
          if (!fx.small) flash(fx.x, fx.y, fx.z, 2.6, '#cfeeff')
          break
        case 'splash':
          col.set(fx.color || '#ff4f6d')
          spawn(fx.x, fx.y, fx.z, [col.r, col.g, col.b], 24, 4, 0.1, 0.8, 8)
          flash(fx.x, fx.y, fx.z, 2, fx.color || '#ff4f6d')
          break
        case 'place': {
          const ps = P.popState[P.nextPop]
          P.nextPop = (P.nextPop + 1) % MAX_POPS
          ps.t = POP_S
          ps.x = fx.x + 0.5
          ps.y = fx.y + 0.5
          ps.z = fx.z + 0.5
          spawn(ps.x, fx.y + 0.05, ps.z, blockColor(fx.id), 4, 1.6, 0.07, 0.35, 10)
          break
        }
        case 'poof':
          spawn(fx.x, fx.y, fx.z, [0.92, 0.92, 0.95], 16, 2.2, 0.26, 0.9, -1.5)
          spawn(fx.x, fx.y, fx.z, [0.6, 0.6, 0.66], 10, 1.6, 0.2, 1.1, -1)
          break
        case 'use': {
          // Someone eating (crumbs), drinking (a coloured swirl) or eating a heart (sparkles).
          const c = fx.kind === 'food' ? [0.75, 0.45, 0.2] : fx.kind === 'heart' ? [1, 0.25, 0.4] : [1, 0.45, 0.85]
          spawn(fx.x, fx.y, fx.z, c, 8, 1.6, 0.07, 0.6, fx.kind === 'food' ? 12 : -2)
          break
        }
        case 'hit':
          spawn(fx.x, fx.y, fx.z, [0.9, 0.1, 0.1], 7, 2.5, 0.09, 0.45)
          break
        case 'boom':
          spawn(fx.x, fx.y, fx.z, [0.45, 0.45, 0.45], 30, 9, 0.3, 1.2, 4)
          spawn(fx.x, fx.y, fx.z, [1, 0.45, 0.95], 20, 7, 0.22, 0.6, 2)
          flash(fx.x, fx.y, fx.z, fx.r, '#ffd6f6')
          break
        case 'proj': {
          const slot = P.projs.find((p) => !p.alive) || P.projs[0]
          Object.assign(slot, { id: fx.id, kind: fx.kind, x: fx.x, y: fx.y, z: fx.z, vx: fx.vx, vy: fx.vy, vz: fx.vz, alive: true, stuck: 0, fire: Boolean(fx.fire) })
          break
        }
        case 'chest':
          spawn(fx.x, fx.y, fx.z, [1, 0.85, 0.3], 22, 3.5, 0.12, 0.8, 4)
          flash(fx.x, fx.y, fx.z, 1.4, '#ffe27a')
          break
        case 'ignite':
          spawn(fx.x, fx.y + 0.3, fx.z, [1, 0.55, 0.12], 18, 3, 0.14, 0.7, -4)
          flash(fx.x, fx.y + 0.4, fx.z, 1.6, '#ff8a1a')
          break
        case 'douse':
          spawn(fx.x, fx.y, fx.z, [0.35, 0.6, 1], 20, 3.5, 0.11, 0.7, 10)
          spawn(fx.x, fx.y + 0.4, fx.z, [0.85, 0.88, 0.92], 8, 1.2, 0.2, 0.9, -3)
          break
        case 'projEnd': {
          const p = P.projs.find((s) => s.alive && s.id === fx.id)
          if (p) {
            p.x = fx.x
            p.y = fx.y
            p.z = fx.z
            if (p.kind === 'arrow') p.stuck = now + 1500
            else p.alive = false
            if (p.kind !== 'gust' && p.kind !== 'splash') spawn(fx.x, fx.y, fx.z, p.kind === 'pearl' ? [0.4, 1, 0.85] : [1, 1, 1], 8, 2.5, 0.08, 0.5)
          }
          break
        }
        default:
      }
    }
    runtime.fx.length = 0

    // Other players mining: chips fly off the block they're on while they swing.
    if (q.particles && now - P.digChipsAt > 160 && worldState.world) {
      P.digChipsAt = now
      for (const r of runtime.remotes.values()) {
        const d = r.digAt
        if (!d || now - d.t > 4000 || now - r.swingAt > 450) continue
        const id = worldState.world.get(d.x, d.y, d.z)
        if (!id) {
          r.digAt = null
          continue
        }
        if (Math.hypot(d.x - camera.position.x, d.z - camera.position.z) < 40) spawn(d.x + 0.5, d.y + 0.6, d.z + 0.5, blockColor(id), 2, 2.2, 0.08, 0.4)
      }
    }

    // Particles.
    let n = 0
    for (const p of P.parts) {
      if (p.life <= 0) continue
      p.life -= dt
      p.vy -= p.g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const s = p.s * Math.min(1, (p.life / p.max) * 2.5)
      tmp.position.set(p.x, p.y, p.z)
      tmp.rotation.set(p.x * 3, p.y * 3, 0)
      tmp.scale.set(s, s, s)
      tmp.updateMatrix()
      P.particles.setMatrixAt(n, tmp.matrix)
      col.setRGB(p.r, p.gc, p.b)
      P.particles.setColorAt(n, col)
      n += 1
    }
    P.particles.count = n
    P.particles.instanceMatrix.needsUpdate = true
    if (P.particles.instanceColor) P.particles.instanceColor.needsUpdate = true

    // Place pops.
    let pn = 0
    for (const ps of P.popState) {
      if (ps.t <= 0) continue
      ps.t -= dt
      const k = 1 - Math.max(0, ps.t) / POP_S
      const sc = 1.02 + k * 0.16
      tmp.position.set(ps.x, ps.y, ps.z)
      tmp.rotation.set(0, 0, 0)
      tmp.scale.set(sc, sc, sc)
      tmp.updateMatrix()
      P.pops.setMatrixAt(pn, tmp.matrix)
      const b = (1 - k) * (1 - k) * 0.55
      P.pops.setColorAt(pn, col.setRGB(b, b, b * 0.9))
      pn += 1
    }
    P.pops.count = pn
    P.pops.visible = pn > 0
    if (pn) {
      P.pops.instanceMatrix.needsUpdate = true
      if (P.pops.instanceColor) P.pops.instanceColor.needsUpdate = true
    }

    // People on fire: flames rising off them (you too, seen from outside).
    if (q.particles && now - lastFlames > 90) {
      lastFlames = now
      for (const r of runtime.remotes.values()) if (r.burning) spawn(r.x, r.y + 0.9, r.z, [1, 0.5 + Math.random() * 0.2, 0.1], 2, 1, 0.09, 0.4, -4)
      if (selfBurning(now) && runtime.camera.mode === 'third') {
        const b = runtime.player.body
        spawn(b.x, b.y + 0.9, b.z, [1, 0.55, 0.1], 2, 1, 0.09, 0.4, -4)
      }
    }
    // Sounds of your state: a heartbeat when you're low, crackling while you burn,
    // bubbles when you're running out of air.
    const me = runtime.me
    if (runtime.zone === 'match' && me.alive !== false) {
      if (me.hp > 0 && me.hp <= 6 && now - lastBeat > (me.hp <= 3 ? 650 : 950)) {
        lastBeat = now
        sfx.heartbeat(me.hp <= 3 ? 1 : 0.7)
      }
      if (selfBurning(now) && now - lastCrackle > 300) {
        lastCrackle = now
        sfx.crackle()
      }
      if (me.air !== undefined && me.air < 10 && now - lastBubble > 600) {
        lastBubble = now
        sfx.bubble(me.air <= 2 ? 1 : 0.6)
      }
    }
    // On fire yourself: the edges of the screen burn (every preset).
    burnEl ||= document.getElementById('burn-vignette')
    if (burnEl) {
      const on = selfBurning(now)
      if (on !== lastBurn) {
        lastBurn = on
        burnEl.classList.toggle('on', on)
      }
    }

    // Projectiles: same arc as the host simulates.
    P.projs.forEach((p, i) => {
      const mesh = P.projMeshes[i]
      if (!p.alive) {
        mesh.visible = false
        return
      }
      if (p.stuck) {
        if (now > p.stuck) p.alive = false
      } else {
        const spec = PROJECTILES[p.kind] || PROJECTILES.snowball
        p.vy -= spec.gravity * dt
        const nx = p.x + p.vx * dt
        const ny = p.y + p.vy * dt
        const nz = p.z + p.vz * dt
        if (worldState.world && isSolidBlock(worldState.world.get(nx, ny, nz))) {
          if (p.kind === 'arrow') p.stuck = now + 1500
          else p.alive = false
        } else {
          p.x = nx
          p.y = ny
          p.z = nz
        }
        if (p.y < -20) p.alive = false
      }
      mesh.visible = p.alive
      mesh.position.set(p.x, p.y, p.z)
      // A fire arrow trails sparks.
      if (p.alive && p.fire && !p.stuck) spawn(p.x, p.y, p.z, [1, 0.5, 0.1], 1, 0.4, 0.1, 0.35, -1)
      if (p.kind === 'arrow') {
        mesh.scale.set(0.06, 0.06, 0.7)
        if (!p.stuck) mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz)
        mesh.material.color.set(p.fire ? '#ff8a1a' : '#c9b48a')
      } else {
        mesh.scale.setScalar(p.kind === 'gust' ? 0.36 : 0.25)
        mesh.rotation.set(now / 120, now / 90, 0)
        mesh.material.color.set(p.kind === 'pearl' ? '#1f9c85' : p.kind === 'gust' ? '#cfeeff' : p.kind === 'splash' ? '#ff4f6d' : '#ffffff')
      }
    })

    // Explosion flashes.
    P.booms.forEach((m, i) => {
      const b = P.boomState[i]
      if (b.t <= 0) {
        m.visible = false
        return
      }
      b.t -= dt
      const k = 1 - b.t / 0.35
      m.scale.setScalar(b.r * (0.4 + k * 0.9))
      m.material.opacity = Math.max(0, 1 - k)
    })

    // A red edge to the screen right after a hit (a DOM element, set directly).
    vignette ||= document.getElementById('hurt-vignette')
    if (vignette) {
      const o = Math.min(0.85, runtime.camera.hurtTilt)
      if (o !== lastVignette) {
        lastVignette = o
        vignette.style.opacity = String(o)
      }
    }
  })

  return <primitive object={pools.group} />
}
