import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';

/**
 * Shader precompile warmup — kills the first-appearance HITCHES (the ~14fps
 * dips) caused by GPU programs being linked synchronously on the main thread the
 * first time a material is drawn.
 *
 * Without this, every material (the board saturation patch, the forest
 * dither/opaque variants, the city, characters, dice) compiles its shader
 * program on its FIRST draw — a main-thread stall exactly when that object first
 * appears. This component instead compiles them ALL up front, at LOAD.
 *
 * HOW: `renderer.compileAsync(scene, camera)` walks the whole scene graph and
 * links every material's program. Crucially, three's compile traverses ALL
 * objects — not just visible ones — so materials on objects hidden at load (e.g.
 * the dice before the first roll) are warmed too.
 *
 * WHEN (the robust part): the heavy assets (forest / city / characters / board
 * texture) load ASYNC via drei's Suspense loaders, across several independent
 * Suspense boundaries. Rather than guess an ordering, we gate on drei's global
 * loading progress (`useProgress`, backed by THREE.DefaultLoadingManager that
 * every useGLTF/useTexture/useKTX2 funnels through). We fire exactly once, the
 * first time all in-flight loads have settled (`active === false`) and at least
 * one asset actually loaded (`total > 0`) — by which point every heavy mesh is
 * mounted in the scene. The passive `useEffect` runs after commit, so the
 * just-resolved meshes are attached when we traverse.
 *
 * NO visual/behavior change: it only creates GPU programs; it never renders to
 * the screen and never mutates the scene. (The postFX composer's own passes
 * compile on its first render, which under frameloop="always" already happens at
 * load — so they don't hitch on a later first-appearance either.)
 */
export function ShaderWarmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const active = useProgress((s) => s.active);
  const total = useProgress((s) => s.total);
  const warmed = useRef(false);

  useEffect(() => {
    // Once, after every async asset has finished loading (and at least one did).
    if (warmed.current || active || total === 0) return;
    warmed.current = true;
    // Fire-and-forget: program creation happens synchronously inside compile;
    // the returned promise only reports when the parallel-compile has settled.
    void gl.compileAsync(scene, camera);
  }, [active, total, gl, scene, camera]);

  return null;
}
