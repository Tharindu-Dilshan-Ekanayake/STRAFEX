import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'

import { ITEMS, OFFHAND } from '@shared/balance'

import { getGame } from '../store/game'
import { itemModel } from './art/items'
import { recordFrame } from './perf'
import { runtime } from './runtime'

/**
 * The first-person hand and the item in it, drawn in a second pass over the world with
 * the depth cleared, so it never pokes into walls. This component also owns the frame's
 * main render (a useFrame with priority 1 replaces R3F's automatic render).
 */

function armGeometry() {
  const geo = new BoxGeometry(0.22, 0.22, 0.75)
  const shade = [0.85, 0.7, 1, 0.55, 0.9, 0.75]
  const colors = []
  for (let f = 0; f < 6; f += 1) for (let v = 0; v < 4; v += 1) colors.push(shade[f], shade[f], shade[f])
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

export default function ViewModel() {
  const size = useThree((s) => s.size)
  const { scene, camera, holder, arm, item, offHolder, offItem, equip } = useMemo(() => {
    const sc = new Scene()
    const cam = new PerspectiveCamera(70, 1, 0.01, 10)
    const h = new Group()
    const a = new Mesh(armGeometry(), new MeshBasicMaterial({ vertexColors: true, color: new Color('#e0ac7e') }))
    const it = new Mesh(undefined, undefined)
    it.visible = false
    h.add(a, it)
    // The left hand: whatever is in the offhand, low on the left of the screen.
    const oh = new Group()
    const oit = new Mesh(undefined, undefined)
    oit.visible = false
    oh.add(oit)
    sc.add(h, oh)
    return { scene: sc, camera: cam, holder: h, arm: a, item: it, offHolder: oh, offItem: oit, equip: { held: '', at: 0 } }
  }, [])

  useEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height)
    camera.updateProjectionMatrix()
  }, [camera, size])

  useEffect(
    () => () => {
      arm.geometry.dispose()
      arm.material.dispose()
    },
    [arm],
  )

  useFrame(({ gl, scene: world, camera: worldCamera }) => {
    recordFrame(gl)
    gl.autoClear = true
    gl.render(world, worldCamera)

    const p = runtime.player
    const show = runtime.camera.mode === 'first' && runtime.zone === 'match' && runtime.me.alive && !getGame().panel
    if (!show) return
    const now = performance.now()
    const offId = runtime.me.inv?.[OFFHAND]?.id || null
    // Blocking with the offhand's shield raises it on the left; the right hand keeps its item.
    const offBlocking = runtime.blocking && offId === 'shield'
    const blocking = runtime.blocking && !offBlocking
    const held = blocking ? 'shield' : runtime.me.inv?.[runtime.me.sel]?.id || 'fist'
    const def = ITEMS[held]
    const model = itemModel(held, getGame().profile.sword)

    // Bob with your steps, sway on landing, swing on hits and digging.
    const walk = p.grounded ? Math.min(1, p.speed / 5) : 0
    const bobX = Math.cos(p.walkPhase) * 0.035 * walk
    const bobY = Math.abs(Math.sin(p.walkPhase)) * 0.04 * walk
    const swingT = (now - runtime.swingAt) / 260
    const swing = swingT >= 0 && swingT < 1 ? Math.sin(swingT * Math.PI) : 0
    // Holding to eat: the food comes up to your mouth and bobs; a quick dip once it's done.
    const chewing = runtime.eatStart ? Math.min(1, (now - runtime.eatStart) / 200) * (0.8 + Math.sin(now / 70) * 0.2) : 0
    const eating = Math.max(chewing, now < runtime.useAnimUntil ? Math.sin(((runtime.useAnimUntil - now) / 350) * Math.PI) : 0)
    const pull = runtime.bowPullAt ? Math.min(1, (now - runtime.bowPullAt) / 900) : 0
    // A new item comes up from below the screen with a little overshoot.
    if (held !== equip.held) {
      equip.held = held
      equip.at = now
    }
    const e = Math.min(1, (now - equip.at) / 240)
    const raise = 1 - e
    const settle = e < 1 ? Math.sin(e * Math.PI) * 0.06 : 0
    const landT = (now - runtime.camera.landAt) / 260
    const land = landT >= 0 && landT < 1 ? Math.sin(landT * Math.PI) * (1 - landT) * runtime.camera.landAmp : 0

    // How far right the hand can go and still be on screen (narrow in portrait).
    const halfW = Math.tan((35 * Math.PI) / 180) * camera.aspect * 0.62
    const handX = Math.min(0.42, halfW * 0.72)
    // A little smaller on a tall, narrow screen so it doesn't fill it.
    holder.scale.setScalar(camera.aspect < 1 ? 0.8 : 1)
    holder.position.set(handX + bobX - eating * 0.2 - pull * 0.15, -0.36 - bobY + eating * 0.12 - swing * 0.06 - raise * raise * 0.45 + settle * 0.3 - land * 0.08, -0.62 + swing * 0.05)
    holder.rotation.set(-swing * 0.9 + eating * 0.4 - raise * 0.7 + land * 0.15, -swing * 0.35 + pull * 0.4, swing * 0.2 + raise * 0.25)

    if (model) {
      arm.visible = false
      if (item.geometry !== model.geometry) {
        item.geometry = model.geometry
        item.material = model.material
      }
      item.visible = true
      if (model.block) {
        item.position.set(0, 0, 0)
        item.rotation.set(0.35, 0.75, 0)
        item.scale.set(0.4, 0.4, 0.4)
      } else if (def?.kind === 'shield') {
        // Raised: across the middle of the screen, face on. Lowered: held at your side.
        item.position.set(blocking ? -0.34 : 0.02, blocking ? 0.14 : 0.02, blocking ? 0.04 : 0)
        item.rotation.set(0, blocking ? -0.3 : -0.9, 0)
        item.scale.set(0.44, 0.44, 0.44)
      } else if (def?.kind === 'bow') {
        item.position.set(-0.06, 0.12, 0)
        item.rotation.set(0, -0.5, -0.3 + pull * 0.3)
        item.scale.set(-0.64, 0.64, 0.64)
      } else {
        // Mirrored so the blade (drawn pointing up-right) points up and in toward the
        // crosshair, turned a little so its face catches the light.
        // Weapons big and bold in your hand (the handle stays low at the right); apples,
        // potions and the like smaller, so eating doesn't fill the screen.
        const weapon = def && ['sword', 'axe', 'mace', 'spear'].includes(def.kind)
        const k = weapon ? 0.56 : 0.4
        item.position.set(weapon ? -0.02 : 0, weapon ? 0.13 : 0.06, 0)
        item.rotation.set(-0.15, -0.6, 0.1)
        item.scale.set(-k, k, k)
      }
    } else {
      item.visible = false
      arm.visible = true
      arm.position.set(0.05, -0.05, 0.1)
      arm.rotation.set(0.25, 0.15, 0)
    }
    // The left hand.
    const offModel = offId ? itemModel(offId, getGame().profile.sword) : null
    if (offModel) {
      if (offItem.geometry !== offModel.geometry) {
        offItem.geometry = offModel.geometry
        offItem.material = offModel.material
      }
      offItem.visible = true
      const offEating = runtime.useHand === 'off' ? eating : 0
      offHolder.scale.setScalar(camera.aspect < 1 ? 0.8 : 1)
      offHolder.position.set(-handX - bobX + offEating * 0.2, -0.38 - bobY + offEating * 0.12 - raise * raise * 0.45 - land * 0.08, -0.62)
      offHolder.rotation.set(offEating * 0.4 + land * 0.15, 0, 0)
      if (offModel.block) {
        offItem.position.set(0, 0, 0)
        offItem.rotation.set(0.35, -0.75, 0)
        offItem.scale.set(0.34, 0.34, 0.34)
      } else if (offId === 'shield') {
        // Raised: in front of you, a little left of the middle. Lowered: at your side.
        offItem.position.set(offBlocking ? 0.2 : 0, offBlocking ? 0.16 : 0.02, offBlocking ? 0.04 : 0)
        offItem.rotation.set(0, offBlocking ? 0.3 : 0.9, 0)
        offItem.scale.set(0.44, 0.44, 0.44)
      } else {
        offItem.position.set(0, 0.06, 0)
        offItem.rotation.set(-0.15, 0.6, -0.1)
        offItem.scale.set(0.36, 0.36, 0.36)
      }
    } else offItem.visible = false

    gl.autoClear = false
    gl.clearDepth()
    gl.render(scene, camera)
    gl.autoClear = true
  }, 1)

  return null
}
