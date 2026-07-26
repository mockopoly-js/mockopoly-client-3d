import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { registerMobileRender, bumpMotion } from './mobileRender';

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
 * MOBILE-ONLY adaptive-dpr controller (mount only when `useIsMobile()`; NEVER on
 * desktop). Lives inside the <Canvas> so it can read R3F's `setDpr`, and drives
 * the camera-only adaptive-dpr strategy documented in mobileRender.ts:
 *
 *  1. Registers an `applyDpr` (setDpr THEN composer.setSize) + a live-dpr reader
 *     with the shared bus so camera-driven code can poke it context-free.
 *  2. Wires canvas pointer/touch/wheel listeners as CAMERA-motion signals: a
 *     drag / pinch / wheel drops to the cheap MOVING dpr; on settle the crisp dpr
 *     is restored. (OrbitControls onChange in CameraRig is the other camera
 *     signal.) Nothing here gates rendering — the Canvas is frameloop="always".
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
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  // Lazy R3F state reader so applyDpr always sees the CURRENT css size without
  // re-registering the bus on every resize.
  const getR3F = useThree((s) => s.get);

  // Register the bus: an applyDpr that resizes the post composer + a live reader.
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
    return registerMobileRender(applyDpr, readDpr, {
      dprMoving,
      dprStill,
      settleMs,
    });
  }, [setDpr, getR3F, composerRef, dprMoving, dprStill, settleMs]);

  // Camera-motion signal: drag / pinch / wheel on the canvas moves the camera →
  // drop to the cheap MOVING dpr; the settle timer restores the crisp dpr once
  // motion stops. (This is a resolution knob, not a render trigger.)
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (): void => bumpMotion();
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('wheel', onMove, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('wheel', onMove);
    };
  }, [gl]);

  return null;
}
