import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HudButtons } from './HudButtons';
import { useGameStore } from '../state/gameStore';

describe('HudButtons', () => {
  beforeEach(() => useGameStore.getState().reset());
  it('opens each negotiation panel via its store flag', () => {
    render(<HudButtons />);
    fireEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(useGameStore.getState().showTradePanel).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /partnership/i }));
    expect(useGameStore.getState().showPartnershipPanel).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /deal/i }));
    expect(useGameStore.getState().showDealPanel).toBe(true);
  });
});
