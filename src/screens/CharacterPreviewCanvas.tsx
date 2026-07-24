/**
 * CharacterPreviewCanvas — the single R3F Canvas used on CharacterSelect.
 *
 * Isolated in its own module so the lazy() boundary in CharacterSelect.tsx
 * pulls three + CharacterToken into an async chunk, keeping them off the
 * menu-entry bundle. One animated character = trivial perf.
 *
 * Auto-rotates slowly on Y. Soft ambient + directional key light.
 * A simple disc "podium" underneath the character.
 */

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { CharacterToken } from '../board/CharacterToken';

interface PreviewSceneProps {
  url: string;
  tint: string;
}

function RotatingGroup({ url, tint }: PreviewSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.6;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Character — 0.2 default scale, feet at y=0 */}
      <CharacterToken url={url} tint={tint} scale={0.2} />
      {/* Podium disc */}
      <mesh receiveShadow position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 48]} />
        <meshStandardMaterial color="#2a2a40" roughness={0.9} metalness={0.1} />
      </mesh>
    </group>
  );
}

export function CharacterPreviewCanvas({ url, tint }: PreviewSceneProps) {
  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.9, 1.5], fov: 42 }}
      shadows={false}
      dpr={[1, 1.5]}
      gl={{ powerPreference: 'default', antialias: true }}
    >
      <color attach="background" args={['#1a1a2e']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[1.5, 3, 2]} intensity={1.2} />
      <directionalLight position={[-1.5, 1.5, -1]} intensity={0.3} color="#8899ff" />
      <RotatingGroup url={url} tint={tint} />
    </Canvas>
  );
}
