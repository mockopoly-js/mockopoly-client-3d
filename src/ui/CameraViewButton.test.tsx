import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CameraViewButton } from './CameraViewButton';
import { useGameStore } from '../state/gameStore';

describe('CameraViewButton', () => {
  beforeEach(() => { useGameStore.getState().reset(); });
  afterEach(() => { cleanup(); });

  it('toggles the store camera mode and its own pressed state', () => {
    render(<CameraViewButton />);
    const btn = screen.getByRole('button');
    expect(useGameStore.getState().cameraMode).toBe('free');
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(btn);
    expect(useGameStore.getState().cameraMode).toBe('thirdPerson');
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('has one layout — no useIsMobile branch — and matches MuteButton\'s frame', () => {
    render(<CameraViewButton />);
    const btn = screen.getByRole('button');
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
    expect(btn.style.zIndex).toBe('110');
    expect(btn.style.top).toBe('max(var(--sa-t), 8px)'); // the corner — see MuteButton.test
    // One 52px pitch (44px chip + 8px dead space) added on top of the exact
    // same floored anchor MuteButton uses — not a second, independent max().
    expect(btn.style.right).toBe('calc(max(var(--sa-r), 8px) + 52px)');
  });
});
