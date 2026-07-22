import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { BoardTiles } from '../board/BoardTiles';
import { PlayerTokens } from '../board/PlayerTokens';

/** Phase 1 placeholder game screen: renders the static 3D board in a daylight scene. */
export function GameScene() {
  return (
    <Canvas style={{ position: 'fixed', inset: 0 }} camera={{ position: [0, 9, 11], fov: 50 }} shadows>
      <color attach="background" args={['#cbe8f5']} />
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[6, 10, 6]} intensity={1.15} castShadow
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      <BoardTiles />
      <PlayerTokens />
      <EffectComposer>
        <Bloom intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.3} mipmapBlur />
        <ToneMapping />
      </EffectComposer>
    </Canvas>
  );
}
