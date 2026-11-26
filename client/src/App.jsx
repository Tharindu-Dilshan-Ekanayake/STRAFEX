import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

import GameController from './GameController'
import GameScene from './game/GameScene'
import { useGame } from './store/game'
import ClickToPlay from './ui/ClickToPlay'
import HUD from './ui/HUD'
import LoadingScreen from './ui/LoadingScreen'
import ReplacedOverlay from './ui/ReplacedOverlay'
import ResultOverlay from './ui/ResultOverlay'
import TouchControls from './ui/TouchControls'

// Panels and the case opening aren't needed until someone opens one: their own chunk,
// fetched once the game is up.
const loadPanels = () => import('./ui/Panels')
const Panels = lazy(loadPanels)

function App() {
  const [ready, setReady] = useState(false)
  const handleReady = useCallback(() => {
    setReady(true)
    useGame.getState().setPlayable()
  }, [])

  useEffect(() => {
    if (!ready) return
    requestAnimationFrame(() => performance.mark('pp:hud-shown'))
    const id = setTimeout(loadPanels, 1500)
    return () => clearTimeout(id)
  }, [ready])

  return (
    <div className="relative h-full w-full select-none overflow-hidden font-pixel">
      <GameController />
      <GameScene onReady={handleReady} />
      <div id="nameplates" />
      <div id="hurt-vignette" />
      <div className="screen-vignette" />
      {ready && (
        <>
          <HUD />
          <ResultOverlay />
          <ClickToPlay />
          <TouchControls />
          <Suspense fallback={null}>
            <Panels />
          </Suspense>
        </>
      )}
      <ReplacedOverlay />
      <LoadingScreen done={ready} />
    </div>
  )
}

export default App
