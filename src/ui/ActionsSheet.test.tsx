import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionsSheet } from './ActionsSheet';
import { useGameStore } from '../state/gameStore';

describe('ActionsSheet', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('renders nothing while closed', () => {
    const { container } = render(<ActionsSheet open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBe(null);
  });

  it('holds the three negotiation actions, one definition shared with HudButtons', () => {
    render(<ActionsSheet open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /trade/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /partnership/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /deal/i })).toBeTruthy();
  });

  it('opens a panel and closes itself in one tap', () => {
    const onClose = vi.fn();
    render(<ActionsSheet open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /partnership/i }));
    expect(useGameStore.getState().showPartnershipPanel).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on an outside tap', () => {
    const onClose = vi.fn();
    const { container } = render(<ActionsSheet open onClose={onClose} />);
    const scrim = container.querySelector('[aria-hidden="true"]');
    expect(scrim).not.toBe(null);
    if (scrim) fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('anchors ABOVE the cluster without joining its flow, so the primary never moves', () => {
    const { container } = render(<ActionsSheet open onClose={vi.fn()} />);
    const sheet = container.querySelector<HTMLElement>('[role="menu"]');
    expect(sheet?.style.position).toBe('absolute');
    expect(sheet?.style.bottom).toBe('100%');
  });
});
