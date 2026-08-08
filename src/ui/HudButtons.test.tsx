import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HudButtons } from './HudButtons';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import type { GameState } from '../types/GameState';

// Same debt shape App.tsx's mustPay selector and <BankruptcyPanel> read:
// turn.mustPayRent AND the debt sits on ME (turn.currentPlayerId === myPlayerId).
function putInDebt(inDebt: boolean) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money: 0, position: 0, isBankrupt: false, isConnected: true }],
    turn: {
      currentPlayerId: 'p1', phase: 'action', hasRolled: true,
      mustPayRent: inDebt, rentAmount: inDebt ? 500_000 : null,
    },
    config: { maxPlayers: 4 },
    properties: [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('HudButtons', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('renders nothing when mounted bare — it is a cluster, not a screen surface', () => {
    // App.tsx still mounts <HudButtons /> as a top-level sibling. Drawing an
    // unpositioned cluster there would drop three buttons at the top-left of
    // the document; the real home is inside <ActionsSheet>.
    const { container } = render(<HudButtons />);
    expect(container.firstChild).toBe(null);
  });

  it('opens each negotiation panel via its store flag', () => {
    render(<HudButtons inline />);
    fireEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(useGameStore.getState().showTradePanel).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /partnership/i }));
    expect(useGameStore.getState().showPartnershipPanel).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /deal/i }));
    expect(useGameStore.getState().showDealPanel).toBe(true);
  });

  it('reports back so a host popover can close itself', () => {
    let closed = 0;
    render(<HudButtons inline onPick={() => { closed += 1; }} />);
    fireEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(closed).toBe(1);
  });

  it('does not render RAISE CASH when the player is not in debt — no disabled button either', () => {
    putInDebt(false);
    render(<HudButtons inline />);
    expect(screen.queryByRole('button', { name: /raise cash/i })).toBeNull();
  });

  it('renders RAISE CASH when in debt and emits open-liquidation on click', () => {
    putInDebt(true);
    const onLiquidation = vi.fn();
    gameBus.on('open-liquidation', onLiquidation);
    render(<HudButtons inline />);
    const button = screen.getByRole('button', { name: /raise cash/i });
    fireEvent.click(button);
    expect(onLiquidation).toHaveBeenCalledTimes(1);
    gameBus.off('open-liquidation', onLiquidation);
  });
});
