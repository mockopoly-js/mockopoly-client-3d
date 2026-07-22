import { Canvas } from '@react-three/fiber';
import { BoardTiles } from '../board/BoardTiles';

/** Phase 1 placeholder game screen: renders the static 3D board in a daylight scene. */
export function GameScene() {
  return (
    <Canvas style={{ position: 'fixed', inset: 0 }} camera={{ position: [0, 9, 11], fov: 50 }} shadows>
      <color attach="background" args={['#cbe8f5']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      <BoardTiles />
    </Canvas>
  );
}
