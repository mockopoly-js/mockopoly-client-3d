import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CardDrawnOverlay } from './CardDrawnOverlay';
import { gameBus } from '../state/gameBus';
import type { S_CardDrawn } from '../types/SocketEvents';

function chance(description: string): S_CardDrawn {
  return {
    playerId: 'p1', deck: 'chance',
    card: { deck: 'chance', cardId: 1, description, effect: { type: 'money', value: 1_000_000 } },
  } as unknown as S_CardDrawn;
}
function community(description: string): S_CardDrawn {
  return {
    playerId: 'p1', deck: 'community-chest',
    card: { deck: 'community-chest', cardId: 2, description, effect: { type: 'money', value: -500_000 } },
  } as unknown as S_CardDrawn;
}

describe('CardDrawnOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows nothing initially', () => {
    const { container } = render(<CardDrawnOverlay />);
    expect(container.firstChild).toBe(null);
  });

  it('reveals a Chance card (orange header + description) then auto-dismisses', () => {
    render(<CardDrawnOverlay />);
    act(() => { gameBus.emit('card-drawn', chance('Advance to GO')); });
    expect(screen.getByText('CHANCE')).toBeTruthy();
    const body = screen.getByText('Advance to GO');
    expect(body).toBeTruthy();
    // Header carries the Chance (orange) accent.
    const header = screen.getByText('CHANCE') as HTMLElement;
    expect(header.style.background).toContain('243'); // rgb form of #f39c12 → 243,156,18
    // Auto-dismiss after ANIMATION_CARD_REVEAL_MS (2500ms).
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.queryByText('Advance to GO')).toBe(null);
  });

  it('reveals a Community Chest card with the blue header', () => {
    render(<CardDrawnOverlay />);
    act(() => { gameBus.emit('card-drawn', community('Bank error in your favour')); });
    expect(screen.getByText('COMMUNITY CHEST')).toBeTruthy();
    expect(screen.getByText('Bank error in your favour')).toBeTruthy();
    const header = screen.getByText('COMMUNITY CHEST') as HTMLElement;
    expect(header.style.background).toContain('52'); // rgb form of #3498db → 52,152,219
  });

  it('re-arms the dismiss timer on a rapid second draw', () => {
    render(<CardDrawnOverlay />);
    act(() => { gameBus.emit('card-drawn', chance('First card')); });
    act(() => { vi.advanceTimersByTime(2000); }); // not yet dismissed
    act(() => { gameBus.emit('card-drawn', chance('Second card')); });
    act(() => { vi.advanceTimersByTime(2000); }); // 4000ms total, but timer reset at 2000
    // Second card still showing because its timer restarted.
    expect(screen.getByText('Second card')).toBeTruthy();
    expect(screen.queryByText('First card')).toBe(null);
    act(() => { vi.advanceTimersByTime(700); }); // total 2700ms past second draw
    expect(screen.queryByText('Second card')).toBe(null);
  });
});
