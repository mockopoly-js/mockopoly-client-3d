import { lazy, Suspense, useEffect, useState } from 'react';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { useGameStore } from './state/gameStore';
import { EVENTS } from './types/SocketEvents';
import { ConnectionStatus } from './ui/ConnectionStatus';
import { MainMenu } from './screens/MainMenu';
import { Lobby } from './screens/Lobby';
import { LoadingScreen } from './ui/LoadingScreen';

const GameScene = lazy(() =>
  import('./screens/GameScene').then((m) => ({ default: m.GameScene })),
);
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
import { MuteButton } from './ui/MuteButton';
import { useSfx } from './audio/useSfx';
import { initAudioOnGesture } from './audio/sfx';
import type { S_GameOver } from './types/SocketEvents';

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const toggleDevHacks = useGameStore((s) => s.toggleDevHacks);
  const toggleDealPanel = useGameStore((s) => s.toggleDealPanel);

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

  return (
    <>
      <ConnectionStatus connected={connected} playerId={playerId} />
      <ToastLayer />
      <MuteButton />
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
          <DevHacksPanel />
          <HudButtons />
          <TradePanel />
          <PartnershipPanel />
          <DealPanel />
          <BigMomentOverlay />
        </>
      )}
      {screen === 'game-over' && <GameOverScreen />}
    </>
  );
}
