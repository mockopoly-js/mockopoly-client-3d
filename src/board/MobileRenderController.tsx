import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { registerMobileRender } from './mobileRender';

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
  /**
   * OPTIONAL ref to a MOBILE <EffectComposer> so a dpr change can resize its
   * buffers. The native-resolution crisp-board pipeline (MobileCrispBoardPipeline)
   * owns and resizes its OWN render targets each frame from the live pixel ratio,
   * so it passes no composer ref and this is left undefined — `applyDpr` then just
   * calls setDpr and the frame loop self-heals the buffer sizes. Kept for the
   * legacy single-<EffectComposer> path.
   */
  composerRef?: React.RefObject<ComposerHandle | null>;
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
 *
 * The adaptive-dpr TRIGGERS live entirely in CameraRig: the OrbitControls
 * 'start'/'end' gesture events call beginCameraMotion/endCameraMotion on the bus.
 * Those fire ONLY on genuine user drag/pinch/wheel — never on programmatic
 * controls.update() — so this controller no longer wires raw pointer/touch/wheel
 * listeners (hover and clamped-zoom used to drop dpr with no camera movement).
 * Nothing here gates rendering — the Canvas is frameloop="always".
 *
 * Renders nothing. Unregisters everything on unmount so desktop / post-unmount is
 * a hard no-op.
 */
export function MobileRenderController({
  composerRef,
  dprMoving,
  dprStill,
  settleMs,
}: MobileRenderControllerProps): null {
  const setDpr = useThree((s) => s.setDpr);
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
      composerRef?.current?.setSize(width, height);
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

  return null;
}
