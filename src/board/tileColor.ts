import type { BoardSpace } from '../types/GameState';
import { COLOR_GROUP_HEX } from '../constants/theme';

const NEUTRAL = '#f6eed9'; // cream board fill for non-color spaces

/** The strip/fill color for a tile: its color-group color if it has one, else neutral. */
export function tileColor(space: BoardSpace): string {
  if (space.colorGroup && space.colorGroup in COLOR_GROUP_HEX) {
    return COLOR_GROUP_HEX[space.colorGroup as keyof typeof COLOR_GROUP_HEX];
  }
  return NEUTRAL;
}
