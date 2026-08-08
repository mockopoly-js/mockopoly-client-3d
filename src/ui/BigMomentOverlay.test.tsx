import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BigMomentOverlay } from './BigMomentOverlay';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import type { GameState } from '../types/GameState';

function players() {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [
      { id: 'p1', name: 'Maya', token: 'red', isBankrupt: false },
      { id: 'p2', name: 'Jonas', token: 'blue', isBankrupt: false },
      { id: 'p3', name: 'Kwan', token: 'green', isBankrupt: false },
    ],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

const cardText = (root: ParentNode) => root.querySelector('[role="status"]')?.textContent ?? '';
const moneyTexts = (root: ParentNode) =>
  [...root.querySelectorAll('.kit-money')].map((n) => n.textContent);

describe('BigMomentOverlay', () => {
  beforeEach(() => { useGameStore.getState().reset(); players(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('shows nothing initially', () => {
    const { container } = render(<BigMomentOverlay />);
    expect(container.firstChild).toBe(null);
  });

  it('announces a rent hit with both names and the amount', () => {
    const { container } = render(<BigMomentOverlay />);
    act(() => { gameBus.emit('rent-collected', { fromId: 'p2', toId: 'p1', amount: 2_400_000, spaceIndex: 6 }); });
    expect(cardText(container)).toMatch(/jonas/i);
    expect(cardText(container)).toMatch(/maya/i);
    expect(moneyTexts(container)).toContain('£2.400M');
  });

  it('announces jail and auto-dismisses', () => {
    render(<BigMomentOverlay />);
    act(() => { gameBus.emit('jail-sent', { playerId: 'p1' }); });
    expect(screen.getByText(/maya → jail/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2800); });
    expect(screen.queryByText(/jail/i)).toBe(null);
  });

  it('announces bankruptcy with the remaining head count', () => {
    const { container } = render(<BigMomentOverlay />);
    act(() => { gameBus.emit('player-bankrupt', { playerId: 'p2', creditorId: 'p1' }); });
    expect(cardText(container)).toMatch(/jonas went bankrupt/i);
    expect(cardText(container)).toMatch(/2 players left/i);
  });

  // ── GAP 2 · PARTNERSHIP_RENT_SPLIT / PARTNERSHIP_BUILD_COST_SPLIT ──────────
  // Both events already reached the client bus and nothing had ever consumed
  // them, in either client: rent was split and no one was told.

  it('renders a rent split: who paid, on what, and each partner share', () => {
    const { container } = render(<BigMomentOverlay />);
    act(() => {
      gameBus.emit('partnership-rent-split', {
        spaceIndex: 1, // Old Kent Road
        fromId: 'p3',
        splits: [{ playerId: 'p1', amount: 600_000 }, { playerId: 'p2', amount: 400_000 }],
      });
    });
    const text = cardText(container);
    expect(text).toMatch(/rent split/i);
    expect(text).toMatch(/kwan paid rent on old kent road/i);
    expect(text).toMatch(/you/i);      // my own share is named "You"
    expect(text).toMatch(/jonas/i);    // the partner is named
    expect(moneyTexts(container)).toEqual(['£600K', '£400K']);
  });

  it('renders a build-cost split as an outgoing spend', () => {
    const { container } = render(<BigMomentOverlay />);
    act(() => {
      gameBus.emit('partnership-build-cost-split', {
        spaceIndex: 3, // Whitechapel Road
        splits: [{ playerId: 'p1', amount: 3_000_000 }, { playerId: 'p2', amount: 2_000_000 }],
      });
    });
    expect(cardText(container)).toMatch(/build split/i);
    expect(cardText(container)).toMatch(/building on whitechapel road/i);
    expect(container.querySelector('.kit-money--loss')).not.toBe(null);
    expect(container.querySelector('.kit-money--gain')).toBe(null);
  });

  it('scales to a three-way split without special-casing', () => {
    const { container } = render(<BigMomentOverlay />);
    act(() => {
      gameBus.emit('partnership-rent-split', {
        spaceIndex: 1, fromId: 'p3',
        splits: [
          { playerId: 'p1', amount: 500_000 },
          { playerId: 'p2', amount: 300_000 },
          { playerId: 'p3', amount: 200_000 },
        ],
      });
    });
    expect(moneyTexts(container)).toHaveLength(3);
  });

  it('gives the split a longer, but still guaranteed, lifetime', () => {
    render(<BigMomentOverlay />);
    act(() => {
      gameBus.emit('partnership-rent-split', {
        spaceIndex: 1, fromId: 'p3', splits: [{ playerId: 'p1', amount: 600_000 }],
      });
    });
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByText(/rent split/i)).not.toBe(null);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByText(/rent split/i)).toBe(null);
  });

  it('tears down by MEASURED AGE even when the per-moment timer never fires', () => {
    // Mechanism 2. A backgrounded tab can defer a setTimeout indefinitely; the
    // 200ms watchdog reaps on Date.now() and cannot be starved the same way.
    const t0 = Date.now();
    const { container } = render(<BigMomentOverlay />);
    act(() => { gameBus.emit('jail-sent', { playerId: 'p1' }); });
    expect(container.querySelector('[role="status"]')).not.toBe(null);

    vi.setSystemTime(t0 + 60_000);          // the clock moved on…
    act(() => { vi.advanceTimersByTime(200); }); // …one watchdog tick is enough
    expect(container.querySelector('[role="status"]')).toBe(null);
  });

  it('replaces a live moment rather than stacking two inert cards', () => {
    const { container } = render(<BigMomentOverlay />);
    act(() => { gameBus.emit('jail-sent', { playerId: 'p1' }); });
    act(() => { gameBus.emit('player-bankrupt', { playerId: 'p2', creditorId: 'p1' }); });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(cardText(container)).toMatch(/bankrupt/i);
  });
});
