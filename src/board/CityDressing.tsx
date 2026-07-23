import { ModelMesh } from './ModelMesh';

/**
 * Static decorative toy-city props placed in the empty board center.
 * World board is 10 units square; tiles ring the edge at ~[-5,5].
 * All props here are inside x,z ∈ [-3.2, 3.2] and y=0, well clear of the tile ring.
 *
 * Layout (viewed from above, +x right, +z down):
 *   - A small skyline cluster of buildings near the center-left
 *   - Two flanking trees around the cluster
 *   - Two more trees offset to upper-right for balance
 *   - Two tiny street cars on "roads" between buildings
 *
 * PROPS is entirely deterministic (no Math.random) — positions are hard-coded literals.
 */

const BASE = '/models/city/';

interface PropDef {
  url: string;
  pos: [number, number, number];
  rotY: number;
  scale: number;
}

const PROPS: PropDef[] = [
  // ---- Tall building cluster: left-of-center ----
  { url: `${BASE}building-tall.glb`,  pos: [-1.1,  0.0, -0.3],  rotY: 0.0,          scale: 1.0 },
  { url: `${BASE}building-tall.glb`,  pos: [ 0.4,  0.0,  0.6],  rotY: 0.4,          scale: 0.85 },

  // ---- Wide buildings flanking the tall ones ----
  { url: `${BASE}building-wide.glb`,  pos: [-0.1,  0.0, -1.0],  rotY: 0.3,          scale: 1.0 },
  { url: `${BASE}building-wide.glb`,  pos: [ 1.3,  0.0,  0.0],  rotY: -0.3,         scale: 0.9 },
  { url: `${BASE}building-wide.glb`,  pos: [-1.5,  0.0,  1.2],  rotY: 0.6,          scale: 0.8 },

  // ---- Trees around the cluster ----
  { url: `${BASE}tree.glb`,           pos: [-2.2,  0.0, -0.8],  rotY: 0.0,          scale: 1.0 },
  { url: `${BASE}tree.glb`,           pos: [-2.0,  0.0,  0.5],  rotY: 0.5,          scale: 1.1 },
  { url: `${BASE}tree.glb`,           pos: [ 2.0,  0.0, -1.4],  rotY: 0.8,          scale: 0.9 },
  { url: `${BASE}tree.glb`,           pos: [ 2.5,  0.0,  1.0],  rotY: 1.2,          scale: 1.0 },
  { url: `${BASE}tree.glb`,           pos: [ 0.8,  0.0, -2.0],  rotY: 0.2,          scale: 0.95 },

  // ---- Street cars on the "road" between buildings ----
  { url: `${BASE}car.glb`,            pos: [-0.6,  0.0,  0.1],  rotY: 1.57,         scale: 1.0 },
  { url: `${BASE}car.glb`,            pos: [ 1.6,  0.0, -0.8],  rotY: -0.2,         scale: 1.0 },
];

// Preload all city prop models ahead of first render.
const _preloadedUrls = new Set<string>();
for (const p of PROPS) {
  if (!_preloadedUrls.has(p.url)) {
    ModelMesh.preload(p.url);
    _preloadedUrls.add(p.url);
  }
}

/**
 * Renders a static, deterministic arrangement of toy-city props in the board
 * center (x,z ∈ [-3.2,3.2], y=0). No game state; purely decorative.
 * Task 4 mounts this inside <Suspense fallback={null}> in GameScene.tsx.
 */
export function CityDressing(): React.JSX.Element {
  return (
    <group name="city-dressing">
      {PROPS.map((p, i) => (
        <ModelMesh
          key={i}
          url={p.url}
          position={p.pos}
          rotation={[0, p.rotY, 0]}
          scale={p.scale}
        />
      ))}
    </group>
  );
}
