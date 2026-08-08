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
 *
 * Interaction: OrbitControls allows the user to drag-rotate the character.
 * autoRotate is built into OrbitControls and automatically pauses while the
 * user is actively dragging, then resumes when they release.
 */

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CharacterToken } from '../board/CharacterToken';
import { toMobileCharacterUrl } from '../constants/characters';
import { useIsMobile } from '../ui/useIsMobile';

interface PreviewSceneProps {
  url: string;
  /** Rarity accent (hex) used to tint the podium ring. */
  accent?: string;
  /** Hex color to recolor the skin's primary flesh material (live preview). */
  baseColor?: string;
}

/**
 * The podium + character group. No manual useFrame rotation — OrbitControls
 * handles both autoRotate and user-drag in the Canvas context.
 */
function PreviewScene({ url, accent = '#2a2a40', baseColor }: PreviewSceneProps) {
  return (
    <group>
      {/*
       * Character — standing with feet at y=0 on the podium.
       * y=0 is the podium surface; the camera target is aimed at mid-body
       * (~half the character height) so the full figure is centered in frame.
       */}
      <CharacterToken url={url} clip="Idle" scale={0.2} baseColor={baseColor} />

      {/* Podium disc */}
      <mesh receiveShadow position={[0, -0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 64]} />
        <meshStandardMaterial color="#181826" roughness={0.85} metalness={0.15} />
      </mesh>
      {/* Podium accent ring */}
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.56, 0.6, 64]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

export function CharacterPreviewCanvas({ url, accent, baseColor }: PreviewSceneProps) {
  // MOBILE-ONLY: preview the meshopt-compressed variant (smaller download +
  // faster parse, skinning + animation preserved). Desktop keeps the original.
  // The decoder is bundled + auto-installed by drei's useGLTF. CharacterSelect
  // still passes the desktop url; the mobile mapping happens here only.
  const isMobile = useIsMobile();
  const modelUrl = isMobile ? toMobileCharacterUrl(url) : url;
  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      /*
       * Camera framing — full-body portrait, character vertically centered:
       *   - position: pulled back enough to see head-to-feet with margin,
       *     elevated slightly so eye-level is near mid-chest.
       *   - fov: 38° for a flattering perspective (not fisheye).
       *
       * The OrbitControls `target` below locks the orbit pivot to the
       * character's mid-height (~0.85 model-units above the podium for a
       * ~1.7-unit-tall humanoid at scale 0.2 → actual height ~0.34 world
       * units, mid ≈ 0.17). We use 0.2 as a slight above-center bias
       * (more headroom than footroom → natural portrait framing).
       */
      camera={{ position: [0, 0.55, 1.55], fov: 38 }}
      shadows={false}
      dpr={[1, 2]}
      gl={{ powerPreference: 'default', antialias: true }}
    >
      <color attach="background" args={['#0d0d18']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[1.5, 3, 2]} intensity={1.25} />
      <directionalLight position={[-1.8, 1.5, -0.6]} intensity={0.35} color="#9aa6ff" />

      <PreviewScene url={modelUrl} accent={accent} baseColor={baseColor} />

      {/*
       * OrbitControls — handles both autoRotate and drag-to-rotate:
       *   - autoRotate: built-in spin at 1.2 rpm; automatically pauses
       *     while the user is dragging and resumes when they release.
       *   - enableDamping: smooth inertial deceleration after drag release.
       *   - enablePan: disabled (no need to slide around a portrait preview).
       *   - enableZoom: small range allowed so users can inspect details.
       *   - Polar angle clamps: prevent flipping under the floor or looking
       *     straight down (clamp to ~10°–90° from the top).
       *   - target: orbit pivot at the character's mid-height so the whole
       *     figure stays centered in the viewport during rotation.
       */}
      <OrbitControls
        autoRotate
        autoRotateSpeed={1.2}
        enableDamping
        dampingFactor={0.1}
        enablePan={false}
        enableZoom={true}
        minDistance={0.9}
        maxDistance={3.0}
        minPolarAngle={Math.PI * 0.1}
        maxPolarAngle={Math.PI * 0.5}
        target={[0, 0.2, 0]}
      />
    </Canvas>
  );
}
