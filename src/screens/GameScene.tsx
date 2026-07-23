import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { BoardTiles } from '../board/BoardTiles';
import { PlayerTokens } from '../board/PlayerTokens';
import { Buildings } from '../board/Buildings';
import { CityDressing } from '../board/CityDressing';
import { Dice3D } from '../board/Dice3D';

/**
 * Game screen: renders the static 3D board in a daylight scene plus the
 * Blender-authored asset layers (player tokens, houses/hotels, city dressing).
 *
 * PlayerTokens, Buildings, and CityDressing all render `ModelMesh`, which loads
 * `.glb` models via drei `useGLTF` and therefore suspends until the model
 * arrives. They are grouped under a single `<Suspense fallback={null}>` so a
 * still-loading model shows nothing instead of throwing. BoardTiles, the lights,
 * and the EffectComposer/Bloom/ToneMapping post-FX load no models and stay
 * outside the boundary (camera/post-FX unchanged from Phase 1).
 */
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
      {/* Procedural 3D dice: loads no glb, so it sits outside the model
          Suspense boundary alongside BoardTiles. Idle = hidden. */}
      <Dice3D />
      <Suspense fallback={null}>
        <PlayerTokens />
        <Buildings />
        <CityDressing />
      </Suspense>
      <EffectComposer>
        <Bloom intensity={0.35} luminanceThreshold={0.9} luminanceSmoothing={0.3} mipmapBlur />
        <ToneMapping />
      </EffectComposer>
    </Canvas>
  );
}
