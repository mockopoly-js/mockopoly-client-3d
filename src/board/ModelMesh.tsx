import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Reusable loader for a Blender-authored `.glb`. Loads `url` via drei's
 * `useGLTF`, takes the FIRST mesh's geometry, and hangs a vertex-color-aware
 * `MeshStandardMaterial` on it so the baked COLOR_0 stream shows. `tint`
 * multiplies that stream — tokens bake white and are tinted per player here;
 * buildings/city props bake their own colors and pass the default white tint.
 *
 * Any number of distinct urls may be used across the app; drei caches per-url.
 */
export function ModelMesh({
  url,
  tint = '#ffffff',
  position = [0, 0, 0] as [number, number, number],
  scale = 1 as number | [number, number, number],
  rotation = [0, 0, 0] as [number, number, number],
}: {
  url: string;
  tint?: string;
  position?: [number, number, number];
  scale?: number | [number, number, number];
  rotation?: [number, number, number];
}) {
  const gltf = useGLTF(url);

  const mesh = useMemo(() => {
    let src: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
    });
    if (!src) return null;
    // CLONE the cached source geometry so this instance owns its own buffers —
    // NEVER mutate/dispose the shared useGLTF source geometry (other instances
    // of the same url reuse it via drei's per-url cache).
    const geometry = (src as THREE.Mesh).geometry.clone();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: new THREE.Color(tint),
      roughness: 0.55,
      metalness: 0.0,
    });
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    return m;
  }, [gltf, tint]);

  // GPU cleanup: the memo above allocates a per-instance geometry CLONE and a
  // per-instance MeshStandardMaterial each time `gltf`/`tint` changes. Without
  // disposal those GPU buffers leak on unmount or re-memo. This effect disposes
  // exactly THIS mesh's clone + material; the cleanup captures the current
  // `mesh` and fires before the next memo runs (dep change) and on unmount.
  // It only ever touches the per-instance clone (`mesh.geometry`) and the
  // per-instance material (`mesh.material`) — never the shared cached source
  // geometry from `useGLTF`, so other ModelMesh instances of the same url are
  // unaffected.
  useEffect(() => {
    if (!mesh) return;
    return () => {
      mesh.geometry.dispose();
      const mat = mesh.material;
      (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} position={position} scale={scale} rotation={rotation} />;
}

/**
 * Preload a model `.glb` into drei's cache. Re-exports `useGLTF.preload` so
 * callers can warm any url ahead of first render (see `constants/models.ts`,
 * which preloads the 8 token models).
 */
ModelMesh.preload = useGLTF.preload;
