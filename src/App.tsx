import { useEffect, useState } from 'react';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { useGameStore } from './state/gameStore';
import { EVENTS } from './types/SocketEvents';
import { ConnectionStatus } from './ui/ConnectionStatus';
import { MainMenu } from './screens/MainMenu';
import { Lobby } from './screens/Lobby';
import { GameScene } from './screens/GameScene';
import { TurnHud } from './ui/TurnHud';
import { DiceDisplay } from './ui/DiceDisplay';
import { BuyPrompt } from './ui/BuyPrompt';
import { useGameBusEvent } from './state/useGameBus';
import { ToastLayer } from './ui/ToastLayer';
import { PlayerPods } from './ui/PlayerPods';
import { PropertyListPanel } from './ui/PropertyListPanel';
import { GameLog } from './ui/GameLog';
import { GameOverScreen } from './screens/GameOverScreen';
import type { S_GameOver } from './types/SocketEvents';

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

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

  return (
    <>
      <ConnectionStatus connected={connected} playerId={playerId} />
      {screen === 'menu' && <MainMenu />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && (
        <>
          <GameScene />
          <TurnHud />
          <DiceDisplay />
          <BuyPrompt />
          <PropertyListPanel />
          <PlayerPods />
          <GameLog />
          <ToastLayer />
        </>
      )}
      {screen === 'game-over' && <GameOverScreen />}
    </>
  );
}
