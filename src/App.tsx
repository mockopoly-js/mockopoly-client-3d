import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { socketManager } from './network/SocketManager';
import { gameStateSync } from './network/GameStateSync';
import { EVENTS } from './types/SocketEvents';
import { ConnectionStatus } from './ui/ConnectionStatus';

export default function App() {
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
      <Canvas
        style={{ position: 'fixed', inset: 0 }}
        camera={{ position: [0, 6, 8], fov: 50 }}
        shadows
      >
        <color attach="background" args={['#cbe8f5']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#f6eed9" />
        </mesh>
      </Canvas>
    </>
  );
}
