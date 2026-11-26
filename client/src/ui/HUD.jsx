import { useGame } from '../store/game'
import { u } from './format'
import { LevelUpBanner, Toasts, TopRight } from './hud/Corner'
import { LobbyMenu, ParkourTimer, PlayButtons, PlayerCount, QueueBar, StationPrompt, Wallet, WelcomeGift } from './hud/Lobby'
import { InventoryPanel } from './hud/Inventory'
import { KitPicker, MapVote, ModesPanel } from './hud/Modes'
import { ArmorPanel, Keystrokes, StatsPanel } from './hud/Pvp'
import { Banner, BottomBar, Countdown, Crosshair, DuelTop, FfaTop, LeaveButton, SpectateBar } from './hud/Round'

/**
 * The heads-up display. In the lobby: the title, the play buttons and your queue, the
 * menu, wallet and station prompts, the mode menu and the map vote. In a fight: the duel
 * score or Spirelands bar, banners and countdown, crosshair, hearts and hotbar, and the
 * PvP overlay (keystrokes and CPS, armour durability, hit stats). Knocked out: the
 * spectator bar (duels) or the kit picker (Spirelands).
 */
export default function HUD() {
  const zone = useGame((s) => s.zone)
  const kind = useGame((s) => s.phase.kind)
  const phase = useGame((s) => s.phase.phase)
  const needKit = useGame((s) => Boolean(s.phase.needKit))
  const panel = useGame((s) => s.panel)
  const inFight = zone === 'match'
  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-white">
      {/* Every zone change (lobby, fight, spectating) fades in from dark. */}
      <div key={zone} className="zone-fade" />
      <div className="top-center absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top: u(12), gap: u(8) }}>
        {zone === 'lobby' && kind === 'lobby' && (
          <>
            <PlayerCount />
            <PlayButtons />
            <QueueBar />
          </>
        )}
        {zone !== 'lobby' && <DuelTop />}
        {zone !== 'lobby' && <FfaTop />}
        {/* Searching for a duel from Spirelands: the search, and the way out of it. */}
        {zone !== 'lobby' && kind === 'ffa' && <QueueBar />}
      </div>
      {zone === 'lobby' && (
        <>
          <Crosshair />
          <ParkourTimer />
        </>
      )}
      {inFight && (
        <>
          <Crosshair />
          <BottomBar />
          <Keystrokes />
          <ArmorPanel />
          <StatsPanel />
        </>
      )}
      <Banner />
      <Countdown />
      {zone === 'lobby' && kind === 'lobby' && (
        <>
          <LobbyMenu />
          <Wallet />
          <StationPrompt />
          <WelcomeGift />
        </>
      )}
      {zone === 'spec' && <SpectateBar />}
      {kind === 'ffa' && needKit && <KitPicker />}
      {kind === 'duel' && phase === 'vote' && <MapVote />}
      {panel === 'modes' && <ModesPanel />}
      {panel === 'inventory' && zone === 'match' && <InventoryPanel />}
      {/* Top right: your name, then Lobby (in a fight), chat and settings. The top left is
          kept clear for the host's logos. */}
      <TopRight>{zone !== 'lobby' && <LeaveButton />}</TopRight>
      <LevelUpBanner />
      <Toasts />
    </div>
  )
}
