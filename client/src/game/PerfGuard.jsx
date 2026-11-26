import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

/**
 * Watches the frame rate and calls `onDecline` when it stays under `low` FPS (two
 * one-second samples in a row) and `onIncline` when it has plenty of headroom over
 * `high` (five in a row). After `flipflops` changes of direction it settles and stops
 * reacting, so it never see-saws. A few lines instead of a library.
 */
export default function PerfGuard({ low = 45, high = 58, flipflops = 4, onDecline, onIncline }) {
  const s = useRef({ frames: 0, time: 0, below: 0, above: 0, last: null, flips: 0, warm: 0 })
  useFrame((_, dt) => {
    const st = s.current
    if (st.flips >= flipflops) return
    st.frames += 1
    st.time += Math.min(dt, 0.5)
    if (st.time < 1) return
    const fps = st.frames / st.time
    st.frames = 0
    st.time = 0
    // The first seconds (shaders compiling, chunks building) don't count.
    if (st.warm < 3) {
      st.warm += 1
      return
    }
    if (fps < low) {
      st.below += 1
      st.above = 0
      if (st.below >= 2) {
        st.below = 0
        if (st.last === 'up') st.flips += 1
        st.last = 'down'
        onDecline?.()
      }
    } else if (fps > high) {
      st.above += 1
      st.below = 0
      if (st.above >= 5) {
        st.above = 0
        if (st.last === 'down') st.flips += 1
        st.last = 'up'
        onIncline?.()
      }
    } else {
      st.below = 0
      st.above = 0
    }
  })
  return null
}
