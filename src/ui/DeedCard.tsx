import React from 'react';

// ─── DeedCard ──────────────────────────────────────────────────────────────
// Presentational property-deed image sliced from the shared spritesheets.
//
// `property_cards.png` / `property_cards_back.webp` are BOTH 4396×3904, laid
// out as a 7-column × 4-row grid of 28 deeds (each 628×976, aspect 628:976).
// Given a row-major `cardFrame` (0–27):
//     col = frame % 7      row = floor(frame / 7)
// Rendered via CSS background sprite:
//     background-size: 700% 400%           (7 cols × 4 rows)
//     background-position: X% Y%           (percentage sprite positioning)
// For an N-cell axis the percentage step is 100/(N-1), so:
//     x = col * (100 / 6)%                 (7 cols → 6 gaps)
//     y = row * (100 / 3)%                 (4 rows → 3 gaps)
// Mortgaged deeds show the BACK sheet (matches 2D PropertyCard front/back swap).

const CARD_AR = 976 / 628; // height / width of a single frame
const COLS = 7;
const ROWS = 4;

const FRONT_URL = '/assets/images/cards/property_cards.png';
const BACK_URL = '/assets/images/cards/property_cards_back.webp';

export interface DeedCardProps {
  cardFrame: number;
  /** When mortgaged, show the deed's mortgage (back) face instead of the front. */
  mortgaged?: boolean;
  /** Rendered width in px; height derives from the 628:976 aspect ratio. */
  width?: number;
  style?: React.CSSProperties;
  'aria-label'?: string;
}

export function DeedCard({
  cardFrame,
  mortgaged = false,
  width = 150,
  style,
  ...rest
}: DeedCardProps) {
  const frame = Number.isFinite(cardFrame) ? Math.max(0, Math.floor(cardFrame)) : 0;
  const col = frame % COLS;
  const row = Math.floor(frame / COLS) % ROWS;

  const x = col * (100 / (COLS - 1));
  const y = row * (100 / (ROWS - 1));

  return (
    <div
      data-testid="deed-card"
      data-card-frame={frame}
      data-face={mortgaged ? 'back' : 'front'}
      role="img"
      style={{
        width,
        height: Math.round(width * CARD_AR),
        backgroundImage: `url(${mortgaged ? BACK_URL : FRONT_URL})`,
        backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
        backgroundPosition: `${x}% ${y}%`,
        backgroundRepeat: 'no-repeat',
        borderRadius: 8,
        boxShadow: '0 6px 18px -8px rgba(0,0,0,.55)',
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    />
  );
}
