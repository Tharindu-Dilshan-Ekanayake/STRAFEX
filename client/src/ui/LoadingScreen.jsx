import { useEffect, useState } from 'react'
import { DefaultLoadingManager } from 'three'

import { u } from './format'
import { Fancy } from './kit'

/**
 * Shown until the first frame is drawn. Everything is generated in code (no big
 * downloads), so it's usually gone in a second; three's loading manager covers any lazy loads.
 */
/** Loading progress from three's loading manager (any textures or models still coming). */
function useLoadProgress() {
  const [state, setState] = useState({ progress: 0, active: false })
  useEffect(() => {
    const m = DefaultLoadingManager
    const prev = { onStart: m.onStart, onProgress: m.onProgress, onLoad: m.onLoad }
    m.onStart = () => setState((s) => ({ ...s, active: true }))
    m.onProgress = (_url, loaded, total) => setState({ progress: total ? (loaded / total) * 100 : 100, active: loaded < total })
    m.onLoad = () => setState({ progress: 100, active: false })
    return () => Object.assign(m, prev)
  }, [])
  return state
}

export default function LoadingScreen({ done }) {
  const { progress, active } = useLoadProgress()
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!done) return undefined
    const id = setTimeout(() => setGone(true), 450)
    return () => clearTimeout(id)
  }, [done])
  if (gone) return null
  const pct = done ? 100 : active ? Math.max(10, Math.round(progress)) : 60
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-400"
      style={{ background: 'linear-gradient(#1d1630, #3a2a5e 55%, #ff9a4a)', opacity: done ? 0 : 1, gap: u(24) }}
    >
      <div className="bob pixelated" style={{ width: u(110), height: u(110), background: '#2a1b3d', border: `${u(8)} solid #ffb21a`, boxShadow: `0 ${u(10)} 0 rgba(0,0,0,0.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(45deg)' }}>
        <span className="txt-o" style={{ fontSize: u(64), fontWeight: 700, transform: 'rotate(-45deg)' }}>
          ⚔
        </span>
      </div>
      <div className="flex flex-col items-center" style={{ gap: u(6) }}>
        <Fancy size={72} from="#fff7b0" to="#ffb21a" style={{ fontFamily: 'Silkscreen' }}>STRAFEX</Fancy>
        <span className="txt-o" style={{ fontSize: u(18), letterSpacing: '0.2em' }}>PVP · PRACTICE · SPIRELANDS</span>
      </div>
      <div className="mc-slot" style={{ width: u(360), height: u(26), padding: u(4) }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#7cff6b', transition: 'width 0.3s' }} />
      </div>
      <div className="txt-o" style={{ fontSize: u(18) }}>
        Loading…
      </div>
    </div>
  )
}
