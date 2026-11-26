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
  /** Our team this round (-1 in the lobby), and players per team (1 = solo). */
  myTeam: -1,
  teamSize: 1,

  player: {
    body: createBody(36.5, 21, 42.5),
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
  /** Our own swing (ms timestamp), for the first-person arm and the attack cooldown. */
  swingAt: 0,
  attackAt: 0,
  /** Holding right click with a bow: when the pull started (0 = not pulling). */
  bowPullAt: 0,
  /** Eating/drinking animation until this time. */
  useAnimUntil: 0,

  /** Other players and bots: eid -> remote (see net/remotes.js). */
  remotes: new Map(),
  /** Who we watch while spectating. */
  spectate: { eid: 0 },

  /** The lava: `fightStart` (performance.now() of the fight's start) drives its height. */
  lava: { y: 6, fightStart: 0, mode: 'classic', active: false },

  /** Mirror of our own hotbar and health for frame loops (the store has the same). */
  me: { inv: [], sel: 0, hp: 20, maxHp: 20, alive: false, effects: {}, effectsAt: 0 },

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

/** Kept for the platform's respawn request: back to the lobby spawn if in the lobby. */
export function respawn() {
  if (runtime.zone !== 'lobby') return
  const b = runtime.player.body
  b.x = 36.5
  b.y = 21
  b.z = 42.5
  b.vx = b.vy = b.vz = 0
  runtime.snap = true
}
