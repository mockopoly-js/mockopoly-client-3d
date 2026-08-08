import type { ChangeEvent } from 'react';
import { KIT, TAP_MIN, withVars } from '../ui/kit';
import type { KitStyle } from '../ui/kit';
import { TOKEN_HEX } from '../constants/theme';
import type { TokenType } from '../types/GameState';

/**
 * THE SWATCH PICKER — a grid of 44px colour buttons.
 *
 * The kit ships no swatch grid: `Segs` is short text labels and `Plinth` is one
 * decorative token. This wraps the SAME radial-gradient ball the pods and the
 * plinth already use inside a real 44px tap target, so the picker speaks the
 * grammar the rest of the game already speaks rather than inventing one.
 *
 * GEOMETRY. `cols` x 44px + (cols-1) x 6px gaps: 194px at four columns, which
 * fits the 250px right column with room to spare, and 394px at eight, which
 * fits the takeover's footer. The 6px internal gap is a DELIBERATE exception to
 * the 12px dead-space floor and follows the precedent the kit sets for `Segs`
 * and `CodeInput`: the floor applies at the outer edge of one logical control,
 * not between its own radio-style options.
 *
 * RULE R1. The selected item carries an outward 10px/2px glow, i.e. 12px of
 * overhang. Any ancestor that clips (a scroll container — and `overflow-y:auto`
 * clips the X axis too) will slice it. 12px is also what keeps the glow inside
 * the bottom safe inset when the picker sits in a takeover footer.
 */

const GAP = 6;

function gridStyle(cols: number): KitStyle {
  return {
    width: cols * TAP_MIN + (cols - 1) * GAP,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${TAP_MIN}px)`,
    gap: GAP,
  };
}

function cell(on: boolean, glow: string | null): KitStyle {
  return {
    width: TAP_MIN,
    height: TAP_MIN,
    padding: 0,
    border: 0,
    borderRadius: KIT.rLg,
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    touchAction: 'manipulation',
    background: 'linear-gradient(180deg, rgb(28 30 48 / 80%), rgb(9 10 18 / 78%))',
    boxShadow: on && glow !== null
      ? `${KIT.ringFocus}, 0 0 10px 2px ${glow}`
      : on
        ? `${KIT.ringFocus}, ${KIT.liftTop}`
        : `${KIT.liftTop}, ${KIT.ringHair}`,
    transition: `box-shadow ${KIT.durTap} ${KIT.easeOut}, transform ${KIT.durTap} ${KIT.easeOut}`,
  };
}

/** The ball itself, identical in construction to `Pod`'s swatch. */
function ball(hex: string): KitStyle {
  return {
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: `radial-gradient(circle at 33% 28%, #fff 0%, ${hex} 34%, rgb(0 0 0 / 62%) 118%)`,
    boxShadow: `0 0 12px 2px ${hex}, inset 0 -3px 6px rgb(0 0 0 / 55%)`,
  };
}

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];

/**
 * Board identity — the colour of MY piece on the table. Eight players, eight
 * colours, two rows of four.
 *
 * @example <TokenPicker value={token} onChange={setToken} />
 */
export function TokenPicker({ value, onChange }: { value: TokenType; onChange: (t: TokenType) => void }) {
  return (
    <div style={gridStyle(4)} role="radiogroup" aria-label="Your board colour">
      {TOKENS.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={t === value}
          aria-label={t}
          style={withVars({ '--tc': TOKEN_HEX[t] }, cell(t === value, TOKEN_HEX[t]))}
          onClick={() => { onChange(t); }}
        >
          <i style={ball(TOKEN_HEX[t])} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/**
 * SKIN RECOLOUR — the character's own base colour, not the board identity.
 *
 * Eight cells, and every one of them earns its 44px: DEFAULT (the skin's native
 * colours), six curated hues, and the OS colour picker so nothing is out of
 * reach. The previous screen spent a 16-swatch palette, a native picker, a hex
 * text field and a reset button on this; at 844x390 that is a third of the
 * screen for a cosmetic tweak, and the hex field in particular was redundant
 * with the picker it sat next to.
 */
const SKIN_SWATCHES: readonly { label: string; hex: string }[] = [
  { label: 'Crimson', hex: '#e53935' },
  { label: 'Cobalt', hex: '#1565c0' },
  { label: 'Teal', hex: '#00897b' },
  { label: 'Forest', hex: '#2e7d32' },
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Purple', hex: '#7b1fa2' },
];

/** The DEFAULT cell: a slashed neutral disc, so "no recolour" is a real choice. */
const NATIVE_BALL: KitStyle = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: `linear-gradient(135deg, ${KIT.surfaceRaised} 0 46%, ${KIT.text3} 46% 54%, ${KIT.surfaceRaised} 54%)`,
  boxShadow: KIT.ringHair,
};

export function SkinColorPicker({
  value,
  onChange,
  columns = 4,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
  /** 4 for a stacked column, 8 for a single row in a takeover footer. */
  columns?: number;
}) {
  const custom = value !== null && !SKIN_SWATCHES.some((s) => s.hex === value);

  return (
    <div style={gridStyle(columns)} role="group" aria-label="Skin colour">
      <button
        type="button"
        aria-label="Default"
        aria-pressed={value === null}
        style={cell(value === null, null)}
        onClick={() => { onChange(null); }}
      >
        <i style={NATIVE_BALL} aria-hidden="true" />
      </button>

      {SKIN_SWATCHES.map((s) => (
        <button
          key={s.hex}
          type="button"
          aria-label={s.label}
          aria-pressed={value === s.hex}
          style={cell(value === s.hex, s.hex)}
          onClick={() => { onChange(s.hex); }}
        >
          <i style={ball(s.hex)} aria-hidden="true" />
        </button>
      ))}

      {/*
        The OS colour picker, wearing the same 44px cell as its neighbours. The
        native control is stretched to fill the cell and made invisible rather
        than hidden, because `display:none` / `visibility:hidden` stop it
        opening on tap in Safari — it has to be a real, hit-testable input.
      */}
      <label style={{ ...cell(custom, custom ? value : null), position: 'relative' }}>
        <i style={custom ? ball(value) : RAINBOW_BALL} aria-hidden="true" />
        <input
          type="color"
          value={value ?? '#ffffff'}
          aria-label="Custom skin colour"
          data-testid="skin-color-custom"
          style={HIDDEN_INPUT}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value); }}
        />
      </label>
    </div>
  );
}

const RAINBOW_BALL: KitStyle = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: 'conic-gradient(#e5533d, #e8a33d, #f4cf3a, #46b16a, #3498db, #9b59b6, #e5533d)',
  boxShadow: `${KIT.ringHair}, inset 0 -3px 6px rgb(0 0 0 / 45%)`,
};

const HIDDEN_INPUT: KitStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  padding: 0,
  border: 0,
  opacity: 0,
  cursor: 'pointer',
};
