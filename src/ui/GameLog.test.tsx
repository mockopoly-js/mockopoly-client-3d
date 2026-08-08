import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GameLog } from './GameLog';
import { HUD_TOGGLE_LOG } from './TurnHud';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import type { GameState } from '../types/GameState';

function setLog(messages: string[]) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress', players: [], turn: { currentPlayerId: null },
    config: { maxPlayers: 4 }, properties: [],
    log: messages.map((m, i) => ({ timestamp: i, playerId: null, message: m, type: 'system' })),
  } as unknown as GameState);
}

const items = (root: ParentNode) => [...root.querySelectorAll('.kit-eventlog__item')];

describe('GameLog', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('shows the most recent entries newest-first', () => {
    setLog(['first', 'second', 'third']);
    const { container } = render(<GameLog />);
    const rows = items(container);
    expect(rows[0].textContent).toContain('third');
    expect(rows[rows.length - 1].textContent).toContain('first');
  });

  it('caps at 8 entries — the open list is 212px and an item is one 25.4px line', () => {
    setLog(Array.from({ length: 20 }, (_, i) => `m${i}`));
    const { container } = render(<GameLog />);
    expect(items(container)).toHaveLength(8);
  });

  it('peeks the newest entry when collapsed', () => {
    setLog(['old', 'newest']);
    const { container } = render(<GameLog />);
    expect(container.querySelector('.kit-eventlog__last')?.textContent).toBe('newest');
    expect(container.querySelector('.kit-eventlog')?.className).not.toContain('is-open');
  });

  it('grows from a BOTTOM-PINNED anchor, so the 44px tap target never moves', () => {
    setLog(['a', 'b']);
    const { container } = render(<GameLog />);
    const el = container.querySelector<HTMLElement>('.kit-eventlog');
    expect(el?.style.bottom).toBe('0px');
    // column-reverse puts the history ABOVE the peek instead of pushing it down
    // through the bottom safe inset.
    expect(el?.style.flexDirection).toBe('column-reverse');
  });

  it('opens from the cluster LOG button over the game bus', () => {
    setLog(['a']);
    const { container } = render(<GameLog />);
    act(() => { gameBus.emit(HUD_TOGGLE_LOG); });
    expect(container.querySelector('.kit-eventlog')?.className).toContain('is-open');
    act(() => { gameBus.emit(HUD_TOGGLE_LOG); });
    expect(container.querySelector('.kit-eventlog')?.className).not.toContain('is-open');
  });
});
