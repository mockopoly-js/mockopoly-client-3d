import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PropertyListPanel } from './PropertyListPanel';
import { HUD_TOGGLE_DEEDS } from './TurnHud';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import { BOARD_SPACES } from '../constants/board';
import { TOKEN_HEX } from '../constants/theme';
import type { GameState } from '../types/GameState';

/** Old Kent Road + Whitechapel Road — the two-property BROWN group. */
const props = BOARD_SPACES.filter((s) => s.type === 'property' && s.colorGroup).slice(0, 2);
const GROUP = props[0].colorGroup;

const seat = (id: string, name: string, token: string) => ({
  id, name, token, money: 15_000_000, position: 0,
  isJailed: false, isBankrupt: false, isConnected: true, isHost: false,
});

function setState(properties: unknown[], partnerships: unknown[] = []) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [seat('p1', 'Maya', 'red'), seat('p2', 'Jonas', 'blue'), seat('p3', 'Kwan', 'green')],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, partnerships, properties,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

const own = (index: number, ownerId: string, extra = {}) =>
  ({ spaceIndex: index, ownerId, houses: 0, hasHotel: false, isMortgaged: false, ...extra });

const setRows = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.kit-set')];
const pipsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>('.kit-pip')];

describe('PropertyListPanel', () => {
  beforeEach(() => useGameStore.getState().reset());

  it('lists my directly-owned properties with build badges', () => {
    setState([
      own(props[0].index, 'p1', { houses: 2 }),
      own(props[1].index, 'p2'),
    ]);
    render(<PropertyListPanel />);
    expect(screen.getByText(props[0].name)).toBeTruthy();     // mine
    expect(screen.queryByText(props[1].name)).toBe(null);      // not mine, not partnered
    expect(screen.getByText(/2 houses/i)).toBeTruthy();
  });

  it('opens the deeds panel from the cluster DEEDS button over the game bus', () => {
    setState([own(props[0].index, 'p1')]);
    const { container } = render(<PropertyListPanel />);
    expect(container.querySelector('.kit-panel')?.className).not.toContain('is-on');
    act(() => { gameBus.emit(HUD_TOGGLE_DEEDS); });
    expect(container.querySelector('.kit-panel')?.className).toContain('is-on');
  });

  // ── GAP 1 · partnership properties were indistinguishable ───────────────────

  it('includes properties owned via an active partnership on the group', () => {
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p2')],
      [{ colorGroup: GROUP, status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    render(<PropertyListPanel />);
    expect(screen.getByText(props[1].name)).toBeTruthy(); // via partnership
  });

  it("names the partner on THEIR property instead of listing it as plainly mine", () => {
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p2')],
      [{ colorGroup: GROUP, status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    const { container } = render(<PropertyListPanel />);
    // the partner's own name is on the row that belongs to them …
    expect(screen.getByText(/Jonas's/)).toBeTruthy();
    // … and the row is washed + dotted in THEIR token colour, not a new hue.
    const rows = [...container.querySelectorAll<HTMLElement>('.kit-panel button')];
    const partnerRow = rows.find((r) => r.innerHTML.includes(props[1].name));
    expect(partnerRow?.style.getPropertyValue('--pc')).toBe(TOKEN_HEX.blue);
    expect(partnerRow?.querySelector('.kit-dot')).not.toBe(null);
  });

  it('shows both equity shares in the deeds group header', () => {
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p2')],
      [{ colorGroup: GROUP, status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    render(<PropertyListPanel />);
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('1 shared', { exact: false })).toBeTruthy();
  });

  it('lights the partner pip in the set strip — an owned tile is never the unowned grey', () => {
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p2')],
      [{ colorGroup: GROUP, status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    const { container } = render(<PropertyListPanel />);
    const strip = setRows(container)[0];
    expect(strip.style.getPropertyValue('--pc')).toBe(TOKEN_HEX.blue);

    const pips = pipsOf(strip);
    expect(pips).toHaveLength(2);
    // both slots are HELD, so both are lit — otherwise the group reads incomplete
    expect(pips[0].className).toContain('is-on');
    expect(pips[1].className).toContain('is-on');
    // …but only the partner's carries an override off the group colour.
    expect(pips[0].getAttribute('style')).toBe(null);
    expect(pips[1].getAttribute('style')).not.toBe(null);
    // the count still means "how many are MINE"
    expect(strip.querySelector('.kit-set__count')?.textContent).toBe('1/2');
    expect(strip.textContent).toContain('60%');
  });

  it('never flags a partnered group as a monopoly, even when every tile is held', () => {
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p1')],
      [{ colorGroup: GROUP, status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    const { container } = render(<PropertyListPanel />);
    expect(container.querySelector('.kit-set__flag')).toBe(null);
    expect(container.querySelector('.kit-set.is-complete')).toBe(null);
  });

  it('flags a genuine solo monopoly', () => {
    setState([own(props[0].index, 'p1'), own(props[1].index, 'p1')]);
    const { container } = render(<PropertyListPanel />);
    expect(container.querySelector('.kit-set.is-complete')).not.toBe(null);
    expect(screen.getAllByText(/monopoly/i).length).toBeGreaterThan(0);
  });

  it('excludes a NON-partner property that merely sits in a partnered group', () => {
    // The old filter matched on the colour group alone, so a stranger's tile in
    // a partnered group was listed under "your properties".
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p3')],
      [{ colorGroup: GROUP, status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    const { container } = render(<PropertyListPanel />);
    expect(screen.queryByText(props[1].name)).toBe(null);
    expect(screen.queryByText(/Kwan's/)).toBe(null);
    expect(pipsOf(setRows(container)[0])[1].className).not.toContain('is-on');
  });

  it('ignores a partnership that is still pending', () => {
    setState(
      [own(props[0].index, 'p1'), own(props[1].index, 'p2')],
      [{ colorGroup: GROUP, status: 'pending', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }],
    );
    render(<PropertyListPanel />);
    expect(screen.queryByText(props[1].name)).toBe(null);
  });
});
