import { playHere } from '../net/connection'
import { useGame } from '../store/game'
import { u } from './format'
import { Button } from './kit'

/** The same account started playing in another window: this one stops. */
export default function ReplacedOverlay() {
  const mode = useGame((s) => s.net.mode)
  if (mode !== 'replaced') return null
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mc-gui flex flex-col items-center text-center" style={{ padding: u(28), gap: u(16) }}>
        <div className="txt-o" style={{ fontSize: u(30), fontWeight: 700 }}>
          PLAYING IN ANOTHER WINDOW
        </div>
        <Button style={{ padding: `${u(10)} ${u(26)}`, fontSize: u(22) }} onClick={playHere}>
          PLAY HERE
        </Button>
      </div>
    </div>
  )
}
