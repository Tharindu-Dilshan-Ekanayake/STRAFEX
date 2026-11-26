/** `?perf` (or development): live render numbers on `window.__perf` (see PerfProbe.jsx). */
export const perfEnabled = typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('perf'))

const enabled = perfEnabled

/** Called by the frame's renderer before drawing: records the last frame, resets. */
export function recordFrame(gl) {
  if (!enabled || !window.__perf) return
  const p = window.__perf
  p.calls = gl.info.render.calls
  p.triangles = gl.info.render.triangles
  p.maxCalls = Math.max(p.maxCalls, p.calls)
  p.maxTriangles = Math.max(p.maxTriangles, p.triangles)
  gl.info.reset()
}
