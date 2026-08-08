import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  DEBUG_VISIBILITY_CATEGORIES,
  getDebugVisibility,
  subscribeDebugVisibility,
  toggleDebugVisibility,
  type DebugVisibilityCategory,
} from './debugVisibility';
import { getLodTintEnabled, subscribeLodTint, toggleLodTint } from './lodTint';
import { getHudVisible, subscribeHudVisible, toggleHudVisible } from './hudVisibility';
import {
  devForceThermalTier,
  devResetThermalTier,
  getThermalMedianMs,
  getThermalTier,
} from '../board/mobileRender';
import { MAX_THERMAL_TIER } from '../board/thermalDpr';

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
  glow: 'Owned-Tile Glow',
  city: 'City',
  tokens: 'Tokens',
};

/**
 * DebugTogglePanel — DEV-ONLY collapsible overlay with an independent
 * visibility toggle per 3D scene layer (forest sub-categories + the
 * whole-forest master, board, the owned-tile glow, city, tokens). Tapping a
 * row flips its flag; the subscribed board/forest components flip a
 * mesh/group's `.visible` accordingly (no per-frame cost). Read the
 * fps/draw-call/tri delta on the existing FPS + `RenderStatsReadout` panels to
 * see what each layer costs.
 *
 * Below the divider are controls that are NOT scene layers, so they live
 * outside `DEBUG_VISIBILITY_CATEGORIES`: "Forest LOD tint" (a material tint,
 * see `lodTint.ts`), "DOM HUD" (hides the DOM overlay entirely, see
 * `hudVisibility.ts` + `hudOverride.tsx`) — the latter is the live half of
 * `?nohud=1`, letting a dev A/B DOM cost vs GPU cost on-device without a
 * reload — and the "Thermal Tier" selector (see `mobileRender.ts` +
 * `thermalDpr.ts`), which forces the mobile thermal dpr step-down to a given
 * rung LIVE. It exists because the real dev-facing controls for this feature
 * are `?thermalTier=N` / `?thermal=0` launch-URL flags (still supported, and
 * still the ones to reach for in Safari), but Arslan plays as an installed
 * PWA, which launches from the manifest `start_url` with no address bar to
 * put a query string into — so the only way to reach the tiers on his device
 * is a control that lives in the app itself. "0" / "1" / "2" call
 * `devForceThermalTier`, which is one-way by construction (routes through the
 * same ratchet guard that makes the real thermal signal one-way, so it can
 * raise a tier here but never lower one — clicking a lower number than the
 * current tier is a harmless no-op). "Auto" is deliberately NOT a 4th forced
 * rung: it calls `devResetThermalTier`, a DEV-only escape hatch that discards
 * the ratchet instance and lets it cold-start again at tier 0 with a fresh
 * warm-up, handing control back to the normal automatic ratcheting — the only
 * way to go back down, and it does so without adding any decrement path to
 * the production state machine. The small readout beneath the buttons shows
 * the live committed tier and the rolling median frame time
 * (`getThermalMedianMs()`), the most useful diagnostic available for a
 * thermal problem on a device that cannot be profiled directly.
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
  const hudOn = useSyncExternalStore(subscribeHudVisible, getHudVisible, getHudVisible);
  const [open, setOpen] = useState(false);

  // Live thermal readout (tier + rolling median frame time). `mobileRender.ts`
  // is a page-lifetime singleton with no subscribe/notify of its own (the
  // ratchet ticks off its own rAF loop, not React), so this polls at the same
  // 250ms cadence the ratchet itself re-evaluates at — plenty for a diagnostic
  // readout, and the effect only runs while the panel is open (this row list
  // is unmounted when collapsed), so it costs nothing when the panel is
  // closed, which is the common case.
  const [thermalTier, setThermalTier] = useState(getThermalTier);
  const [thermalMedianMs, setThermalMedianMs] = useState(getThermalMedianMs);
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      setThermalTier(getThermalTier());
      setThermalMedianMs(getThermalMedianMs());
    };
    refresh();
    const id = setInterval(refresh, 250);
    return () => clearInterval(id);
  }, [open]);

  const stopScrollPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    // `data-hud-exempt`: this panel is itself a direct `#root` child with no
    // canvas descendant, so `?nohud=1` / the "DOM HUD" row's own kill rule
    // (`#root > *:not(:has(canvas))`, see hudOverride.tsx) would otherwise hide
    // THIS PANEL along with everything else the moment HUD is toggled off —
    // taking its own undo button with it and forcing a reload to get it back.
    // hudOverride.tsx exempts exactly this attribute from the rule.
    <div style={wrapStyle} data-testid="debug-toggle-panel" data-hud-exempt="true">
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
            {/* DOM HUD (the live half of `?nohud=1`, see hudVisibility.ts +
                hudOverride.tsx): hides every fixed DOM overlay so the 3D canvas's
                own cost can be read on its own, on the real device, without a
                reload (which would lose camera position + game state). NOT a
                DEBUG_VISIBILITY_CATEGORY: the HUD is DOM, not a 3D scene layer. */}
            <button
              type="button"
              onClick={() => toggleHudVisible()}
              style={{ ...rowStyle, opacity: hudOn ? 1 : 0.55 }}
            >
              <span
                style={{ ...dotStyle, background: hudOn ? '#4ade80' : '#7a7a90' }}
                aria-hidden="true"
              />
              <span>DOM HUD</span>
              <span style={stateStyle}>{hudOn ? 'ON' : 'OFF'}</span>
            </button>
            {/* Thermal tier (mobile-only effect, see mobileRender.ts +
                thermalDpr.ts): forces the thermal dpr step-down to a rung
                LIVE, no reload. This is the in-app substitute for the
                `?thermalTier=N` / `?thermal=0` launch flags (both still
                supported, still the ones to reach for in Safari) — they are
                unreachable once the game is launched as an installed PWA,
                which boots straight from the manifest `start_url` with no
                address bar to put a query string into.
                "0"/"1"/"2" call `devForceThermalTier`, one-way by
                construction (same ratchet guard as the real thermal signal),
                so tapping a number below the current tier is a harmless
                no-op — it is NOT a way to go back down. "Auto" is the one
                button that can: it calls `devResetThermalTier`, a DEV-only
                escape hatch that discards the ratchet and lets it cold-start
                again at tier 0 with a fresh warm-up, handing control back to
                the normal automatic ratcheting rather than freezing it at 0.
                Styled distinctly (red) because it is the one control here
                that can lower the tier — everything else in this panel can
                only turn a flag on/off. */}
            <div style={dividerStyle} aria-hidden="true" />
            <div style={thermalSectionStyle}>
              <div style={thermalHeaderRowStyle}>
                <span>Thermal Tier</span>
                <span style={{ ...stateStyle, color: thermalTier > 0 ? '#f87171' : '#4ade80' }}>
                  {thermalTier}
                </span>
              </div>
              <div style={thermalSegmentRowStyle}>
                {Array.from({ length: MAX_THERMAL_TIER + 1 }, (_, t) => t).map((t) => {
                  const active = thermalTier === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        devForceThermalTier(t);
                        setThermalTier(getThermalTier());
                      }}
                      style={{
                        ...thermalSegmentButtonStyle,
                        ...(active ? thermalSegmentActiveStyle : null),
                      }}
                      aria-pressed={active}
                      aria-label={`Force thermal tier ${t}`}
                    >
                      {t}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    devResetThermalTier();
                    setThermalTier(getThermalTier());
                  }}
                  style={thermalResetButtonStyle}
                  aria-label="DEV-only: reset thermal tier to automatic"
                >
                  Auto
                </button>
              </div>
              <div style={thermalMedianStyle}>
                median {Number.isNaN(thermalMedianMs) ? '—' : `${thermalMedianMs.toFixed(1)}ms`}
              </div>
            </div>
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

const thermalSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: '4px 6px 6px',
  flexShrink: 0,
};

const thermalHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  color: '#e8e8f0',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

const thermalSegmentRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

/** Tappable target: 44px is the minimum comfortable touch size (iOS HIG). */
const thermalSegmentButtonStyle: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 44,
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.08)',
  color: '#e8e8f0',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
};

// NOTE: overrides the FULL `border` shorthand, never just `borderColor` —
// mixing the shorthand (set by `thermalSegmentButtonStyle`) with a longhand
// override on the same property makes React log "don't mix shorthand and
// non-shorthand properties" on every tier change (caught via the live
// exercise: clicking a segment re-renders the row and React diffs the two
// style objects).
const thermalSegmentActiveStyle: React.CSSProperties = {
  background: '#4ade80',
  color: '#08080f',
  border: '1px solid #4ade80',
};

/**
 * Deliberately styled apart from the numbered rungs: this is the one control
 * in the whole panel that can LOWER a value (see `devResetThermalTier`), so
 * it needs to read as "different" at a glance, not just as another segment.
 * Same shorthand-only rule as `thermalSegmentActiveStyle` above.
 */
const thermalResetButtonStyle: React.CSSProperties = {
  ...thermalSegmentButtonStyle,
  flex: '1.6 1 0',
  fontSize: 11,
  background: 'rgba(248,113,113,0.18)',
  border: '1px solid rgba(248,113,113,0.6)',
  color: '#f87171',
};

const thermalMedianStyle: React.CSSProperties = {
  color: '#8888a0',
  fontSize: 10,
};
