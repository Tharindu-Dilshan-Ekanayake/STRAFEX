/**
 * Where the sun is (a unit vector pointing at it). The sky draws the sun here and the
 * terrain mesher bakes its shadows from it, so the two always agree. High enough that
 * shadows fall short and readable, low enough that walls and trees still cast them.
 */
const raw = [0.38, 0.78, -0.5]
const len = Math.hypot(...raw)
export const SUN = raw.map((v) => v / len)
