import { useGameBusEvent } from '../state/useGameBus';
import { playSfx } from './sfx';

/**
 * Subscribe to confirmed gameBus events (from GameStateSync) and fire
 * the matching synthesized sound effect.
 *
 * Confirmed emits from GameStateSync:
 *   'dice-rolled'     → playSfx('roll')
 *   'player-moved'    → playSfx('hop')
 *   'property-bought' → playSfx('buy')
 *   'rent-collected'  → playSfx('rent')
 *   'jail-sent'       → playSfx('jail')
 *   'player-bankrupt' → playSfx('bankrupt')
 *   'game-over'       → playSfx('win')
 *
 * Mount once at the top level of App.
 */
export function useSfx(): void {
  useGameBusEvent('dice-rolled',     () => playSfx('roll'));
  useGameBusEvent('player-moved',    () => playSfx('hop'));
  useGameBusEvent('property-bought', () => playSfx('buy'));
  useGameBusEvent('rent-collected',  () => playSfx('rent'));
  useGameBusEvent('jail-sent',       () => playSfx('jail'));
  useGameBusEvent('player-bankrupt', () => playSfx('bankrupt'));
  useGameBusEvent('game-over',       () => playSfx('win'));
}
