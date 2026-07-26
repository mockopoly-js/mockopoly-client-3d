import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';

/**
 * RenderStatsReadout — DEV-only, MOBILE-only WebGL draw-call/triangle counter.
 * Reads gl.info.render.calls and .triangles every frame and displays them in a
 * fixed DOM element positioned below the FPS stats panel. Throttles DOM updates
 * to avoid layout thrash (only updates if values changed or 250ms has passed).
 *
 * Use this to verify frustum culling is working: rotate the camera and watch
 * the draw-call and triangle counts DROP as off-screen chunks leave the view.
 */
export function RenderStatsReadout() {
  const gl = useThree((s) => s.gl);
  const domRef = useRef<HTMLDivElement | null>(null);
  const lastUpdateRef = useRef(0);
  const lastCallsRef = useRef(-1);
  const lastTrianglesRef = useRef(-1);

  // Disable gl.info.autoReset so counts accumulate across the frame (scene + all effect passes).
  // We'll reset manually once per frame ourselves in useFrame.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  // Create and mount the DOM element on mount; clean up on unmount.
  useEffect(() => {
    const div = document.createElement('div');
    div.className = 'render-stats';
    div.textContent = 'calls: — tris: —';
    document.body.appendChild(div);
    domRef.current = div;

    return () => {
      if (domRef.current?.parentNode) {
        domRef.current.parentNode.removeChild(domRef.current);
      }
    };
  }, []);

  // Read gl.info.render every frame; update DOM only if values changed or throttle time passed.
  // Runs at priority 0 (before EffectComposer at priority 1), so we read the accumulated
  // total from the scene + all effect passes, then reset for the next frame.
  useFrame(() => {
    const calls = gl.info.render.calls;
    const triangles = gl.info.render.triangles;

    const now = Date.now();

    // Throttle: only update if 250ms has passed OR values have changed.
    if (
      now - lastUpdateRef.current < 250 &&
      calls === lastCallsRef.current &&
      triangles === lastTrianglesRef.current
    ) {
      gl.info.reset();
      return;
    }

    lastUpdateRef.current = now;
    lastCallsRef.current = calls;
    lastTrianglesRef.current = triangles;

    if (domRef.current) {
      domRef.current.textContent = `calls: ${calls}  tris: ${triangles}`;
    }

    gl.info.reset();
  });

  return null;
}
