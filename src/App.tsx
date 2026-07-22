import { useEffect, useState } from 'react';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { useGameStore } from './state/gameStore';
import { EVENTS } from './types/SocketEvents';
import { ConnectionStatus } from './ui/ConnectionStatus';
import { MainMenu } from './screens/MainMenu';
import { Lobby } from './screens/Lobby';
import { GameScene } from './screens/GameScene';

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

  return (
    <>
      <ConnectionStatus connected={connected} playerId={playerId} />
      {screen === 'menu' && <MainMenu />}
      {screen === 'lobby' && <Lobby />}
      {(screen === 'game' || screen === 'game-over') && <GameScene />}
    </>
  );
}
