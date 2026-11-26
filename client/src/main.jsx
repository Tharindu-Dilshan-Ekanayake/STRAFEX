import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/fredoka/latin-700.css'
import '@fontsource/silkscreen/latin-700.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { installAudioUnlock, sfx } from './audio/sfx'
import BloxityProvider from './bloxity/BloxityProvider.jsx'
import FpsMeter from './bloxity/FpsMeter.jsx'
import { GAME_SLUG } from './bloxity/identity'
import { installDebugHooks } from './debug'
import './index.css'

// Start-up milestones (pp:*) show up in DevTools' Performance panel and are read by
// the automated load test.
performance.mark('pp:main')
installDebugHooks()
installAudioUnlock()
// Every button clicks, and ticks softly under the mouse.
window.addEventListener('pointerdown', (e) => {
  if (e.target instanceof Element && e.target.closest('.mc-btn')) sfx.click()
})
let hovered = null
window.addEventListener('pointerover', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('.mc-btn') : null
  if (btn && btn !== hovered && e.pointerType === 'mouse') sfx.hover()
  hovered = btn
})
// Canvas text (labels, the leaderboard) uses the pixel font: start loading it now.
document.fonts?.load("700 20px 'Silkscreen'").catch(() => {})
document.fonts?.load("600 20px 'Fredoka'").catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Slug comes from VITE_GAME_SLUG in client/.env — see .env.example. */}
    <BloxityProvider gameSlug={GAME_SLUG}>
      <App />
      {/* Boxity's show_fps setting. */}
      <FpsMeter />
    </BloxityProvider>
  </StrictMode>,
)
