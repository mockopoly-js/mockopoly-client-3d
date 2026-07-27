import { useState, useSyncExternalStore } from 'react';
import {
  DEBUG_VISIBILITY_CATEGORIES,
  getDebugVisibility,
  subscribeDebugVisibility,
  toggleDebugVisibility,
  type DebugVisibilityCategory,
} from './debugVisibility';
import { getLodTintEnabled, subscribeLodTint, toggleLodTint } from './lodTint';

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
 * Fixed to the LEFT edge, anchored just below the top-left FPS/
 * CameraDebugOverlay/CullingBadge readout column so the expanded panel never
 * overlaps it and never overflows the top of the viewport. Collapsed by
 * default (just the small "▸ Layers" handle) so it never blocks gameplay.
 * When expanded, the panel shows a header ("Layers" + a close/collapse "✕"
 * button) above a scrollable row list capped to the remaining viewport
 * height — the list scrolls internally via touch/wheel without orbiting the
 * 3D camera (the app otherwise sets `touch-action: none` globally for canvas
 * gestures). Only ever mounted when `import.meta.env.DEV` (see App.tsx), so
 * this never ships to production.
 */
export function DebugTogglePanel() {
  const flags = useSyncExternalStore(
    subscribeDebugVisibility,
    getDebugVisibility,
    getDebugVisibility,
  );
  const lodTintOn = useSyncExternalStore(subscribeLodTint, getLodTintEnabled, getLodTintEnabled);
  const [open, setOpen] = useState(false);

  const stopScrollPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div style={wrapStyle} data-testid="debug-toggle-panel">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={handleStyle}
          aria-expanded={false}
          aria-label="Expand debug visibility panel"
        >
          ▸ Layers
        </button>
      ) : (
        <div style={panelStyle}>
          <div style={headerStyle}>
            <span style={titleStyle}>Layers</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={closeButtonStyle}
              aria-expanded={true}
              aria-label="Collapse debug visibility panel"
            >
              ✕
            </button>
          </div>
          <div
            style={listStyle}
            onTouchMove={stopScrollPropagation}
            onPointerMove={stopScrollPropagation}
            onWheel={stopScrollPropagation}
          >
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
            {/* Forest LOD-tier tint (mobile-only effect): paints each relief chunk
                by its CURRENT geometry tier — full=normal, LOD1(~30%)=green,
                LOD2(~5%)=red — so a dev can confirm on-device that the dynamic
                camera-distance LOD is swapping geometry and see which chunks are
                decimated. Separated by a divider (it toggles a MATERIAL tint, not
                a .visible flag). Default OFF. */}
            <div style={dividerStyle} aria-hidden="true" />
            <button
              type="button"
              onClick={() => toggleLodTint()}
              style={{ ...rowStyle, opacity: lodTintOn ? 1 : 0.55 }}
            >
              <span
                style={{ ...dotStyle, background: lodTintOn ? '#f87171' : '#7a7a90' }}
                aria-hidden="true"
              />
              <span>Forest LOD tint</span>
              <span style={stateStyle}>{lodTintOn ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'fixed',
  top: 'calc(env(safe-area-inset-top) + 132px)',
  left: 'max(8px, env(safe-area-inset-left))',
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

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 140px)',
  background: 'rgba(0,0,0,0.78)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  minWidth: 190,
  overflow: 'hidden',
  zIndex: 9998,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '4px 4px 4px 8px',
  borderBottom: '1px solid rgba(255,255,255,0.15)',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#e8e8f0',
  letterSpacing: 0.5,
};

const closeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  minWidth: 32,
  minHeight: 32,
  background: 'rgba(255,255,255,0.1)',
  color: '#e8e8f0',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: 1,
  flexShrink: 0,
};

const listStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 6,
  overflowY: 'auto',
  touchAction: 'pan-y',
  WebkitOverflowScrolling: 'touch',
  pointerEvents: 'auto',
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
  flexShrink: 0,
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'rgba(255,255,255,0.15)',
  margin: '4px 2px',
  flexShrink: 0,
};

const stateStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontWeight: 700,
  opacity: 0.85,
};
