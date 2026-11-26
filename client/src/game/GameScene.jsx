import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WebGLRenderer } from 'three'

import { prepareAudio } from '../audio/sfx'
import { useBloxity } from '../bloxity/BloxityContext'
import { useBloxityStore } from '../bloxity/store'
import { useGame } from '../store/game'
import { RENDER_SCALES, useQuality } from '../store/quality'
import ErrorBoundary from '../ui/ErrorBoundary'
import { warmItemModels } from './art/items'
import Characters from './Characters'
import { BlockOutline, Liquid, Motes, Sky } from './Environment'
import Player from './Player'
import PerfGuard from './PerfGuard'
import PerfProbe from './PerfProbe'
import ViewModel from './ViewModel'
import Terrain from './voxel/Terrain'
import { enterLobby, worldState } from './world'

// r3f-perf: dev-only overlay (?perf in the URL); the DEV check drops it from builds.
const DevPerf = import.meta.env.DEV ? lazy(() => import('r3f-perf').then((m) => ({ default: m.Perf }))) : null
const showDevPerf = import.meta.env.DEV && new URLSearchParams(window.location.search).has('perf')

// Round-only and lobby-only scenery: their own chunks, fetched once the lobby is on
// screen, so neither delays time-to-playable.
const Effects = lazy(() => import('./Effects'))
// Bloxity avatars (and the glTF / OBJ loaders they need): after the first frame too.
const Avatars = lazy(() => import('./avatar/Avatars'))
const LobbyProps = lazy(() => import('./LobbyProps'))

/** Fires `onFirstFrame` after the renderer has actually drawn once. */
function FirstFrameSignal({ onFirstFrame }) {
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    performance.mark('pp:first-frame')
    setTimeout(onFirstFrame, 0)
  })
  return null
}

/** Keeps the camera's far plane in step with the preset's view distance. */
function ViewDistance({ far }) {
  const get = useThree((s) => s.get)
  useEffect(() => {
    const { camera } = get()
    camera.far = far
    camera.updateProjectionMatrix()
  }, [get, far])
  return null
}

/**
 * The 3D view: renderer lifecycle, quality-driven settings, automatic preset drops when
 * FPS falls under budget, and recovery from a lost WebGL context.
 */
export function GameScene({ onReady }) {
  const { game } = useBloxity()
  const settings = useQuality((s) => s.settings)
  const antialias = useQuality((s) => s.antialias)
  const rebuild = useQuality((s) => s.rebuild)
  const degrade = useQuality((s) => s.degrade)
  const recover = useQuality((s) => s.recover)
  const renderScale = useQuality((s) => RENDER_SCALES[s.renderStep])
  const adBreak = useBloxityStore((s) => s.adBreak)
  const zone = useGame((s) => s.zone)
  const fov = useGame((s) => s.settings.fov)

  const [firstFrame, setFirstFrame] = useState(false)
  const [contextKey, setContextKey] = useState(0)
  const [contextLost, setContextLost] = useState(false)
  const readySent = useRef(false)

  useEffect(() => {
    game.loadingStep('Building the islands…')
    if (!worldState.world) enterLobby()
  }, [game])

  useEffect(() => {
    if (!firstFrame || readySent.current) return
    readySent.current = true
    performance.mark('pp:ready')
    game.loadingEnd()
    onReady?.()
    // Not needed for the first frame: the audio engine, and every item's model and icon
    // (built ahead so nothing is made mid-fight).
    const idle = (fn, ms) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 200))
    idle(prepareAudio, 1500)
    idle(warmItemModels, 3000)
  }, [firstFrame, game, onReady])

  const handleCreated = useCallback(({ gl, scene }) => {
    performance.mark('pp:gl-created')
    // `?debug` tooling: the scene, for counting what's in it.
    if (window.__pp) window.__pp.scene = scene
    gl.debug.checkShaderErrors = import.meta.env.DEV
    const canvas = gl.domElement
    let remountTimer = null
    const remount = () => {
      clearTimeout(remountTimer)
      setContextLost(false)
      setContextKey((k) => k + 1)
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      if (!canvas.isConnected) return
      e.preventDefault()
      setContextLost(true)
      remountTimer = setTimeout(remount, 1500)
    })
    canvas.addEventListener('webglcontextrestored', remount)
  }, [])
  const handleFirstFrame = useCallback(() => setFirstFrame(true), [])
  const handleDecline = useCallback(() => setTimeout(degrade, 0), [degrade])
  const handleIncline = useCallback(() => setTimeout(recover, 0), [recover])

  const dpr = Math.min(settings.dpr, window.devicePixelRatio || 1) * renderScale

  const createRenderer = useMemo(
    () => (defaults) => {
      performance.mark('pp:gl-start')
      const renderer = new WebGLRenderer({ ...defaults, alpha: false, antialias, stencil: false, powerPreference: 'high-performance' })
      performance.mark('pp:gl-end')
      return renderer
    },
    [antialias],
  )

  return (
    <>
      <Canvas
        key={`${contextKey}:${rebuild}`}
        frameloop={adBreak ? 'never' : 'always'}
        dpr={dpr}
        gl={createRenderer}
        shadows={false}
        flat
        camera={{ position: [36, 26, 50], fov, near: 0.08, far: settings.viewDistance }}
        onCreated={handleCreated}
      >
        <fog attach="fog" args={['#d4f3ff', settings.fogNear, settings.viewDistance * 0.95]} />
        <ViewDistance far={settings.viewDistance} />
        <PerfGuard low={45} high={58} flipflops={4} onDecline={handleDecline} onIncline={handleIncline} />

        <Player />
        {/* Light for the avatars only: the blocks' shading is baked into the terrain. */}
        <hemisphereLight args={['#eaf4ff', '#9a8466', 2.2]} />
        <directionalLight position={[42, 60, -82]} intensity={1.9} color="#fff1d6" />
        <Sky />
        <Terrain />
        <Liquid />
        <Motes />
        <Characters />
        <BlockOutline />
        {firstFrame && (
          <Suspense fallback={null}>
            {zone === 'lobby' ? <LobbyProps /> : <Effects />}
          </Suspense>
        )}
        {firstFrame && (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <Avatars />
            </Suspense>
          </ErrorBoundary>
        )}
        <ViewModel />
        <FirstFrameSignal onFirstFrame={handleFirstFrame} />
        <PerfProbe />
        {showDevPerf && DevPerf && (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <DevPerf position="bottom-left" minimal />
            </Suspense>
          </ErrorBoundary>
        )}
      </Canvas>

      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-sky-500/80 font-pixel text-2xl text-white">
          Reloading graphics…
        </div>
      )}
    </>
  )
}

export default GameScene
