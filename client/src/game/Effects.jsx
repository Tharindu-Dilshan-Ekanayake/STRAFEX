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
import { isLucky, isSolidBlock } from '@shared/voxel'

import { getQuality } from '../store/quality'
import { blockColor } from './art/atlas'
import { itemModel } from './art/items'
import { runtime } from './runtime'
import { worldState } from './world'

/**
 * Short-lived effects, all pooled (fixed-size instanced meshes, nothing allocated while
 * playing): block chips, lucky-block bursts, hit sparks, explosions, lit TNT, lightning,
 * thrown things and arrows, and the sparkle over lucky blocks. Particles and sparkles
 * are skipped on the LOW preset.
 */

const MAX_PARTICLES = 220
const MAX_PROJ = 32
const MAX_TNT = 12
const MAX_BOOMS = 4
const MAX_SPARKLES = 96
const MAX_POPS = 12
const POP_S = 0.22

let vignette = null
let lastVignette = -1
const tmp = new Object3D()
const col = new Color()
const WHITE = new Color('#ffffff')

/** Pool of particle state, parallel to the instanced mesh. */
function makeParticles() {
  return Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.1, g: 18, r: 1, gc: 1, b: 1 }))
}

export default function Effects() {
  const pools = useMemo(() => {
    const group = new Group()
    const cube = new BoxGeometry(1, 1, 1)
    const particles = new InstancedMesh(cube, new MeshBasicMaterial({ color: '#ffffff' }), MAX_PARTICLES)
    particles.instanceMatrix.setUsage(DynamicDrawUsage)
    particles.frustumCulled = false
    particles.count = 0
    const sparkles = new InstancedMesh(cube, new MeshBasicMaterial({ color: '#fff4a8', blending: AdditiveBlending, transparent: true, depthWrite: false }), MAX_SPARKLES)
    sparkles.frustumCulled = false
    sparkles.count = 0
    const projMeshes = Array.from({ length: MAX_PROJ }, () => {
      const m = new Mesh(cube, new MeshBasicMaterial({ color: '#ffffff' }))
      m.visible = false
      group.add(m)
      return m
    })
    const tntModel = itemModel('tnt')
    const tnt = new InstancedMesh(tntModel.geometry, tntModel.material, MAX_TNT)
    tnt.frustumCulled = false
    tnt.count = 0
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
    const bolt = new Mesh(new BoxGeometry(0.35, 60, 0.35), new MeshBasicMaterial({ color: '#e8f4ff', transparent: true, blending: AdditiveBlending, depthWrite: false }))
    bolt.visible = false
    group.add(particles, sparkles, tnt, bolt)
    return {
      group,
      particles,
      parts: makeParticles(),
      sparkles,
      projMeshes,
      projs: Array.from({ length: MAX_PROJ }, () => ({ id: 0, kind: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false, stuck: 0 })),
      tnt,
      tnts: [],
      booms,
      boomState: booms.map(() => ({ t: 0, r: 1 })),
      bolt,
      boltUntil: 0,
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
      pools.sparkles.material.dispose()
      pools.pops.material.dispose()
      for (const m of pools.projMeshes) m.material.dispose()
      for (const m of pools.booms) {
        m.geometry.dispose()
        m.material.dispose()
      }
      pools.bolt.geometry.dispose()
      pools.bolt.material.dispose()
    },
    [pools],
  )

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(0.05, rawDt)
    const now = performance.now()
    const q = getQuality()
    const P = pools

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
        case 'pop':
          spawn(fx.x + 0.5, fx.y + 0.5, fx.z + 0.5, fx.bad ? [0.3, 0.3, 0.3] : fx.rare ? [0.75, 0.4, 1] : [1, 0.85, 0.2], 24, 6, 0.14, 0.9, 10)
          spawn(fx.x + 0.5, fx.y + 0.5, fx.z + 0.5, [1, 1, 1], 10, 5, 0.08, 0.6, 6)
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
        case 'boom': {
          spawn(fx.x, fx.y, fx.z, [0.45, 0.45, 0.45], 30, 9, 0.3, 1.2, 4)
          spawn(fx.x, fx.y, fx.z, [1, 0.55, 0.1], 20, 7, 0.22, 0.6, 2)
          const i = P.boomState.findIndex((b) => b.t <= 0)
          const k = i >= 0 ? i : 0
          P.boomState[k].t = 0.35
          P.boomState[k].r = fx.r
          P.booms[k].position.set(fx.x, fx.y, fx.z)
          P.booms[k].visible = true
          // The TNT that blew is no longer lit.
          for (const t of P.tnts) if (Math.abs(t.x + 0.5 - fx.x) < 0.6 && Math.abs(t.y + 0.5 - fx.y) < 0.6 && Math.abs(t.z + 0.5 - fx.z) < 0.6) t.until = 0
          break
        }
        case 'tnt':
          if (P.tnts.length < MAX_TNT) P.tnts.push({ x: fx.x, y: fx.y, z: fx.z, until: now + fx.fuse + 150 })
          break
        case 'bolt':
          P.bolt.position.set(fx.x, fx.y + 30, fx.z)
          P.bolt.visible = true
          P.boltUntil = now + 260
          spawn(fx.x, fx.y + 0.2, fx.z, [0.85, 0.95, 1], 16, 5, 0.1, 0.5)
          break
        case 'proj': {
          const slot = P.projs.find((p) => !p.alive) || P.projs[0]
          Object.assign(slot, { id: fx.id, kind: fx.kind, x: fx.x, y: fx.y, z: fx.z, vx: fx.vx, vy: fx.vy, vz: fx.vz, alive: true, stuck: 0 })
          break
        }
        case 'projEnd': {
          const p = P.projs.find((s) => s.alive && s.id === fx.id)
          if (p) {
            p.x = fx.x
            p.y = fx.y
            p.z = fx.z
            if (p.kind === 'arrow') p.stuck = now + 1500
            else p.alive = false
            spawn(fx.x, fx.y, fx.z, p.kind === 'pearl' ? [0.4, 1, 0.85] : [1, 1, 1], 8, 2.5, 0.08, 0.5)
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
      if (p.kind === 'arrow') {
        mesh.scale.set(0.06, 0.06, 0.7)
        if (!p.stuck) mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz)
        mesh.material.color.set('#c9b48a')
      } else {
        mesh.scale.setScalar(0.25)
        mesh.rotation.set(0, 0, 0)
        mesh.material.color.set(p.kind === 'pearl' ? '#1f9c85' : '#ffffff')
      }
    })

    // Lit TNT: a flashing cube until it blows.
    let tn = 0
    for (let i = P.tnts.length - 1; i >= 0; i -= 1) {
      const t = P.tnts[i]
      if (now > t.until) {
        P.tnts.splice(i, 1)
        continue
      }
      const left = t.until - now
      const swell = 1 + Math.max(0, 1 - left / 400) * 0.15
      tmp.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5)
      tmp.rotation.set(0, 0, 0)
      tmp.scale.setScalar(1.01 * swell)
      tmp.updateMatrix()
      P.tnt.setMatrixAt(tn, tmp.matrix)
      const flash = Math.floor(now / (left < 800 ? 90 : 200)) % 2
      P.tnt.setColorAt(tn, flash ? WHITE : col.setRGB(2.2, 2.2, 2.2))
      tn += 1
    }
    P.tnt.count = tn
    P.tnt.instanceMatrix.needsUpdate = true
    if (P.tnt.instanceColor) P.tnt.instanceColor.needsUpdate = true

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

    // Lightning.
    if (P.bolt.visible) {
      P.bolt.material.opacity = Math.floor(now / 50) % 2 ? 1 : 0.4
      if (now > P.boltUntil) P.bolt.visible = false
    }

    // Sparkles drifting up around each lucky block still standing.
    let sn = 0
    const gen = worldState.gen
    if (q.sparkles && gen && worldState.kind === 'match') {
      const cx = camera.position.x
      const cz = camera.position.z
      for (let i = 0; i < gen.lucky.length && sn < MAX_SPARKLES - 2; i += 1) {
        const l = gen.lucky[i]
        if (Math.hypot(l.x - cx, l.z - cz) > 45) continue
        if (!isLucky(worldState.world.get(l.x, l.y, l.z))) continue
        for (let k = 0; k < 2; k += 1) {
          const t = (now / 1400 + i * 0.37 + k * 0.5) % 1
          const a = i * 2.1 + k * 3.1 + t * 2
          tmp.position.set(l.x + 0.5 + Math.cos(a) * 0.75, l.y + t * 1.6, l.z + 0.5 + Math.sin(a) * 0.75)
          tmp.rotation.set(t * 4, t * 3, 0)
          tmp.scale.setScalar(0.09 * Math.sin(t * Math.PI))
          tmp.updateMatrix()
          P.sparkles.setMatrixAt(sn, tmp.matrix)
          sn += 1
        }
      }
    }
    P.sparkles.count = sn
    P.sparkles.instanceMatrix.needsUpdate = true

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
