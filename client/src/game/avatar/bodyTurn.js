/**
 * Walking turns the whole figure (head and all) to face the way it's going: A or D and it
 * turns to that side and walks there; standing still it turns back to face where you
 * look. The camera doesn't turn, and nothing bends at the neck. Purely how a figure looks -
 * aim, hits and the shield still use the real facing (`yaw`).
 *
 * `st` is a small object kept per figure ({} to start). Returns the figure's turn from
 * `yaw` in radians.
 */
const wrap = (a) => {
  let d = a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

export function bodyTurn(st, x, z, yaw, now) {
  const dt = st.t ? Math.min(0.1, (now - st.t) / 1000) : 0
  const dx = x - (st.x ?? x)
  const dz = z - (st.z ?? z)
  st.t = now
  st.x = x
  st.z = z
  if (st.off === undefined) st.off = 0
  if (dt <= 0) return st.off
  let target = 0
  // Moving (not just jittering about): face the way it's going.
  if (Math.hypot(dx, dz) / dt > 0.8) target = wrap(Math.atan2(-dx, -dz) - yaw)
  // Turn the short way round.
  st.off = wrap(st.off + wrap(target - st.off) * Math.min(1, dt * 12))
  return st.off
}
