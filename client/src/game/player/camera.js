import { Vector3 } from 'three'

import { BLOCKS, raycastVoxels } from '@shared/voxel'

import { runtime } from '../runtime'
import { worldState } from '../world'

/** The camera: first or third person, spectating, shake and hurt tilt, landing dip, sprint and bow FOV. */

export const BOW_FULL_MS = 900

const camTarget = new Vector3()

const camPos = new Vector3()

const lookDir = new Vector3()

export function placeCamera(camera, game, b, eyeY, dt, now) {
  placeCameraInner(camera, game, b, eyeY, dt, now)
  runtime.cameraPos.x = camera.position.x
  runtime.cameraPos.z = camera.position.z
}

function placeCameraInner(camera, game, b, eyeY, dt, now) {
  const p = runtime.player
  const cam = runtime.camera
  const world = worldState.world
  cam.shake = Math.max(0, cam.shake - dt * 2.2)
  cam.hurtTilt = Math.max(0, cam.hurtTilt - dt * 4)
  const shakeX = cam.shake ? (Math.random() - 0.5) * cam.shake * 0.3 : 0
  const shakeY = cam.shake ? (Math.random() - 0.5) * cam.shake * 0.3 : 0

  // `?debug` tooling: a fixed camera (`runtime.debugCam = { pos: [x,y,z], target: [x,y,z] }`).
  if (runtime.debugCam) {
    camera.position.set(...runtime.debugCam.pos)
    camera.lookAt(...runtime.debugCam.target)
    return
  }

  const fov = game.settings.fov + cam.fovKick * 8 + (runtime.bowPullAt ? -Math.min(1, (now - runtime.bowPullAt) / BOW_FULL_MS) * 10 : 0)
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 10)
    camera.updateProjectionMatrix()
  }

  if (runtime.zone === 'spec') {
    // Follow someone still in the round.
    let t = runtime.remotes.get(runtime.spectate.eid)
    if (!t) {
      t = runtime.remotes.values().next().value
      runtime.spectate.eid = t?.eid || 0
    }
    if (t) {
      camTarget.set(t.x, t.y + 1.5, t.z)
      lookDir.set(Math.sin(p.yaw) * Math.cos(p.pitch), -Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch))
      camPos.copy(camTarget).addScaledVector(lookDir, 5.5)
      const hit = raycastVoxels(world, camTarget.x, camTarget.y, camTarget.z, lookDir.x, lookDir.y, lookDir.z, 5.5, (id) => BLOCKS[id]?.render === 'solid')
      if (hit) camPos.copy(camTarget).addScaledVector(lookDir, Math.max(0.6, hit.dist - 0.3))
      if (runtime.snap) camera.position.copy(camPos)
      else camera.position.lerp(camPos, Math.min(1, dt * 10))
      camera.lookAt(camTarget)
    } else {
      // Nobody to watch (picking a kit, or the round just ended): look over the world.
      const c = worldState.gen?.center || { x: b.x, y: b.y, z: b.z }
      camera.position.set(c.x + 18, c.y + 16, c.z + 18)
      camera.lookAt(c.x, c.y, c.z)
    }
    runtime.snap = false
    return
  }

  const landT = (now - cam.landAt) / 260
  const dip = landT >= 0 && landT < 1 ? Math.sin(landT * Math.PI) * (1 - landT) * cam.landAmp * 0.32 : 0
  const bob = (p.grounded && cam.mode === 'first' ? Math.sin(p.walkPhase * 2) * Math.min(1, p.speed / 5) * 0.045 : 0) - dip
  if (cam.mode === 'first' && runtime.zone !== 'lobby') {
    camera.position.set(b.x + shakeX, eyeY + bob + shakeY, b.z)
    camera.rotation.set(p.pitch, p.yaw, Math.sin(cam.hurtTilt * Math.PI) * 0.08)
  } else {
    // Third person: behind and a little above, pulled in when a wall is in the way.
    camTarget.set(b.x, eyeY + 0.1, b.z)
    lookDir.set(Math.sin(p.yaw) * Math.cos(p.pitch), -Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch))
    const want = runtime.zone === 'lobby' ? 6 : 4.2
    const hit = raycastVoxels(world, camTarget.x, camTarget.y, camTarget.z, lookDir.x, lookDir.y, lookDir.z, want, (id) => BLOCKS[id]?.render === 'solid')
    const d = hit ? Math.max(0.5, hit.dist - 0.25) : want
    camPos.copy(camTarget).addScaledVector(lookDir, d)
    camera.position.set(camPos.x + shakeX, camPos.y + shakeY - dip * 0.5, camPos.z)
    camera.rotation.set(p.pitch, p.yaw, 0)
  }
  runtime.snap = false
}
