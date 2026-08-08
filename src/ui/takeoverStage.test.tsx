import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { requireDefined } from '../test-utils';
import { TakeoverHost } from './takeoverParts';
import { useAnyTakeoverOpen, useTakeoverStack, useTakeoverStage } from './takeoverStage';

/**
 * THE OPEN-TAKEOVER REGISTRY.
 *
 * Everything here is asserted through <TakeoverHost>, one of the two real stage
 * hosts, rather than against the store directly: the contract that matters is
 * "a stage that renders with open=true is registered", and a test that pokes the
 * store would still pass if the host stopped calling the hook at all.
 *
 * jsdom does not load CSS, so `visibility` is asserted on the inline style the
 * hook returns — which is where it is set, and the only place it could be.
 *
 * `visibility` NOW HAS THREE MEANINGS ON THIS ELEMENT, and the tests below have
 * to keep them apart: a stage is `hidden` when CLOSED (it must not hand the
 * compositor a full-viewport layer it never paints), `hidden` when BURIED (a
 * later takeover owns the screen), and `visible` only when it is open and on
 * top. It used to be unset in the last two cases, because `hidden` was only
 * ever written for burial; an explicit `visible` is now load-bearing, since
 * the resting state it has to override is `hidden`.
 */
function hosts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-host]')];
}

function Host({ open, id }: { open: boolean; id: string }) {
  return (
    <TakeoverHost open={open}>
      <div data-host={id}>{id}</div>
    </TakeoverHost>
  );
}
/** The host element itself — the node the hook styles — not the marker inside. */
function stageOf(id: string): HTMLElement {
  return requireDefined(
    requireDefined(document.querySelector<HTMLElement>(`[data-host="${id}"]`)).parentElement,
  );
}

/** A probe for the HUD's side of the signal. */
function Watcher() {
  return <span data-testid="watch">{useAnyTakeoverOpen() ? 'open' : 'clear'}</span>;
}
const watched = () => screen.getByTestId('watch').textContent;

describe('takeover registry', () => {
  beforeEach(() => { useTakeoverStack.setState({ stack: [] }); });

  it('a closed stage registers nothing', () => {
    render(<><Watcher /><Host open={false} id="a" /></>);
    expect(watched()).toBe('clear');
    expect(useTakeoverStack.getState().stack).toHaveLength(0);
  });

  it('an open stage raises the signal the HUD stands down on', () => {
    render(<><Watcher /><Host open id="a" /></>);
    expect(watched()).toBe('open');
    expect(useTakeoverStack.getState().stack).toHaveLength(1);
  });

  it('closing lowers the signal again — and does not need an unmount', () => {
    const { rerender } = render(<><Watcher /><Host open id="a" /></>);
    expect(watched()).toBe('open');
    rerender(<><Watcher /><Host open={false} id="a" /></>);
    expect(watched()).toBe('clear');
    // GOTCHA 5: the stage is still mounted, so the takeover can play its exit.
    expect(hosts()).toHaveLength(1);
  });

  it('unmounting an open stage deregisters it', () => {
    const { rerender } = render(<><Watcher /><Host open id="a" /></>);
    rerender(<Watcher />);
    expect(watched()).toBe('clear');
  });

  // ── two at once: recency, not DOM order ────────────────────────────────────

  it('the LATER takeover wins, and the earlier one goes dark but stays open', () => {
    // The bug: two `z-index: 140` stages in the tree and the DOM-later one's
    // confirm plate wins by accident. Here the SECOND TO OPEN wins on purpose.
    // Both open in the same commit here, so effect order is the tie-break —
    // which is deterministic, and the next test proves it is not what decides
    // the normal case.
    render(<><Host open id="first" /><Host open id="second" /></>);
    expect(stageOf('first').style.visibility).toBe('hidden');
    expect(stageOf('second').style.visibility).toBe('visible');
    // Buried, not closed: nothing is unmounted and no composed state is lost.
    expect(document.querySelector('[data-host="first"]')).toBeTruthy();
  });

  it('DOM order does not decide it — the EARLIER stage in the tree wins if it opened later', () => {
    // Identical tree to the test above, opposite open ORDER: `second` is later
    // in the DOM and was already up when `first` opened. Recency hands the
    // screen to `first`, which is the exact inversion of the reported bug
    // ("the later one's confirm plate wins" by DOM position).
    const { rerender } = render(<><Host open={false} id="first" /><Host open id="second" /></>);
    expect(stageOf('second').style.visibility).toBe('visible');
    rerender(<><Host open id="first" /><Host open id="second" /></>);
    expect(stageOf('first').style.visibility).toBe('visible');
    expect(stageOf('second').style.visibility).toBe('hidden');
  });

  it('the buried stage comes back the moment the one above it closes', () => {
    const { rerender } = render(<><Host open id="first" /><Host open={false} id="second" /></>);
    expect(stageOf('first').style.visibility).toBe('visible');
    rerender(<><Host open id="first" /><Host open id="second" /></>);
    expect(stageOf('first').style.visibility).toBe('hidden');
    rerender(<><Host open id="first" /><Host open={false} id="second" /></>);
    expect(stageOf('first').style.visibility).toBe('visible');
  });

  // ── a CLOSED stage must not composite ──────────────────────────────────────

  it('a closed stage is parked at visibility:hidden so it cannot composite', () => {
    // Censused at 844x390: six always-mounted stages were handing the
    // compositor 12 full-viewport DRAWING layers and 171 MB of backing store at
    // dpr 3 while every one of them was CLOSED. They stay mounted (GOTCHA 5),
    // so the only lever left is refusing to paint.
    render(<Host open={false} id="a" />);
    expect(stageOf('a').style.visibility).toBe('hidden');
  });

  it('the hide is DELAYED by the fade on close, and undelayed on open', () => {
    // This is the whole reason it is `visibility` and not `content-visibility`
    // or an unmount: the exit has to finish PAINTING before the stage stops
    // painting at all. Undelayed on the way in, or the entrance never appears.
    const { rerender } = render(<Host open id="a" />);
    expect(stageOf('a').style.transition).toBe('visibility 0s var(--ease-linear) 0s');
    rerender(<Host open={false} id="a" />);
    expect(stageOf('a').style.transition).toBe('visibility 0s var(--ease-linear) var(--dur-takeover)');
  });

  it('burial is undelayed — a buried stage goes dark at once, not after a fade', () => {
    // A buried stage is not exiting; the surface above it just took the screen,
    // and the older one printing through it for 450ms is the original bug.
    render(<><Host open id="first" /><Host open id="second" /></>);
    expect(stageOf('first').style.transition).toBe('visibility 0s var(--ease-linear) 0s');
  });

  it('ranks the z-order by recency as well, so a descendant cannot undo it', () => {
    // `.kit-arm` re-declares `visibility: visible` two levels down inside a
    // takeover. If that ever applies to a whole buried surface, the stack order
    // still has to be decided by recency and never by mount order.
    render(<><Host open id="first" /><Host open id="second" /></>);
    expect(Number(stageOf('second').style.zIndex))
      .toBeGreaterThan(Number(stageOf('first').style.zIndex));
  });

  it('hides the buried stage from assistive tech, which <Takeover> alone cannot', () => {
    // .kit-takeover sets aria-hidden from its OWN `open`, which is still true
    // on a buried surface — only the host knows it is buried.
    render(<><Host open id="first" /><Host open id="second" /></>);
    expect(stageOf('first').getAttribute('aria-hidden')).toBe('true');
    expect(stageOf('second').getAttribute('aria-hidden')).toBeNull();
  });

  it('the signal stays raised while any takeover is open', () => {
    const { rerender } = render(<><Watcher /><Host open id="first" /><Host open id="second" /></>);
    expect(watched()).toBe('open');
    rerender(<><Watcher /><Host open id="first" /><Host open={false} id="second" /></>);
    expect(watched()).toBe('open');
    rerender(<><Watcher /><Host open={false} id="first" /><Host open={false} id="second" /></>);
    expect(watched()).toBe('clear');
  });

  it('re-registering the same stage is idempotent — it cannot re-rank itself', () => {
    function Twice() {
      // Two hooks, one component: distinct ids, so the stack must hold two.
      const a = useTakeoverStage(true);
      const b = useTakeoverStage(true);
      return <span data-testid="ranks">{`${String(a.buried)}|${String(b.buried)}`}</span>;
    }
    const { rerender } = render(<Twice />);
    expect(screen.getByTestId('ranks').textContent).toBe('true|false');
    rerender(<Twice />);
    expect(useTakeoverStack.getState().stack).toHaveLength(2);
    expect(screen.getByTestId('ranks').textContent).toBe('true|false');
  });
});
