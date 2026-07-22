import type { TokenType, ColorGroup } from '../types/GameState';

/** Player token colors (hex), matching the 2D client's TOKEN_HEX. */
export const TOKEN_HEX: Record<TokenType, string> = {
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  yellow: '#f1c40f',
  purple: '#9b59b6',
  orange: '#e67e22',
  cyan: '#1abc9c',
  pink: '#e91e8c',
};

/** Property color-group strip colors (fixed data palette — property identity only). */
export const COLOR_GROUP_HEX: Record<ColorGroup, string> = {
  brown: '#8d5a3c',
  'light-blue': '#8fd3ef',
  pink: '#e05aa6',
  orange: '#ef8a3c',
  red: '#e5473b',
  yellow: '#f4cf3a',
  green: '#3f9b57',
  'dark-blue': '#2f5fd0',
  railroad: '#2b2b2b',
  utility: '#b9ad93',
};
