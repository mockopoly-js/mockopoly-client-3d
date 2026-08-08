import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FullscreenButton } from './FullscreenButton';

describe('FullscreenButton', () => {
  let requestFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); });

  it('renders nothing when the Fullscreen API is unavailable (iPhone Safari)', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
    const { container } = render(<FullscreenButton />);
    expect(container.firstChild).toBe(null);
  });

  it('requests fullscreen on click when supported', () => {
    render(<FullscreenButton />);
    fireEvent.click(screen.getByRole('button'));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('has one layout — no useIsMobile branch — and matches the shared chrome frame', () => {
    render(<FullscreenButton />);
    const btn = screen.getByRole('button');
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
    expect(btn.style.zIndex).toBe('110');
    expect(btn.style.top).toBe('max(var(--sa-t), 8px)'); // the corner — see MuteButton.test
    // Two 52px pitches added on top of the exact same floored anchor
    // MuteButton uses — not a second, independent max().
    expect(btn.style.right).toBe('calc(max(var(--sa-r), 8px) + 104px)');
  });
});
