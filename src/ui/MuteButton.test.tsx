import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MuteButton } from './MuteButton';
import { isMuted, setMuted } from '../audio/sfx';

describe('MuteButton', () => {
  afterEach(() => {
    cleanup();
    setMuted(false);
  });

  it('toggles the label and persisted mute state on click', () => {
    render(<MuteButton />);
    const btn = screen.getByRole('button');
    const initiallyMuted = isMuted();
    expect(btn.getAttribute('aria-label')).toBe(initiallyMuted ? 'Unmute' : 'Mute');

    fireEvent.click(btn);
    expect(isMuted()).toBe(!initiallyMuted);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(!initiallyMuted ? 'Unmute' : 'Mute');
  });

  it('is the 44x44 tap floor, on the kit HUD layer, anchored by max() not calc(inset+pad)', () => {
    render(<MuteButton />);
    const btn = screen.getByRole('button');
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
    // Z.hud from ./kit — the shared layer for all three chrome buttons, below
    // the toast layer (Z.toast). Never a raw literal.
    expect(btn.style.zIndex).toBe('110');
    // The outermost (rightmost) chip: right offset is exactly `max(var(--sa-r),
    // 8px)`. A `calc(env(...) + 8px)` here would double-count the safe inset.
    expect(btn.style.right).toBe('max(var(--sa-r), 8px)');
    // THE CORNER, and the same `max()` shape on the vertical axis. --sa-t is 0
    // in a landscape Safari tab and ~20 in an installed PWA, so this is 8px of
    // design gutter on one and true notch clearance on the other, from one
    // expression. (It was `max(var(--sa-t), 96px)` — a hole punched in the
    // right edge to clear the toast stack, before the toast stack yielded.)
    expect(btn.style.top).toBe('max(var(--sa-t), 8px)');
  });
});
