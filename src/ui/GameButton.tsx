import type { CSSProperties, ReactNode } from 'react';
import { FONT_FAMILY } from '../constants/fonts';
import { useIsMobile } from './useIsMobile';

export type GameButtonVariant = 'primary' | 'secondary' | 'success' | 'tertiary';

interface GameButtonProps {
  variant?: GameButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  fullWidth?: boolean;
  style?: CSSProperties;
}

// ── Per-variant tokens ──────────────────────────────────────────────────────
// Each variant shares the same shape, radius, bevel mechanics, and press
// animation (.game-btn in index.css). Only gradient / text / border differ.

interface VariantTokens {
  gradientEnabled: string;
  gradientDisabled: string;
  color: string;
  colorDisabled: string;
  border: string;
  borderDisabled: string;
  shadowEnabled: string;
}

const VARIANTS: Record<GameButtonVariant, VariantTokens> = {
  // Gold — Create Room, Start Game, Back to Menu
  primary: {
    gradientEnabled: 'linear-gradient(180deg, #f0d060 0%, #d4af37 100%)',
    gradientDisabled: 'linear-gradient(180deg, #d9cfb0 0%, #c3b78f 100%)',
    color: '#5a3d0a',
    colorDisabled: 'rgba(90,61,10,0.55)',
    border: '#9a6b1e',
    borderDisabled: '#a99e78',
    shadowEnabled: '0 6px 0 rgba(154,107,30,0.55), 0 8px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6)',
  },
  // Orange — Join
  secondary: {
    gradientEnabled: 'linear-gradient(180deg, #f0a83c 0%, #e07d0a 100%)',
    gradientDisabled: 'linear-gradient(180deg, #d9c9b0 0%, #c3ad8f 100%)',
    color: '#fff',
    colorDisabled: 'rgba(255,255,255,0.7)',
    border: '#a85a06',
    borderDisabled: '#a99e78',
    shadowEnabled: '0 4px 0 rgba(168,90,6,0.55), 0 6px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4)',
  },
  // Green — Ready (active state)
  success: {
    gradientEnabled: 'linear-gradient(180deg, #5cc47f 0%, #2a8855 100%)',
    gradientDisabled: 'linear-gradient(180deg, #b0cfb9 0%, #8fb3a0 100%)',
    color: '#fff',
    colorDisabled: 'rgba(255,255,255,0.7)',
    border: '#1f6b40',
    borderDisabled: '#a99e78',
    shadowEnabled: '0 5px 0 rgba(31,107,64,0.55), 0 7px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4)',
  },
  // Cream/tan — Back (low emphasis)
  tertiary: {
    gradientEnabled: 'linear-gradient(180deg, #f4ead2 0%, #e7dcbf 100%)',
    gradientDisabled: 'linear-gradient(180deg, #e8e0cc 0%, #d8d0bc 100%)',
    color: '#3b3224',
    colorDisabled: 'rgba(59,50,36,0.5)',
    border: '#c9b88c',
    borderDisabled: '#c9c1aa',
    shadowEnabled: '0 4px 0 rgba(154,141,107,0.45), 0 6px 14px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.7)',
  },
};

export function GameButton({
  variant = 'primary',
  onClick,
  disabled = false,
  children,
  fullWidth = false,
  style,
}: GameButtonProps) {
  const isMobile = useIsMobile();
  const v = VARIANTS[variant];

  const computed: CSSProperties = {
    // Typography
    fontFamily: FONT_FAMILY,
    fontWeight: 800,
    fontSize: isMobile ? 17 : 16,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',

    // Color
    color: disabled ? v.colorDisabled : v.color,
    background: disabled ? v.gradientDisabled : v.gradientEnabled,

    // Shape
    border: `2px solid ${disabled ? v.borderDisabled : v.border}`,
    borderRadius: 16,

    // Size
    padding: isMobile ? '15px 22px' : '13px 22px',
    minHeight: isMobile ? 52 : undefined,
    width: fullWidth ? '100%' : undefined,
    flex: fullWidth ? 1 : undefined,
    boxSizing: 'border-box',

    // Shadow / bevel
    boxShadow: disabled
      ? '0 3px 0 rgba(0,0,0,0.15)'
      : v.shadowEnabled,

    // Interaction
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    touchAction: 'manipulation',
    transition: 'transform 0.08s ease, box-shadow 0.08s ease',

    // Override
    ...style,
  };

  return (
    <button
      className="game-btn"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={computed}
    >
      {children}
    </button>
  );
}
