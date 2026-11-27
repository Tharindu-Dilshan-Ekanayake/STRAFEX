/** `?perf` (or development): live render numbers on `window.__perf` (see PerfProbe.jsx). */
export const perfEnabled = typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('perf'))

const enabled = perfEnabled

/**
 * The last full frame's draw calls and triangles (world and first-person pass together),
 * always kept: the avatar count gives way when a frame goes over the preset's budget.
 */
export const frameStats = { calls: 0, triangles: 0 }

/** Called by the frame's renderer before drawing: records the last frame, resets. */
export function recordFrame(gl) {
  // Two render passes a frame: the counters are reset here, once a frame, not per pass.
  gl.info.autoReset = false
  frameStats.calls = gl.info.render.calls
  frameStats.triangles = gl.info.render.triangles
  if (enabled && window.__perf) {
    const p = window.__perf
    p.calls = frameStats.calls
    p.triangles = frameStats.triangles
    p.maxCalls = Math.max(p.maxCalls, p.calls)
    p.maxTriangles = Math.max(p.maxTriangles, p.triangles)
  }
  gl.info.reset()
}
