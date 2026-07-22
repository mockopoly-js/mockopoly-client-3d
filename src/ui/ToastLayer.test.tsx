import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastLayer } from './ToastLayer';
import { useGameStore } from '../state/gameStore';

describe('ToastLayer', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders current toasts', () => {
    render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('Maya bought a property!', 'success'); });
    expect(screen.getByText(/maya bought a property/i)).toBeTruthy();
  });

  it('auto-removes a toast after 3s', () => {
    render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('gone soon', 'info'); });
    expect(screen.getByText(/gone soon/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(useGameStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText(/gone soon/i)).toBe(null);
  });
});
