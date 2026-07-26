import React from 'react';
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX, TOKEN_HEX } from '../constants/theme';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import { useIsLandscape } from './useIsLandscape';
import { FONT_FAMILY } from '../constants/fonts';
import { DeedCard } from './DeedCard';

const FONT = FONT_FAMILY;

/**
 * Read-only deed-card inspect modal, opened when the player clicks a purchasable
 * tile on the 3D board. Reads `deedCardIndex` from the store — separate from
 * `selectedPropertyIndex` / `showPropertyCard` which drive MortgagePanel.
 *
 * Shows:
 *   - DeedCard sprite (front, or mortgage-back if mortgaged)
 *   - Color-group accent strip
 *   - Property name + price
 *   - Owner line (player name + token swatch, or "Unowned")
 *   - State line (houses / hotel / mortgaged tag)
 *
 * No buy / mortgage / build buttons — read-only inspect only.
 * Close by clicking the button or clicking the overlay.
 */
export function PropertyCardModal() {
  const deedCardIndex = useGameStore((s) => s.deedCardIndex);
  const closeDeedCard = useGameStore((s) => s.closeDeedCard);
  const properties = useGameStore((s) => s.state?.properties);
  const players = useGameStore((s) => s.state?.players);
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  const landscape = isMobile && isLandscape;

  if (deedCardIndex === null) return null;

  // .at() is BoardSpace | undefined — an out-of-range index is a real runtime
  // possibility, so the guard below is live (and narrows space to non-null).
  const space = BOARD_SPACES.at(deedCardIndex);
  if (!space) return null;

  const propState = properties?.find((p) => p.spaceIndex === deedCardIndex);
  const ownerId = propState?.ownerId ?? null;
  const owner = ownerId ? players?.find((pl) => pl.id === ownerId) : undefined;

  const accent = space.colorGroup ? COLOR_GROUP_HEX[space.colorGroup] : '#d4af37';
  const cardFrame = space.cardFrame;
  const mortgaged = !!propState?.isMortgaged;
  const deedW = landscape ? 112 : isMobile ? 128 : 150;

  const houseCount = propState?.houses ?? 0;
  const hasHotel = propState?.hasHotel ?? false;

  const stateLabel = (() => {
    if (mortgaged) return 'Mortgaged';
    if (hasHotel) return 'Hotel';
    if (houseCount > 0) return `Houses: ${houseCount}`;
    return null;
  })();

  // Textual details (name / price / owner / state / close) — shared by the
  // portrait/desktop stacked layout and the landscape side-by-side layout.
  const details = (
    <>
      {/* Name */}
      <div style={{ fontWeight: 800, fontSize: 20 }}>{space.name}</div>

      {/* Price */}
      {space.price != null && (
        <div style={{ color: '#9a8f7c', margin: '4px 0 12px', fontVariantNumeric: 'tabular-nums' }}>
          Price {formatMoney(space.price)}
        </div>
      )}

      {/* Owner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {owner ? (
          <>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: '50%',
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TOKEN_HEX is a total Record over TokenType, but an out-of-contract token yields undefined at runtime
                background: TOKEN_HEX[owner.token] ?? '#888',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 14, color: '#3b3224' }}>
              Owned by <strong>{owner.name}</strong>
            </span>
          </>
        ) : (
          <span style={{ fontSize: 14, color: '#9a8f7c' }}>Unowned</span>
        )}
      </div>

      {/* State (houses / hotel / mortgaged) */}
      {stateLabel && (
        <div
          style={{
            display: 'inline-block',
            fontSize: 13,
            fontWeight: 700,
            background: mortgaged ? '#e7dcbf' : accent + '33',
            color: mortgaged ? '#6b5c3e' : '#3b3224',
            borderRadius: 8,
            padding: '3px 10px',
            marginBottom: 12,
          }}
        >
          {stateLabel}
        </div>
      )}

      {/* Close */}
      <div style={{ marginTop: 16 }}>
        <button onClick={closeDeedCard} style={{ ...btn, ...closeBtn }}>
          Close
        </button>
      </div>
    </>
  );

  const inner = (
    <>
      {/* Color-group accent strip */}
      <div style={{ height: 10, borderRadius: 6, background: accent, marginBottom: 12 }} />

      {/* Deed sprite */}
      {cardFrame != null && (
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14 }}>
          <DeedCard
            cardFrame={cardFrame}
            mortgaged={mortgaged}
            width={deedW}
            aria-label={`${space.name} deed`}
          />
        </div>
      )}

      {details}
    </>
  );

  // ── Mobile LANDSCAPE (wide + short): deed on the left, details on the right. ──
  if (landscape) {
    return (
      <div style={wrapLandscape} onClick={closeDeedCard}>
        <div style={cardLandscape} onClick={(e) => e.stopPropagation()}>
          <div style={rowLandscape}>
            {cardFrame != null && (
              <DeedCard cardFrame={cardFrame} mortgaged={mortgaged} width={deedW} aria-label={`${space.name} deed`} />
            )}
            <div style={infoColLandscape}>
              <div style={{ height: 8, borderRadius: 6, background: accent, marginBottom: 8 }} />
              {details}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={wrapMobile} onClick={closeDeedCard}>
        <div
          style={sheetMobile}
          onClick={(e) => e.stopPropagation()}
        >
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap} onClick={closeDeedCard}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        {inner}
      </div>
    </div>
  );
}

// ── Desktop styles ──────────────────────────────────────────────────────────
const wrap: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontFamily: FONT,
  zIndex: 50,
  background: 'rgba(0,0,0,0.5)',
};
const card: React.CSSProperties = {
  background: '#fbf6ec',
  color: '#3b3224',
  borderRadius: 18,
  padding: 22,
  minWidth: 260,
  maxWidth: '92vw',
  boxShadow: '0 24px 60px -20px rgba(0,0,0,.6)',
  maxHeight: '90dvh',
  overflowY: 'auto',
};
const btn: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: 800,
  border: 'none',
  borderRadius: 14,
  padding: '12px 20px',
  cursor: 'pointer',
  width: '100%',
  minHeight: 44,
};
const closeBtn: React.CSSProperties = {
  background: '#e7dcbf',
  color: '#3b3224',
};

// ── Mobile bottom-sheet styles ──────────────────────────────────────────────
const wrapMobile: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  fontFamily: FONT,
  zIndex: 50,
  display: 'flex',
  alignItems: 'flex-end',
  background: 'rgba(0,0,0,0.5)',
};
const sheetMobile: React.CSSProperties = {
  background: '#fbf6ec',
  color: '#3b3224',
  borderRadius: '20px 20px 0 0',
  padding: 22,
  width: '100vw',
  maxHeight: '85dvh',
  overflowY: 'auto',
  boxShadow: '0 -8px 40px -8px rgba(0,0,0,.6)',
  paddingBottom: 'calc(22px + env(safe-area-inset-bottom))',
  paddingLeft: 'calc(22px + env(safe-area-inset-left))',
  paddingRight: 'calc(22px + env(safe-area-inset-right))',
  boxSizing: 'border-box',
};

// ── Mobile LANDSCAPE styles (wide + short) ──────────────────────────────────
const wrapLandscape: React.CSSProperties = {
  position: 'fixed', inset: 0, fontFamily: FONT, zIndex: 50, display: 'flex',
  background: 'rgba(0,0,0,0.5)', boxSizing: 'border-box',
  padding:
    'max(8px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
};
const cardLandscape: React.CSSProperties = {
  background: '#fbf6ec', color: '#3b3224', borderRadius: 18, padding: 18,
  width: 'min(560px, 100%)', maxHeight: '100%', overflowY: 'auto', margin: 'auto',
  boxShadow: '0 24px 60px -20px rgba(0,0,0,.6)', boxSizing: 'border-box',
};
const rowLandscape: React.CSSProperties = { display: 'flex', flexDirection: 'row', gap: 16, alignItems: 'center' };
const infoColLandscape: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' };
