import { createBody } from '@shared/physics'

/**
 * Per-frame mutable state shared between systems: your body, input, what you're
 * looking at, other players' interpolation buffers, effect queues.
 *
 * Deliberately outside React and zustand: it changes every frame and nothing should
 * re-render because of it. Network handlers and frame loops write here; the UI reads
 * slow-changing copies from the store.
 */
export const runtime = {
  /** Our entity id in the host (players and bots share the id space). */
  eid: 0,
  /** 'lobby' | 'match' | 'spec' - where the host says we are. */
  zone: 'lobby',
  /** Our side in a duel (0 or 1; -1 in the lobby and Spirelands). */
  myTeam: -1,

  player: {
    body: createBody(64.5, 25, 97.5),
    /** Camera yaw/pitch: yaw 0 looks toward -Z; positive pitch looks up. */
    yaw: Math.PI,
    pitch: -0.1,
    /** What others see us doing: index into host ANIMS. */
    anim: 0,
    sneaking: false,
    sprinting: false,
    /** Walk cycle for the view bob and our own third-person model. */
    walkPhase: 0,
    speed: 0,
    /** Input is ignored (panels open, dead, in a cage...). */
    frozen: false,
    /** Kept for the platform's respawn handler (bloxity/integration.js). */
    grounded: true,
  },

  /** Raw input, written by the keyboard/mouse/touch handlers. */
  input: {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false,
    attack: false,
    use: false,
    /** Touch stick, -1..1 each, +y = forward. */
    joyX: 0,
    joyY: 0,
    /** Look deltas (radians) accumulated since the last frame (mouse or touch drag). */
    lookX: 0,
    lookY: 0,
    /** Using touch controls: auto-jump on, sneak is a toggle. */
    touch: false,
    sneakToggle: false,
  },

  camera: {
    /** 'first' | 'third' */
    mode: 'first',
    shake: 0,
    /** Brief red tilt when we get hit. */
    hurtTilt: 0,
    /** Field of view kick when sprinting. */
    fovKick: 0,
    /** Last hard landing (ms) and how hard (0..1): the camera dips. */
    landAt: 0,
    landAmp: 0,
  },

  /** What the crosshair is on: `{ kind: 'block' | 'ent' | null, ... }`, set each frame. */
  target: { kind: null, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, eid: 0, id: 0 },
  /** Where a held block would go (Player.findPlacement); drawn as a preview box. */
  place: { ok: false, x: 0, y: 0, z: 0 },
  /** Breaking a block: which one and how far along (0..1). */
  dig: { key: -1, x: 0, y: 0, z: 0, progress: 0 },
  /** When we last showed a hit before the server confirmed it (no double sound). */
  predictedHitAt: 0,
  /** Our own swing (ms timestamp), for the first-person arm and the attack cooldown. */
  swingAt: 0,
  attackAt: 0,
  /** Holding right click with a bow: when the pull started (0 = not pulling). */
  bowPullAt: 0,
  /** Eating/drinking animation until this time. */
  useAnimUntil: 0,
  /** Holding right click to eat or drink: when it started (0 = not). */
  eatStart: 0,
  /** When the mouse was first captured this visit (performance.now; 0 = not yet). */
  firstLockAt: 0,
  /** Which hand right click is using ('main' | 'off'). */
  useHand: 'main',
  /** Shield raised (holding right click with a shield in a hand). */
  blocking: false,
  /** Last spear lunge (ms), for its cooldown. */
  lungeAt: 0,
  /** Clicks in the last second, per button (timestamps, recycled), for the CPS meter. */
  clicks: { l: [], r: [] },
  /** When each lobby training dummy was last hit (it wobbles). */
  dummyHits: [],
  /** The lobby parkour: when the clock started (0 = not running). */
  parkour: { startedAt: 0 },

  /** Other players and bots: eid -> remote (see net/remotes.js). */
  remotes: new Map(),
  /** Who we watch while spectating. */
  spectate: { eid: 0 },

  /** Mirror of our own hotbar and health for frame loops (the store has the same). */
  me: { inv: [], sel: 0, hp: 20, maxHp: 20, absorb: 0, alive: false, effects: {}, effectsAt: 0, armor: { tier: 'none', dura: [0, 0, 0, 0] }, shieldOff: 0, shieldOffAt: 0 },

  /** Where the camera is (set each frame): far terrain is culled from here, not from your body. */
  cameraPos: { x: 64.5, z: 97.5 },

  /** Effect events for the 3D layer to pick up (pooled there). */
  fx: [],
  /** Set when the controller should jump the camera to the body next frame. */
  snap: true,
  /** `?debug` only: a fixed camera `{ pos, target }` (screenshots of your own avatar). */
  debugCam: null,
}

/** Queues an effect for the 3D layer: `{ type, x, y, z, ... }`. */
export function pushFx(fx) {
  if (runtime.fx.length < 64) runtime.fx.push(fx)
}

/** Records a click for the CPS meter (`side` 'l' or 'r'). */
export function recordClick(side) {
  const list = runtime.clicks[side]
  const now = performance.now()
  while (list.length && now - list[0] > 1000) list.shift()
  if (list.length < 40) list.push(now)
}

/** Clicks per second right now on `side`. */
export function cps(side) {
  const list = runtime.clicks[side]
  const now = performance.now()
  while (list.length && now - list[0] > 1000) list.shift()
  return list.length
}

/** Kept for the platform's respawn request: back to the lobby spawn if in the lobby. */
export function respawn() {
  if (runtime.zone !== 'lobby') return
  const b = runtime.player.body
  b.x = 64.5
  b.y = 25
  b.z = 97.5
  b.vx = b.vy = b.vz = 0
  runtime.snap = true
}
