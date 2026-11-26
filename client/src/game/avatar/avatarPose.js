/**
 * Body language for Bloxity avatars in this game: walking and sprinting, sneaking,
 * jumping, swinging a sword, holding an item out, and looking up and down.
 *
 * `computePose(motion)` turns a motion state into joint angles; avatarRig.animateRig
 * applies them. Angles are radians in character space (the rig faces +Z, its left
 * side is +X), about each joint's pivot:
 *   swing - about X: negative swings a hanging limb forward; on the spine and neck,
 *           which point up, positive bends them forward
 *   sway  - about Z: positive moves a limb towards +X
 *   twist - about Y
 * `lift` raises (or lowers) the whole body, in metres.
 */

export const POSED_BONES = ['Spine1', 'Neck1', 'ArmL1', 'ArmL2', 'ArmR1', 'ArmR2', 'LegL1', 'LegL2', 'LegR1', 'LegR2']

/** Written by `computePose` every frame; one shared result, never reallocated. */
export const pose = {
  lift: 0,
  bones: Object.fromEntries(POSED_BONES.map((name) => [name, { swing: 0, sway: 0, twist: 0 }])),
}

const set = (name, swing = 0, sway = 0, twist = 0) => {
  const b = pose.bones[name]
  b.swing = swing
  b.sway = sway
  b.twist = twist
}

/**
 * @param {{ walkPhase: number, speed: number, anim: number, swing: number,
 *   holding: boolean, pitch: number, time: number }} m
 *   anim: 0 idle, 1 walk, 2 sprint, 3 sneak, 4 in the air, 5 shield up (host ANIMS); swing 0..1
 *   through an attack; pitch the camera's (up positive).
 */
export function computePose(m) {
  const walk = Math.min(1, (m.speed || 0) / 4.5)
  const sprint = m.anim === 2 ? 1 : 0
  const air = m.anim === 4
  const sneak = m.anim === 3
  const s = Math.sin(m.walkPhase || 0)
  const breathe = Math.sin((m.time || 0) * 1.8) * 0.03

  // Legs: alternate, knees bending on the back swing; tucked in the air.
  const legAmp = (0.65 + sprint * 0.25) * walk
  let legL = s * legAmp
  let legR = -s * legAmp
  let kneeL = Math.max(0, s) * 0.7 * walk
  let kneeR = Math.max(0, -s) * 0.7 * walk
  if (air) {
    legL = -0.45
    legR = 0.2
    kneeL = 0.6
    kneeR = 0.3
  }
  if (sneak) {
    legL = legL * 0.6 - 0.35
    legR = legR * 0.6 - 0.35
    kneeL += 0.55
    kneeR += 0.55
  }
  set('LegL1', legL)
  set('LegL2', kneeL)
  set('LegR1', legR)
  set('LegR2', kneeR)

  // Arms swing against the legs; out to the sides in the air.
  const armAmp = (0.5 + sprint * 0.35) * walk
  const armOut = air ? 0.35 : 0.06
  set('ArmL1', -s * armAmp + breathe, armOut, 0)
  set('ArmL2', -0.15 - walk * 0.25, 0, 0)
  // The right arm holds the item out in front, and swings it on a hit.
  const swing = m.swing || 0
  const hold = m.holding ? -0.45 : 0
  const rightBase = m.holding ? s * armAmp * 0.3 : s * armAmp
  // A shield in the offhand comes up on the left arm; anything else there is held out.
  if (m.anim === 5 && m.offShield) {
    set('ArmL1', -1.25, -0.35, -0.2)
    set('ArmL2', -0.7, 0, 0)
  } else if (m.offHolding) {
    set('ArmL1', -s * armAmp * 0.3 - 0.45 + breathe, armOut, 0)
    set('ArmL2', -0.55, 0, 0)
  }
  if (m.anim === 5 && !m.offShield) {
    // Shield up in the right hand: the arm raised across the chest.
    set('ArmR1', -1.25, 0.35, 0.2)
    set('ArmR2', -0.7, 0, 0)
  } else {
    set('ArmR1', rightBase + hold - swing * 1.9 - breathe, -armOut + swing * 0.25, swing * 0.4)
    set('ArmR2', -0.2 - (m.holding ? 0.35 : walk * 0.25) - swing * 0.3, 0, 0)
  }

  // Spine leans in when sneaking and sprinting; the head follows the camera.
  const lean = sneak ? 0.45 : sprint * 0.12
  set('Spine1', lean, 0, swing * -0.25)
  const pitch = Math.max(-1.2, Math.min(1.2, m.pitch || 0))
  set('Neck1', -pitch * 0.75 - lean * 0.8, -(m.headTurn || 0), 0)

  pose.lift = sneak ? -0.1 : 0
  return pose
}
