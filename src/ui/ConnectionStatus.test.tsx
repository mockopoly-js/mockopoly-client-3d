import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStatus } from './ConnectionStatus';
import { useGameStore } from '../state/gameStore';

describe('ConnectionStatus', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('says nothing at all while connected', () => {
    // The previous version shipped a permanent "Connected · <socket id>" pill in
    // the top-left corner — a debug readout, in the spot the HUD's turn strip
    // now occupies. Silence is the correct connected state.
    const { container } = render(<ConnectionStatus connected={true} playerId="abc123" />);
    expect(container.firstChild).toBe(null);
  });

  it('shows a plain connecting notice when there is no room to lose', () => {
    render(<ConnectionStatus connected={false} playerId={null} />);
    expect(screen.getByText(/connecting to the server/i)).toBeTruthy();
    // No clock: outside a room there is no seat being held.
    expect(screen.queryByText(/\ds/)).toBeNull();
  });

  it('counts the 60-second reconnect window down while in a room', () => {
    act(() => { useGameStore.getState().setRoomCode('KX7T2M'); });
    render(<ConnectionStatus connected={false} playerId={null} />);
    expect(screen.getByText(/reconnecting… 60s left/i)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(13_000); });
    expect(screen.getByText(/reconnecting… 47s left/i)).toBeTruthy();
  });

  it('reports the seat lost once the window closes', () => {
    act(() => { useGameStore.getState().setRoomCode('KX7T2M'); });
    render(<ConnectionStatus connected={false} playerId={null} />);
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText(/seat lost/i)).toBeTruthy();
    // It stops at zero rather than counting into negative seconds.
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByText(/seat lost/i)).toBeTruthy();
  });

  it('never intercepts a tap — it is read-only information over a live HUD', () => {
    const { container } = render(<ConnectionStatus connected={false} playerId={null} />);
    const stage = container.firstChild as HTMLElement;
    expect(stage.style.pointerEvents).toBe('none');
    // The stage, not an inner z-index, carries the layer: two fixed stages are
    // separate stacking contexts and cannot be ordered from the inside.
    expect(stage.style.position).toBe('fixed');
    expect(stage.style.zIndex).toBe('var(--z-toast)');
  });

  it('announces the state change to assistive tech', () => {
    render(<ConnectionStatus connected={false} playerId={null} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
