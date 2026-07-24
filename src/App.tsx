import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { useGameStore } from './state/gameStore';
import { useScreenRouting } from './state/useScreenRouting';
import { EVENTS } from './types/SocketEvents';
import { ConnectionStatus } from './ui/ConnectionStatus';
import { MainMenu } from './screens/MainMenu';
import { Lobby } from './screens/Lobby';
import { LoadingScreen } from './ui/LoadingScreen';
import { TurnHud } from './ui/TurnHud';
import { BuyPrompt } from './ui/BuyPrompt';
import { useGameBusEvent } from './state/useGameBus';
import { ToastLayer } from './ui/ToastLayer';
import { PlayerPods } from './ui/PlayerPods';
import { PropertyListPanel } from './ui/PropertyListPanel';
import { GameLog } from './ui/GameLog';
import { GameOverScreen } from './screens/GameOverScreen';
import { MortgagePanel } from './ui/MortgagePanel';
import { DevHacksPanel } from './ui/DevHacksPanel';
import { TradePanel } from './ui/TradePanel';
import { PartnershipPanel } from './ui/PartnershipPanel';
import { DealPanel } from './ui/DealPanel';
import { HudButtons } from './ui/HudButtons';
import { BigMomentOverlay } from './ui/BigMomentOverlay';
import { CardDrawnOverlay } from './ui/CardDrawnOverlay';
import { MuteButton } from './ui/MuteButton';
import { CameraViewButton } from './ui/CameraViewButton';
import { RotateHint } from './ui/RotateHint';
import { PropertyCardModal } from './ui/PropertyCardModal';
import { CameraDebugOverlay } from './ui/CameraDebugOverlay';
import { useSfx } from './audio/useSfx';
import { initAudioOnGesture } from './audio/sfx';
import type { S_GameOver } from './types/SocketEvents';

// Lazy-load the 3D GameScene so three/drei/postprocessing land in an async
// chunk fetched only when the game starts — kept off the initial (menu/lobby)
// critical path. Declared after all imports (ordering only; behavior identical).
const GameScene = lazy(() =>
  import('./screens/GameScene').then((m) => ({ default: m.GameScene })),
);

// Lazy-load CharacterSelect — it pulls in CharacterPreviewCanvas which imports
// three/CharacterToken. Keeping it lazy ensures three stays out of the entry chunk.
const CharacterSelect = lazy(() =>
  import('./screens/CharacterSelect').then((m) => ({ default: m.CharacterSelect })),
);

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const toggleDevHacks = useGameStore((s) => s.toggleDevHacks);
  const toggleDealPanel = useGameStore((s) => s.toggleDealPanel);
  const location = useLocation();

  // Keep the URL and the game-flow screen in sync (Back/Forward + deep links).
  // The character-select path (/character-select) is outside the game flow;
  // useScreenRouting will treat it as an unknown path and collapse to 'menu',
  // which is fine — we intercept it before any screen rendering below.
  useScreenRouting();

  // Wire gameBus events → synthesized SFX.
  useSfx();
  const mustPay = useGameStore(
    (s) =>
      !!(s.state?.turn?.mustPayRent && s.state?.turn?.currentPlayerId === s.myPlayerId),
  );
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleDevHacks();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDevHacks]);

  // Start the WebAudio context on the first user gesture (browser autoplay policy).
  useEffect(() => {
    let removed = false;
    const onGesture = () => {
      if (removed) return;
      removed = true;
      initAudioOnGesture();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  useEffect(() => {
    const socket = socketManager.connect();
    gameStateSync.register();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onAck = (data: { playerId: string }) => setPlayerId(data.playerId);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.CONNECT_ACK, onAck);
    if (socket.connected) setConnected(true);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.CONNECT_ACK, onAck);
    };
  }, []);

  const setGameOver = useGameStore((s) => s.setGameOver);
  const setScreen = useGameStore((s) => s.setScreen);
  useGameBusEvent('game-over', (d: S_GameOver) => { setGameOver(d); setScreen('game-over'); });
  useGameBusEvent('open-negotiation', () => toggleDealPanel(true));

  useEffect(() => {
    if (mustPay) toggleDealPanel(true);
  }, [mustPay, toggleDealPanel]);

  // Character select is a URL-only overlay outside the game flow state machine.
  const isCharacterSelect = location.pathname === '/character-select';

  return (
    <>
      <ConnectionStatus connected={connected} playerId={playerId} />
      <ToastLayer />
      <MuteButton />
      <RotateHint />
      <DevHacksPanel />
      {isCharacterSelect ? (
        <Suspense fallback={<LoadingScreen />}>
          <CharacterSelect />
        </Suspense>
      ) : (
        <>
      {screen === 'menu' && <MainMenu />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && (
        <>
          <Suspense fallback={<LoadingScreen />}>
            <GameScene />
          </Suspense>
          <TurnHud />
          <BuyPrompt />
          <PropertyListPanel />
          <PlayerPods />
          <GameLog />
          <MortgagePanel />
          <HudButtons />
          <TradePanel />
          <PartnershipPanel />
          <DealPanel />
          <BigMomentOverlay />
          <CardDrawnOverlay />
          <PropertyCardModal />
          <CameraDebugOverlay />
          <CameraViewButton />
        </>
      )}
      {screen === 'game-over' && <GameOverScreen />}
        </>
      )}
    </>
  );
}
