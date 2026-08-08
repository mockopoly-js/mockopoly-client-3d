import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertyCardModal } from './PropertyCardModal';
import { useGameStore } from '../state/gameStore';
import { BOARD_SPACES } from '../constants/board';
import type { GameState, Partnership } from '../types/GameState';
import { requireDefined } from '../test-utils';

// A regular property with a cardFrame (Old Kent Road, index 1)
const prop = requireDefined(BOARD_SPACES.find((s) => s.type === 'property' && s.cardFrame != null));
// A railroad (Kings Cross, index 5)
const railroad = requireDefined(BOARD_SPACES.find((s) => s.type === 'railroad'));
// The light-blue group, for the partnership (gap 2/3) tests — needs 3 members
// all owned so the "full colour set" framing in the sub-line is unambiguous.
const lightBlueGroup = BOARD_SPACES.filter((s) => s.type === 'property' && s.colorGroup === 'light-blue');
const angel = requireDefined(lightBlueGroup[0]); // owned by a partner, not me
const otherLightBlue = lightBlueGroup.slice(1);

function setDeedCard(
  spaceIndex: number,
  opts: {
    ownerId?: string | null;
    houses?: number;
    hasHotel?: boolean;
    isMortgaged?: boolean;
    partnerships?: Partnership[];
    extraProperties?: GameState['properties'];
  } = {},
) {
  useGameStore.getState().update({
    roomCode: 'TEST',
    status: 'in-progress',
    players: [
      { id: 'p1', name: 'Alice', token: 'red', money: 10_000_000 },
      { id: 'p2', name: 'Boris', token: 'blue', money: 10_000_000 },
    ],
    turn: { currentPlayerId: 'p1', phase: 'rolling' },
    config: { maxPlayers: 4 },
    properties: [
      {
        spaceIndex,
        ownerId: opts.ownerId !== undefined ? opts.ownerId : null,
        houses: opts.houses ?? 0,
        hasHotel: opts.hasHotel ?? false,
        isMortgaged: opts.isMortgaged ?? false,
      },
      ...(opts.extraProperties ?? []),
    ],
    partnerships: opts.partnerships ?? [],
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
  useGameStore.getState().openDeedCard(spaceIndex);
}

describe('PropertyCardModal', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('renders a closed (not-open) panel when deedCardIndex is null', () => {
    const { container } = render(<PropertyCardModal />);
    // GOTCHA #5 — the panel stays mounted (with just its close button, always
    // present per the `onClose` prop) so a close-slide can play; it is hidden
    // via aria-hidden / the .is-on class, never unmounted, and carries no deed
    // content while closed.
    expect(container.querySelector('.kit-panel.is-on')).toBeNull();
    expect(container.querySelector('.kit-panel')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.kit-deed')).toBeNull();
  });

  it('shows the deed (kit <Deed>, not the sprite) for a property', () => {
    setDeedCard(prop.index);
    const { container } = render(<PropertyCardModal />);
    expect(container.querySelector('[data-testid="deed-card"]')).toBeNull();
    expect(container.querySelector('.kit-deed')).not.toBeNull();
  });

  it('shows the property name', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(screen.getByText(prop.name)).toBeTruthy();
  });

  it('shows "Unowned" when ownerId is null', () => {
    setDeedCard(prop.index, { ownerId: null });
    render(<PropertyCardModal />);
    expect(screen.getByText(/unowned/i)).toBeTruthy();
  });

  it('shows owner name when ownerId is set', () => {
    setDeedCard(prop.index, { ownerId: 'p2' });
    render(<PropertyCardModal />);
    expect(screen.getByText(/owned by boris/i)).toBeTruthy();
  });

  it('shows "owned by you" for p1 as owner', () => {
    setDeedCard(prop.index, { ownerId: 'p1' });
    render(<PropertyCardModal />);
    expect(screen.getByText(/owned by you/i)).toBeTruthy();
  });

  it('shows the mortgaged treatment when isMortgaged', () => {
    setDeedCard(prop.index, { isMortgaged: true });
    const { container } = render(<PropertyCardModal />);
    expect(container.querySelector('.kit-deed.is-mortgaged')).not.toBeNull();
  });

  it('shows "Mortgaged" state label when isMortgaged', () => {
    setDeedCard(prop.index, { isMortgaged: true });
    render(<PropertyCardModal />);
    expect(screen.getByText(/mortgaged/i)).toBeTruthy();
  });

  it('shows house count label when houses > 0', () => {
    setDeedCard(prop.index, { ownerId: 'p1', houses: 3 });
    const { container } = render(<PropertyCardModal />);
    // "3 houses" appears twice by design — the Badge (supporting confirmation)
    // and the matching, gold-highlighted rent-ladder row (primary carrier).
    expect(container.querySelector('.kit-badge')?.textContent).toBe('3 houses');
    expect(container.querySelector('.kit-deed__row.is-current')?.textContent).toContain('3 houses');
  });

  it('shows "Hotel" label when hasHotel is true', () => {
    setDeedCard(prop.index, { ownerId: 'p1', hasHotel: true });
    const { container } = render(<PropertyCardModal />);
    expect(container.querySelector('.kit-badge')?.textContent).toBe('Hotel');
    expect(container.querySelector('.kit-deed__row.is-current')?.textContent).toContain('Hotel');
  });

  it('shows the rent ladder with the current tier highlighted', () => {
    setDeedCard(prop.index, { ownerId: 'p2', houses: 2 });
    const { container } = render(<PropertyCardModal />);
    const current = container.querySelector('.kit-deed__row.is-current');
    expect(current?.textContent).toContain('2 houses');
  });

  it('Close button clears deedCardIndex', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(useGameStore.getState().deedCardIndex).toBe(prop.index);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });

  it('clicking the scrim closes the modal', () => {
    setDeedCard(prop.index);
    const { container } = render(<PropertyCardModal />);
    const scrim = requireDefined(container.querySelector('.kit-scrim'));
    fireEvent.click(scrim);
    expect(useGameStore.getState().deedCardIndex).toBe(null);
  });

  it('works for a railroad space (no rent ladder, no crash)', () => {
    setDeedCard(railroad.index);
    render(<PropertyCardModal />);
    expect(screen.getByText(railroad.name)).toBeTruthy();
  });

  it('has NO buy button (read-only)', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(screen.queryByRole('button', { name: /buy/i })).toBe(null);
  });

  it('has NO mortgage button (read-only)', () => {
    setDeedCard(prop.index, { ownerId: 'p1' });
    render(<PropertyCardModal />);
    expect(screen.queryByRole('button', { name: /mortgage/i })).toBe(null);
  });

  it('does not affect selectedPropertyIndex or showPropertyCard (MortgagePanel isolation)', () => {
    setDeedCard(prop.index);
    render(<PropertyCardModal />);
    expect(useGameStore.getState().selectedPropertyIndex).toBe(null);
    expect(useGameStore.getState().showPropertyCard).toBe(false);
  });

  // ── GAP 2 — partnership visibility ────────────────────────────────────────

  it('GAP 2 — names the owner, that I am a partner, and my equity, on a partner-owned tile', () => {
    setDeedCard(angel.index, {
      ownerId: 'p2', // Boris owns THIS tile
      extraProperties: otherLightBlue.map((s) => ({ spaceIndex: s.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false })),
      partnerships: [
        { partnershipId: 'ps1', colorGroup: 'light-blue', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }], status: 'active', createdAt: 0 },
      ],
    });
    render(<PropertyCardModal />);
    expect(screen.getByText(/owned by boris/i)).toBeTruthy();
    expect(screen.getByText(/partnership/i)).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    // "Boris" appears twice — the sub-line ("Owned by Boris") and the
    // partnership row — so assert presence, not a single match.
    expect(screen.getAllByText(/boris/i).length).toBeGreaterThan(0);
    expect(screen.getByText('40%')).toBeTruthy();
  });

  it('GAP 2 — shows no partnership block when I am not a partner in this colour group', () => {
    setDeedCard(prop.index, { ownerId: 'p2', partnerships: [] });
    render(<PropertyCardModal />);
    expect(screen.queryByText(/partnership/i)).toBeNull();
  });

  // ── GAP 3 — the rent-ladder "second reading" ──────────────────────────────
  // One block serves both gaps: the equity percentages (gap 2) always show;
  // the £ split of the currently-active tier (gap 3) joins them only when a
  // tier is actually active right now.

  it('GAP 3 — splits the currently-active tier’s rent by equity for a partnered property', () => {
    setDeedCard(angel.index, {
      ownerId: 'p2',
      extraProperties: otherLightBlue.map((s) => ({ spaceIndex: s.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false })),
      partnerships: [
        { partnershipId: 'ps1', colorGroup: 'light-blue', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }], status: 'active', createdAt: 0 },
      ],
    });
    const { container } = render(<PropertyCardModal />);
    expect(screen.getByText(/this tier/i)).toBeTruthy();
    // Angel Islington is unimproved but the light-blue set is fully owned
    // (across the partnership) -> "with colour set" tier -> base rent x2
    // (60K x 2 = 120K), split 60/40 -> 72K mine, 48K the partner's.
    const amounts = Array.from(container.querySelectorAll('.kit-money')).map((n) => n.textContent);
    expect(amounts).toContain('£72K');
    expect(amounts).toContain('£48K');
  });

  it('GAP 3 — no £ split for an unowned property even inside a partnered group (still names the partners)', () => {
    setDeedCard(angel.index, {
      ownerId: null,
      partnerships: [
        { partnershipId: 'ps1', colorGroup: 'light-blue', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }], status: 'active', createdAt: 0 },
      ],
    });
    render(<PropertyCardModal />);
    // Equity still shown (gap 2) …
    expect(screen.getByText('60%')).toBeTruthy();
    // … but no "this tier" split, and no rent-split money value, since there
    // is no owner to collect rent right now.
    expect(screen.queryByText(/this tier/i)).toBeNull();
  });
});
