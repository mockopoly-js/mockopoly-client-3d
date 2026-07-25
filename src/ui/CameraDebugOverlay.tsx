import { useGameStore } from '../state/gameStore';

function fmt(v: number): string {
  return v.toFixed(2);
}

function fmtVec(v: [number, number, number]): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

/**
 * CameraDebugOverlay — fixed-position readout of live camera state.
 * Reads from gameStore.cameraReadout written (throttled ~8x/sec) by CameraRig.
 * pointer-events:none so it never blocks clicks; high z-index so it's always on top.
 */
export function CameraDebugOverlay() {
  const r = useGameStore((s) => s.cameraReadout);
  if (!r) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        left: 8,
        zIndex: 9999,
        pointerEvents: 'none',
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 11,
        lineHeight: 1.6,
        fontVariantNumeric: 'tabular-nums',
        background: 'rgba(0,0,0,0.62)',
        color: '#b8ffa0',
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.10)',
        userSelect: 'none',
        whiteSpace: 'pre',
      }}
      data-testid="camera-debug-overlay"
    >
      {`CAM pos    ${fmtVec(r.pos)}\ntarget     ${fmtVec(r.target)}\noffset     ${fmtVec(r.offset)}\ndist       ${fmt(r.dist)}`}
    </div>
  );
}
