import { useState, useSyncExternalStore } from 'react';
import {
  DEBUG_VISIBILITY_CATEGORIES,
  getDebugVisibility,
  subscribeDebugVisibility,
  toggleDebugVisibility,
  type DebugVisibilityCategory,
} from './debugVisibility';

const CATEGORY_LABELS: Record<DebugVisibilityCategory, string> = {
  wholeForest: 'Whole Forest (master)',
  trees: 'Trees',
  mountains: 'Mountains',
  flowers: 'Flowers',
  mushrooms: 'Mushrooms',
  grass: 'Grass',
  rocks: 'Rocks',
  ground: 'Ground / Terrain',
  board: 'Board',
  city: 'City',
  tokens: 'Tokens',
};

/**
 * DebugTogglePanel — DEV-ONLY collapsible overlay with an independent
 * visibility toggle per 3D scene layer (forest sub-categories + the
 * whole-forest master, board, city, tokens). Tapping a row flips its flag;
 * the subscribed board/forest components flip a mesh/group's `.visible`
 * accordingly (no per-frame cost). Read the fps/draw-call/tri delta on the
 * existing FPS + `RenderStatsReadout` panels to see what each layer costs.
 *
 * Default state (nothing tapped) = every flag `true` = the game renders
 * exactly as it does today.
 *
 * Positioned on the LEFT edge, well below the FPS/CameraDebugOverlay/
 * CullingBadge column (top-left) and well above the desktop HudButtons /
 * mobile PropertyListPanel toggle (bottom-left) — collapsed by default (just
 * the small handle button) so it never blocks gameplay or overlaps the FPS
 * panel (top-left), the turn HUD (top-center), or the camera/mute buttons
 * (top-right). Only ever mounted when `import.meta.env.DEV` (see App.tsx),
 * so this never ships to production.
 */
export function DebugTogglePanel() {
  const flags = useSyncExternalStore(
    subscribeDebugVisibility,
    getDebugVisibility,
    getDebugVisibility,
  );
  const [open, setOpen] = useState(false);

  return (
    <div style={wrapStyle} data-testid="debug-toggle-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={handleStyle}
        aria-expanded={open}
        aria-label="Toggle debug visibility panel"
      >
        {open ? '▾ Layers' : '▸ Layers'}
      </button>
      {open && (
        <div style={listStyle}>
          {DEBUG_VISIBILITY_CATEGORIES.map((category) => {
            const on = flags[category];
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleDebugVisibility(category)}
                style={{ ...rowStyle, opacity: on ? 1 : 0.55 }}
              >
                <span style={{ ...dotStyle, background: on ? '#4ade80' : '#7a7a90' }} aria-hidden="true" />
                <span>{CATEGORY_LABELS[category]}</span>
                <span style={stateStyle}>{on ? 'ON' : 'OFF'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'fixed',
  left: 'max(8px, env(safe-area-inset-left))',
  bottom: 'calc(190px + env(safe-area-inset-bottom))',
  zIndex: 9997,
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 11,
  userSelect: 'none',
};

const handleStyle: React.CSSProperties = {
  display: 'block',
  background: 'rgba(0,0,0,0.7)',
  color: '#e8e8f0',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding: '6px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 11,
  minHeight: 32,
};

const listStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'rgba(0,0,0,0.78)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding: 6,
  maxHeight: '50vh',
  overflowY: 'auto',
  minWidth: 190,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'transparent',
  color: '#e8e8f0',
  border: 'none',
  padding: '5px 6px',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 11,
  whiteSpace: 'nowrap',
  minHeight: 28,
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const stateStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontWeight: 700,
  opacity: 0.85,
};
