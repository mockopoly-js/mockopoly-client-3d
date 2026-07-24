/**
 * CharacterPreviewCanvas — the SINGLE live R3F Canvas on the CharacterSelect
 * "locker". Everything else in the grid is a static thumbnail <img>, so this is
 * the only WebGL context on the screen (one animated character = trivial perf).
 *
 * Isolated in its own module so the lazy() boundary in CharacterSelect.tsx pulls
 * three + drei + CharacterToken into an async chunk, keeping them OFF the
 * menu-entry bundle.
 *
 * Big, prominent full-body preview: the selected skin (NATIVE colors), slowly
 * auto-rotating on a soft podium, lit by a gentle key/fill/rim. The rarity
 * accent tints the podium ring so the preview echoes the card frame.
 */

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { CharacterToken } from '../board/CharacterToken';

interface PreviewSceneProps {
  url: string;
  /** Rarity accent (hex) used to tint the podium ring. */
  accent?: string;
}

function RotatingGroup({ url, accent = '#2a2a40' }: PreviewSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Character — NATIVE colors (tint is a no-op), feet at y=0, Idle loop. */}
      <CharacterToken url={url} clip="Idle" scale={0.2} />
      {/* Podium disc, accent-tinted rim glow. */}
      <mesh receiveShadow position={[0, -0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 64]} />
        <meshStandardMaterial color="#181826" roughness={0.85} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.56, 0.6, 64]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

export function CharacterPreviewCanvas({ url, accent }: PreviewSceneProps) {
  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.95, 1.7], fov: 40 }}
      shadows={false}
      dpr={[1, 2]}
      gl={{ powerPreference: 'default', antialias: true }}
    >
      <color attach="background" args={['#0d0d18']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[1.5, 3, 2]} intensity={1.25} />
      <directionalLight position={[-1.8, 1.5, -0.6]} intensity={0.35} color="#9aa6ff" />
      <RotatingGroup url={url} accent={accent} />
    </Canvas>
  );
}
