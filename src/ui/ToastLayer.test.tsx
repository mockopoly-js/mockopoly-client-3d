import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastLayer } from './ToastLayer';
import { useGameStore } from '../state/gameStore';

const toasts = (root: ParentNode) => [...root.querySelectorAll('.kit-toast')];

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

  it('lights each toast on the tick after mount, so the entrance has a frame to run', () => {
    const { container } = render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('hello', 'info'); });
    expect(toasts(container)[0].className).not.toContain('is-on');
    act(() => { vi.advanceTimersByTime(1); });
    expect(toasts(container)[0].className).toContain('is-on');
  });

  it('HARD CAP: never more than two on screen, and the store is trimmed too', () => {
    const { container } = render(<ToastLayer />);
    act(() => {
      const s = useGameStore.getState();
      // 1ms apart: the store stamps a toast with Date.now() and uses that as
      // its id, so a same-millisecond pair is one id and one removable unit.
      for (const m of ['one', 'two', 'three', 'four']) {
        s.addToast(m, 'info');
        vi.advanceTimersByTime(1);
      }
    });
    expect(toasts(container)).toHaveLength(2);
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.getByText('four')).toBeTruthy();
    // the cap sweep rides the same watchdog tick, so the store cannot keep a
    // backlog that would resurface the moment one expires
    act(() => { vi.advanceTimersByTime(200); });
    expect(useGameStore.getState().toasts).toHaveLength(2);
  });

  it('tears down by MEASURED AGE when the per-toast timer never fires', () => {
    // Mechanism 2. A throttled tab can defer a setTimeout indefinitely, so the
    // watchdog reaps on Date.now() against the store's own creation stamp.
    const t0 = Date.now();
    render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('stuck', 'warning'); });
    expect(screen.getByText('stuck')).toBeTruthy();

    vi.setSystemTime(t0 + 60_000);
    act(() => { vi.advanceTimersByTime(200); });
    expect(useGameStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText('stuck')).toBe(null);
  });

  it('maps the store tone onto the kit tone', () => {
    const { container } = render(<ToastLayer />);
    act(() => { useGameStore.getState().addToast('paid', 'success'); });
    expect(toasts(container)[0].className).toContain('kit-toast--good');
  });
});
