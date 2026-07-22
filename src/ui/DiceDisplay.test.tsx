import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DiceDisplay } from './DiceDisplay';
import { gameBus } from '../state/gameBus';

describe('DiceDisplay', () => {
  it('renders nothing before a roll', () => {
    const { container } = render(<DiceDisplay />);
    expect(container.querySelectorAll('[data-die]')).toHaveLength(0);
  });
  it('shows two dice with the rolled values', () => {
    render(<DiceDisplay />);
    act(() => { gameBus.emit('dice-rolled', { playerId: 'p1', dice: [5, 3], isDoubles: false }); });
    const dice = screen.getAllByRole('img'); // each die has role=img + aria-label
    expect(dice).toHaveLength(2);
    expect(dice[0].getAttribute('aria-label')).toBe('die showing 5');
    expect(dice[1].getAttribute('aria-label')).toBe('die showing 3');
  });
});
