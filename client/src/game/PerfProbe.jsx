import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'

import { perfEnabled as enabled } from './perf'

/**
 * Exposes live render numbers as `window.__perf` when the page is opened with `?perf`
 * (and always in development): draw calls and triangles of the last full frame (world
 * plus first-person pass), FPS over the last second, and texture/geometry counts. Read
 * by the automated performance check; costs nothing otherwise.
 */
export default function PerfProbe() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (!enabled) return undefined
    // Two render passes per frame: the counters are reset by hand (ViewModel.jsx).
    gl.info.autoReset = false
    window.__perf = { calls: 0, triangles: 0, fps: 0, textures: 0, geometries: 0, maxCalls: 0, maxTriangles: 0 }
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])

  useFrame(() => {
    if (!enabled || !window.__perf) return
    const p = window.__perf
    const now = performance.now()
    p.frames = (p.frames || 0) + 1
    if (!p.since) p.since = now
    if (now - p.since >= 1000) {
      p.fps = Math.round((p.frames * 1000) / (now - p.since))
      p.frames = 0
      p.since = now
    }
    p.textures = gl.info.memory.textures
    p.geometries = gl.info.memory.geometries
  })
  return null
}
