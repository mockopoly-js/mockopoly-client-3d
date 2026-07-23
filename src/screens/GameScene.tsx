import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { SoftShadows } from '@react-three/drei';
import { BoardTiles } from '../board/BoardTiles';
import { PlayerTokens } from '../board/PlayerTokens';
import { Buildings } from '../board/Buildings';
import { CityDressing } from '../board/CityDressing';
import { Dice3D } from '../board/Dice3D';
import { CameraRig } from '../board/CameraRig';

/**
 * Game screen: renders the static 3D board in a daylight diorama scene.
 *
 * Lighting:
 * - hemisphereLight: soft sky/ground fill (sky #cbe8f5, ground #8a9a5b) at
 *   low intensity 0.35 — keeps unlit sides warm and grounded without washing
 *   out the directional shadow.
 * - ambientLight: trimmed from 0.8 → 0.5 so the directional shadow reads
 *   more clearly against the hemisphere fill.
 * - directionalLight: unchanged — position, intensity, shadow map.
 * - SoftShadows: drei helper (PCF soft shadows, no extra assets) with modest
 *   size/samples so shadow edges are feathered without tanking perf.
 * - CameraRig: drei OrbitControls tuned for tabletop overhead view + gentle
 *   auto-focus toward the active player's tile each turn.
 */
export function GameScene() {
  return (
    <Canvas style={{ position: 'fixed', inset: 0 }} camera={{ position: [0, 9, 11], fov: 50 }} shadows>
      <color attach="background" args={['#cbe8f5']} />
      {/* Soft shadow injection (must be early in the scene, no assets). */}
      <SoftShadows size={12} samples={16} />
      {/* Sky/ground hemisphere fill — warms the scene and lifts shadow darkness. */}
      <hemisphereLight args={['#cbe8f5', '#8a9a5b', 0.35]} />
      {/* Ambient trimmed so directional shadow contrast is preserved. */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[6, 10, 6]} intensity={1.15} castShadow
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      {/* OrbitControls + gentle auto-focus toward active player's tile. */}
      <CameraRig />
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
