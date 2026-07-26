import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGameStore } from '../state/gameStore';
import { registerMobileRender, bumpMotion, pokeRender } from './mobileRender';

/**
 * Minimal view of the postprocessing EffectComposer instance drei forwards via
 * ref (`useImperativeHandle(ref, () => composer)`). We only need `setSize` — the
 * composer sizes its internal buffers from the renderer's DRAWING BUFFER, so it
 * must be re-sized after a dpr change or the scene keeps rendering at the
 * mount-time resolution (see mobileRender.ts). Typed structurally to avoid a
 * hard dependency on the `postprocessing` type surface.
 */
export interface ComposerHandle {
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
}

interface MobileRenderControllerProps {
  /** Ref to the MOBILE <EffectComposer> so a dpr change can resize its buffers. */
  composerRef: React.RefObject<ComposerHandle | null>;
  dprMoving: number;
  dprStill: number;
  settleMs: number;
}

/**
 * MOBILE-ONLY render controller (mount only when `useIsMobile()`; NEVER on
 * desktop). Lives inside the <Canvas> so it can read R3F's `invalidate` /
 * `setDpr`, and drives the on-demand + adaptive-dpr strategy documented in
 * mobileRender.ts:
 *
 *  1. Registers `invalidate` + an `applyDpr` (setDpr THEN composer.setSize) with
 *     the shared bus so every animation source can poke it context-free.
 *  2. Safety net #1 — subscribes to the game store and pokes a short frame burst
 *     on any GAME-STATE or camera-mode change (turn/position/money/dice/buy/…),
 *     so a discrete change always repaints even if applied imperatively.
 *  3. Safety net #2 — a frame burst on canvas pointer/touch/wheel input: drag /
 *     pinch / wheel counts as MOTION (cheap dpr) while a plain tap just paints a
 *     few crisp frames. It is FAR better to over-render briefly than to freeze.
 *  4. Startup kicks — a handful of delayed invalidates so late async work (HDRI
 *     environment, streamed glb/textures set imperatively in effects) always
 *     paints before the loop goes idle.
 *
 * Renders nothing. Unregisters + detaches everything on unmount so desktop /
 * post-unmount is a hard no-op.
 */
export function MobileRenderController({
  composerRef,
  dprMoving,
  dprStill,
  settleMs,
}: MobileRenderControllerProps): null {
  const invalidate = useThree((s) => s.invalidate);
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  // Lazy R3F state reader so applyDpr always sees the CURRENT css size without
  // re-registering the bus on every resize.
  const getR3F = useThree((s) => s.get);

  // Register the bus: invalidate + an applyDpr that resizes the post composer.
  useEffect(() => {
    const applyDpr = (dpr: number): void => {
      setDpr(dpr);
      // setDpr applied gl.setPixelRatio + gl.setSize synchronously; now resize the
      // composer's buffers so its RenderPass draws at the NEW drawing-buffer
      // resolution (css size × new pixel ratio) — otherwise the scene keeps
      // rendering at the composer's mount-time resolution and dpr does nothing.
      const { width, height } = getR3F().size;
      composerRef.current?.setSize(width, height);
    };
    // Live-dpr reader (source of truth): R3F re-applies the Canvas `dpr` prop on
    // every reconfigure, so the bus compares against this — not a local cache —
    // to self-heal a mid-motion reset (see mobileRender.ts).
    const readDpr = (): number => getR3F().viewport.dpr;
    const unregister = registerMobileRender(invalidate, applyDpr, readDpr, {
      dprMoving,
      dprStill,
      settleMs,
    });

    // Startup kicks: cover late async paints (HDRI env, streamed models) that are
    // applied imperatively and might not self-invalidate before the loop idles.
    const kicks = [120, 300, 650, 1200, 2200].map((ms) =>
      setTimeout(() => invalidate(), ms),
    );

    return () => {
      unregister();
      for (const k of kicks) clearTimeout(k);
    };
  }, [invalidate, setDpr, getR3F, composerRef, dprMoving, dprStill, settleMs]);

  // Safety net #1 — repaint on any game-state or camera-mode change.
  useEffect(() => {
    const unsub = useGameStore.subscribe((s, prev) => {
      if (s.state !== prev.state || s.cameraMode !== prev.cameraMode) {
        pokeRender();
      }
    });
    return unsub;
  }, []);

  // Safety net #2 — canvas input bursts. Drag/pinch/wheel = motion (cheap dpr);
  // a plain tap just paints a few crisp frames so its result is never stuck.
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (): void => bumpMotion();
    const onTap = (): void => pokeRender(4);
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('wheel', onMove, { passive: true });
    el.addEventListener('pointerdown', onTap, { passive: true });
    el.addEventListener('pointerup', onTap, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('wheel', onMove);
      el.removeEventListener('pointerdown', onTap);
      el.removeEventListener('pointerup', onTap);
    };
  }, [gl]);

  return null;
}
