import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noop, requireDefined } from '../test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnHud } from './TurnHud';
import { TakeoverHost } from './takeoverParts';
import { useTakeoverStack } from './takeoverStage';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function setState(
  turn: Partial<Record<string, unknown>>,
  playerOverrides: Partial<Record<string, unknown>> = {},
  money = 15_000_000,
  extra: Partial<Record<string, unknown>> = {},
) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{
      id: 'p1', name: 'Maya', token: 'red', money, position: 0,
      isBankrupt: false, isConnected: true,
      isJailed: false, jailTurns: 0, jailCardCount: 0,
      ...playerOverrides,
    }],
    turn: { currentPlayerId: 'p1', phase: 'waiting', hasRolled: false, doublesCount: 0, ...turn },
    config: { maxPlayers: 4 }, properties: [],
    ...extra,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

/** The kit's <Money> splits into three nodes, so assert on the composed text. */
function moneyTexts(root: ParentNode) {
  return [...root.querySelectorAll('.kit-money')].map((n) => n.textContent);
}
/** The gold phase line inside the turn strip. */
function phaseText(root: ParentNode) {
  return root.querySelector('.kit-turnstrip__phase')?.textContent;
}

/** The HUD's own fixed stage — the node that stands down. */
function hudStage(root: HTMLElement): HTMLElement {
  return requireDefined(root.firstElementChild as HTMLElement | null);
}

describe('TurnHud', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useTakeoverStack.setState({ stack: [] });
    vi.restoreAllMocks();
  });

  // ── Non-jailed roll ──────────────────────────────────────────────────────────

  it('enables Roll on my waiting turn and emits TURN_ROLL_DICE (not jailed)', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const roll = screen.getByRole('button', { name: /roll dice/i });
    expect((roll as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(roll);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_ROLL_DICE);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.JAIL_ROLL);
  });

  it('parks the primary in the inert waiting state mid-move and still shows my money', () => {
    // Mid-move NEITHER turn action is correct, and the waiting state is the one
    // place the primary still carries words: a die and a ✕ cannot say "Moving…".
    // So the icon pair is replaced by the kit's `waiting` primary — still 48px,
    // so the cluster never jumps — and neither icon is left on screen to be
    // stabbed at. (This used to drop a greyed "End turn" into a second row; the
    // pair below took that row's job and its space.)
    setState({ phase: 'moving', hasRolled: true });
    const { container } = render(<TurnHud />);
    const primary = container.querySelector('.kit-btn--primary');
    expect(primary?.className).toContain('is-waiting');
    expect(primary?.getAttribute('aria-disabled')).toBe('true');
    expect(primary?.textContent).toMatch(/moving/i);
    expect(screen.queryByRole('button', { name: /^end turn$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^roll dice$/i })).toBeNull();
    expect(moneyTexts(container)).toContain('£15.000M');
  });

  it('enables End Turn in action phase and emits TURN_END', () => {
    setState({ phase: 'action', hasRolled: true });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const endBtn = screen.getByRole('button', { name: /end turn/i });
    expect((endBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(endBtn);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_END);
  });

  // ── The turn pair: two icon-only controls, fixed positions ──────────────────
  //
  // The die and the ✕ replaced a labelled primary plus a labelled inert
  // secondary. Two things have to hold or the change is a regression: the
  // ACCESSIBLE NAME survives the loss of the visible text, and both controls are
  // always present so neither ever changes position between turn states.

  it('the roll control is a bare die — no text — but is still named "Roll dice"', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const roll = screen.queryByRole('button', { name: /roll dice/i });
    expect(roll).toBeNull(); // nothing rendered yet
    const { container } = render(<TurnHud />);
    const btn = screen.getByRole('button', { name: 'Roll dice' });
    expect(btn.className).toContain('kit-btn--square');
    expect(btn.querySelector('.kit-btn__label')).toBeNull();
    expect(btn.querySelector('.kit-dice')).not.toBeNull();
    // ...and it is the turn-lit primary, not the 44px utility chip.
    expect(btn.className).toContain('kit-btn--primary');
    expect(container.querySelectorAll('.kit-btn--square')).toHaveLength(2);
  });

  it('the end control is a bare ✕ — no text — but is still named "End turn"', () => {
    setState({ phase: 'action', hasRolled: true });
    render(<TurnHud />);
    const btn = screen.getByRole('button', { name: 'End turn' });
    expect(btn.className).toContain('kit-btn--square');
    expect(btn.querySelector('.kit-btn__label')).toBeNull();
    expect(btn.querySelector('.kit-btn__glyph')).not.toBeNull();
  });

  it('BOTH turn controls are always mounted, so neither ever moves under the thumb', () => {
    // Roll live -> End inert, and the reverse. The pair, and its order, is
    // identical in both; only which one is disabled changes.
    const names = (root: ParentNode) => [...root.querySelectorAll('.kit-btn--square')]
      .map((b) => [b.getAttribute('aria-label'), (b as HTMLButtonElement).disabled]);

    setState({ phase: 'waiting', hasRolled: false });
    const rollState = render(<TurnHud />);
    expect(names(rollState.container)).toEqual([['Roll dice', false], ['End turn', true]]);
    rollState.unmount();

    setState({ phase: 'action', hasRolled: true });
    const endState = render(<TurnHud />);
    expect(names(endState.container)).toEqual([['Roll dice', true], ['End turn', false]]);
  });

  it('an inert twin cannot be fired', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(emit).not.toHaveBeenCalled();
  });

  it('the jail wording survives the loss of the visible label', () => {
    // "Roll for doubles" is a materially different action from "Roll dice" and
    // the die cannot draw the difference, so it moves to the accessible name
    // rather than being dropped. The gold phase line carries it visually.
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 1 });
    render(<TurnHud />);
    expect(screen.getByRole('button', { name: 'Roll for doubles' })).toBeTruthy();
  });

  it('a spectator gets the waiting sentence and NO turn controls at all', () => {
    setState({ phase: 'action', hasRolled: true }, { isBankrupt: true });
    const { container } = render(<TurnHud />);
    expect(container.querySelectorAll('.kit-btn--square')).toHaveLength(0);
    expect(container.querySelector('.kit-btn--primary')?.textContent).toMatch(/spectating/i);
  });

  // ── Jailed roll branch ───────────────────────────────────────────────────────

  it('emits TURN_ROLL_DICE (not JAIL_ROLL) when jailed player clicks Roll', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 1, jailCardCount: 0 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const roll = screen.getByRole('button', { name: /roll for doubles/i });
    expect((roll as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(roll);
    expect(emit).toHaveBeenCalledWith(EVENTS.TURN_ROLL_DICE);
    expect(emit).not.toHaveBeenCalledWith(EVENTS.JAIL_ROLL);
  });

  // ── Jail action buttons ──────────────────────────────────────────────────────

  it('shows Pay Fine and Use Card buttons only when jailed and waiting', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    render(<TurnHud />);
    expect(screen.getByRole('button', { name: /pay fine/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /use card/i })).toBeTruthy();
  });

  it('the jail row KEEPS its words while the turn pair loses theirs', () => {
    // The line where icon-only stops. A price and a finite asset have no
    // universal glyph, and both cost real money to get wrong.
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    const { container } = render(<TurnHud />);
    const labels = [...container.querySelectorAll('.kit-btn__label')].map((n) => n.textContent);
    expect(labels).toContain('Pay £500K');
    expect(labels).toContain('Use card');
    // ...and the two squares beside them carry no label node whatsoever.
    for (const sq of container.querySelectorAll('.kit-btn--square')) {
      expect(sq.querySelector('.kit-btn__label')).toBeNull();
    }
  });

  it('does NOT show jail buttons when not jailed', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: false });
    render(<TurnHud />);
    expect(screen.queryByRole('button', { name: /pay fine/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /use card/i })).toBeNull();
  });

  it('Pay Fine button emits JAIL_PAY_FINE', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 0 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    fireEvent.click(screen.getByRole('button', { name: /pay fine/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.JAIL_PAY_FINE);
  });

  it('Use Card button emits JAIL_USE_CARD when player has cards', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(noop);
    render(<TurnHud />);
    const useCard = screen.getByRole('button', { name: /use card/i });
    expect((useCard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(useCard);
    expect(emit).toHaveBeenCalledWith(EVENTS.JAIL_USE_CARD);
  });

  it('Use Card button is disabled when jailCardCount is 0', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 0 });
    render(<TurnHud />);
    const useCard = screen.getByRole('button', { name: /use card/i });
    expect((useCard as HTMLButtonElement).disabled).toBe(true);
  });

  it('jail action buttons hidden once past waiting phase (e.g. action)', () => {
    setState({ phase: 'action', hasRolled: true }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    render(<TurnHud />);
    expect(screen.queryByRole('button', { name: /pay fine/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /use card/i })).toBeNull();
  });

  // ── GAP 3 · the jail turn counter was invisible ─────────────────────────────

  it('names the jail attempt number, so the forced fine is never a surprise', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 1, jailCardCount: 0 });
    const { container } = render(<TurnHud />);
    expect(phaseText(container)).toMatch(/attempt 2 of 3/i);
  });

  it('warns explicitly on the last attempt instead of just counting', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 2, jailCardCount: 0 });
    const { container } = render(<TurnHud />);
    expect(phaseText(container)).toMatch(/last attempt/i);
    expect(phaseText(container)).toMatch(/£500K/);
  });

  // ── GAP 4 · the jail card count was invisible ───────────────────────────────

  it('shows how many jail cards I hold, even when I am not in jail', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: false, jailCardCount: 2 });
    render(<TurnHud />);
    expect(screen.getByText(/2 jail cards/i)).toBeTruthy();
  });

  it('rides the card count on the Use Card button as a count badge', () => {
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 3 });
    const useCard = render(<TurnHud />).container
      .querySelector('.kit-btn .kit-badge--count');
    expect(useCard?.textContent).toBe('3');
  });

  // ── GAP 5 · the doubles counter was invisible ───────────────────────────────

  it('reports the doubles count and the jail threshold', () => {
    setState({ phase: 'waiting', hasRolled: false, doublesCount: 1 });
    const { container } = render(<TurnHud />);
    expect(phaseText(container)).toMatch(/doubles 1 of 3/i);
    expect(screen.getByText('Doubles 1/3')).toBeTruthy();
  });

  it('escalates the wording on the second double', () => {
    setState({ phase: 'waiting', hasRolled: false, doublesCount: 2 });
    const { container } = render(<TurnHud />);
    expect(phaseText(container)).toMatch(/one more is jail/i);
  });

  // ── The action column's stacking order ─────────────────────────────────────

  it('stacks the column bottom-up: turn pair, then DEEDS/MORE/LOG, then the jail row', () => {
    // <ZoneAct> is a bottom-anchored flex column, so DOM order is top-to-bottom
    // on screen and the LAST row is the one under the thumb. This is the order
    // the whole layout change exists to produce, so it is asserted rather than
    // left to a screenshot.
    setState({ phase: 'waiting', hasRolled: false }, { isJailed: true, jailTurns: 0, jailCardCount: 1 });
    const { container } = render(<TurnHud />);
    const rows = [...requireDefined(container.querySelector('.kit-zone-act')).children]
      .filter((el) => el.classList.contains('kit-btn-row'))
      .map((row) => [...row.children].map((b) => b.getAttribute('aria-label')));

    expect(rows).toEqual([
      ['Pay fine', null],                 // jail row — "Use card" names itself
      ['My properties', 'More actions', 'Event log'],
      ['Roll for doubles', 'End turn'],   // the pair, closest to the thumb
    ]);
  });

  // ── Centre readout ──────────────────────────────────────────────────────────

  it('shows the Free Parking pot when it is non-zero', () => {
    setState({ phase: 'waiting', hasRolled: false }, {}, 15_000_000, { freeParkingPool: 5_000_000 });
    const { container } = render(<TurnHud />);
    expect(screen.getByText(/free parking pot/i)).toBeTruthy();
    expect(moneyTexts(container)).toContain('£5.000M');
  });

  it('does NOT show the Free Parking pot when it is 0', () => {
    setState({ phase: 'waiting', hasRolled: false });
    expect(screen.queryByText(/free parking pot/i)).toBeNull();
    render(<TurnHud />);
    expect(screen.queryByText(/free parking pot/i)).toBeNull();
  });

  // ── The HUD yields to a takeover ───────────────────────────────────────────
  //
  // A takeover's middle column is transparent BY DESIGN — `.rn-tk` has no fill
  // and the window layer masks a band down to 66% so the live board reads
  // through the verdict. This HUD sits at --z-hud (110) directly under it, so
  // the centre readout printed "FREE PARKING £3.5M" on top of the net-effect
  // figure. The board is meant to show through; the HUD is not.

  it('stands the whole stage down while a takeover owns the screen', () => {
    setState({ phase: 'waiting', hasRolled: false }, {}, 15_000_000, { freeParkingPool: 5_000_000 });
    const { container } = render(<><TurnHud /><TakeoverHost open><i /></TakeoverHost></>);
    const stage = hudStage(container);
    // opacity 0 AND visibility: R3 permits a full 0/1 show-hide (only a
    // FRACTIONAL opacity smears a glyph's text-shadow into a ghost duplicate),
    // and visibility guarantees the end state paints nothing at all.
    expect(stage.style.opacity).toBe('0');
    expect(stage.style.visibility).toBe('hidden');
  });

  it('is fully lit again the moment the takeover closes', () => {
    setState({ phase: 'waiting', hasRolled: false }, {}, 15_000_000, { freeParkingPool: 5_000_000 });
    const { container, rerender } = render(
      <><TurnHud /><TakeoverHost open><i /></TakeoverHost></>,
    );
    rerender(<><TurnHud /><TakeoverHost open={false}><i /></TakeoverHost></>);
    expect(hudStage(container).style.opacity).toBe('1');
    expect(hudStage(container).style.visibility).toBe('visible');
  });

  it('does not unmount — a layout teardown under a takeover is worse than the overlap', () => {
    setState({ phase: 'waiting', hasRolled: false }, {}, 15_000_000, { freeParkingPool: 5_000_000 });
    const { container } = render(<><TurnHud /><TakeoverHost open><i /></TakeoverHost></>);
    // Every readout is still in the tree, at its measured position.
    expect(container.querySelector('.kit-turnstrip')).toBeTruthy();
    expect(moneyTexts(container)).toContain('£5.000M');
  });

  it('leaves nothing for a screen reader to read out of a covered HUD', () => {
    setState({ phase: 'waiting', hasRolled: false });
    const { container } = render(<><TurnHud /><TakeoverHost open><i /></TakeoverHost></>);
    expect(hudStage(container).getAttribute('aria-hidden')).toBe('true');
    // jsdom does not apply CSS visibility to the a11y tree, so the attribute is
    // what keeps getByRole out of a HUD the sighted user cannot see either.
    expect(screen.queryByRole('button', { name: /roll dice/i })).toBeNull();
  });

  // ── GAP 3 (rules) · the GO advance had no HUD presence at all ──────────────

  it('mounts the GO advance tracker for a player carrying one', () => {
    setState({ phase: 'waiting', hasRolled: false }, { goDeductionsUsed: 3, goSkipsRemaining: 2 });
    const { container } = render(<TurnHud />);
    const pill = requireDefined(container.querySelector('.rn-golock'));
    expect(pill.textContent).toMatch(/go advance/i);
    expect(pill.textContent).toMatch(/2 skips left/i);
  });

  it('costs an untouched player nothing — no advance, no pill', () => {
    setState({ phase: 'waiting', hasRolled: false }, { goDeductionsUsed: 0, goSkipsRemaining: 0 });
    const { container } = render(<TurnHud />);
    expect(container.querySelector('.rn-golock')).toBeNull();
  });

  it('still reports a spent-out advance, when the skips are gone but the cap is not', () => {
    // used 5 / 0 left is the state a player is likeliest to have forgotten, and
    // it is the one that decides whether another advance is even available.
    setState({ phase: 'waiting', hasRolled: false }, { goDeductionsUsed: 5, goSkipsRemaining: 0 });
    const { container } = render(<TurnHud />);
    expect(requireDefined(container.querySelector('.rn-golock')).textContent).toMatch(/5 of 5 used/i);
  });
});
