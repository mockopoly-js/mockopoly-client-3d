/**
 * Behavioural contract of the primitives. These are the guarantees the four
 * screen-building agents are relying on, so they are asserted rather than
 * documented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { formatMoney } from '../../utils/format';
import { Arm } from './Arm';
import { Button } from './Button';
import { CodeInput } from './Field';
import { Deed } from './Deed';
import { Hold } from './Hold';
import { Money } from './Money';
import { Panel } from './Panel';
import { Segs } from './Controls';
import { SetPips } from './SetPips';
import { Toast } from './Toast';
import { splitMoney } from './splitMoney';
import { sa } from './tokens';

/** querySelector that throws instead of returning null, so tests read cleanly. */
function q(root: ParentNode, sel: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`no element matches ${sel}`);
  return el;
}

describe('Button', () => {
  it('renders an overhanging badge OUTSIDE the clip layer (rule R1)', () => {
    // The whole point of .kit-fx-clip: a badge inside it is silently sliced,
    // and no test of the rendered pixels would catch it.
    const { container } = render(
      <Button variant="icon" glyph="x" sub="TRADE" badge={3} sheen ariaLabel="Trade" />,
    );
    const clip = q(container, '.kit-fx-clip');
    const badge = q(container, '.kit-badge--count');
    expect(clip.contains(badge)).toBe(false);
    expect(badge.parentElement).toBe(q(container, '.kit-btn'));
  });

  it('renders no clip layer when there is nothing to clip', () => {
    const { container } = render(<Button label="Buy" />);
    expect(container.querySelector('.kit-fx-clip')).toBeNull();
  });

  it('puts the clock fill inside the clip and the clock ring outside it', () => {
    const { container } = render(<Button variant="primary" label="Roll" clock="warn" clockCount={18} />);
    const clip = q(container, '.kit-fx-clip');
    const btn = q(container, '.kit-btn');
    expect(clip.querySelector('.kit-turn__fill')).not.toBeNull();
    expect(clip.querySelector('.kit-turn__ring')).toBeNull();
    expect(btn.querySelector(':scope > .kit-turn__ring')).not.toBeNull();
    expect(btn.getAttribute('data-clock')).toBe('warn');
  });

  it('a waiting primary stays interactive-sized but inert', () => {
    const onClick = vi.fn();
    render(<Button variant="primary" label="Waiting · Priya" waiting onClick={onClick} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('kit-btn--primary'); // still 48px, no layout jump
    expect(btn.className).toContain('is-waiting');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<Button label="Buy" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  // ── square: icon-only WITHOUT giving up the variant ───────────────────────

  it('a square primary keeps its variant and renders no label node at all', () => {
    // Not `variant="icon"`: that is the 44px utility chip with its own look.
    // A square primary is still the 48px turn-lit CTA, just without text.
    const { container } = render(
      <Button variant="primary" square dice ariaLabel="Roll dice" onClick={vi.fn()} />,
    );
    const btn = q(container, '.kit-btn');
    expect(btn.className).toContain('kit-btn--primary');
    expect(btn.className).toContain('kit-btn--square');
    expect(btn.className).not.toContain('kit-btn--icon');
    expect(container.querySelector('.kit-btn__label')).toBeNull();
    expect(container.querySelector('.kit-dice')).not.toBeNull();
  });

  it('DROPPING THE VISIBLE TEXT MUST NOT DROP THE ACCESSIBLE NAME', () => {
    // The whole risk of an icon-only control. A button whose name is "" cannot
    // be reached by a screen reader, by voice control, or by getByRole.
    render(
      <>
        <Button variant="primary" square dice ariaLabel="Roll dice" />
        <Button variant="primary" square glyph="x" ariaLabel="End turn" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Roll dice' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'End turn' })).not.toBeNull();
  });

  it('a square still fires, and still refuses to when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="primary" square glyph="x" ariaLabel="End turn" onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button variant="primary" square glyph="x" ariaLabel="End turn" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Arm (two-stage confirm)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('needs two taps and keeps both labels mounted so the box never resizes', () => {
    const onConfirm = vi.fn();
    const { container } = render(<Arm face="Mortgage" confirm="Tap again · +£1.8M" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button');

    expect(container.querySelector('.kit-arm__face')).not.toBeNull();
    expect(container.querySelector('.kit-arm__confirm')).not.toBeNull();

    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(btn.className).toContain('is-armed');

    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(btn.className).not.toContain('is-armed');
  });

  it('disarms itself after the timeout', () => {
    const onConfirm = vi.fn();
    render(<Arm face="Mortgage" confirm="Tap again" onConfirm={onConfirm} timeoutMs={4000} />);
    fireEvent.click(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(4001); });
    expect(screen.getByRole('button').className).not.toContain('is-armed');
  });

  it('B1 — disabling it while armed clears the armed state', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<Arm face="Sell" confirm="Tap again" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').className).toContain('is-armed');

    rerender(<Arm face="Sell" confirm="Tap again" onConfirm={onConfirm} disabled />);
    const btn: HTMLButtonElement = screen.getByRole('button');
    expect(btn.disabled).toBe(true);
    expect(btn.className).not.toContain('is-armed');
  });
});

describe('Hold (hold-to-confirm)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires only after the full duration, and releasing early cancels', () => {
    const onComplete = vi.fn();
    render(<Hold label="Hold to declare bankruptcy" onComplete={onComplete} durationMs={1200} />);
    const btn = screen.getByRole('button');

    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(900); });
    fireEvent.pointerUp(btn);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(1200); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('R1 — the scaleX fill is inside the clip, the ring is not', () => {
    const { container } = render(<Hold label="Hold" onComplete={vi.fn()} />);
    const clip = q(container, '.kit-fx-clip');
    expect(clip.querySelector('.kit-hold__fill')).not.toBeNull();
    expect(clip.querySelector('.kit-hold__ring')).toBeNull();
    expect(container.querySelector('.kit-hold__ring')).not.toBeNull();
  });
});

describe('Money', () => {
  it('splits into mark / value / unit and agrees with formatMoney()', () => {
    for (const amount of [0, 500, 1_000, 1_500, 15_000_000, 4_200_000, -2_400_000]) {
      const p = splitMoney(amount);
      expect(`${p.sign}${p.cur}${p.val}${p.unit}`).toBe(formatMoney(amount));
    }
  });

  it('renders three nodes and reserves the digit slot', () => {
    const { container } = render(<Money value={4_200_000} size="hero" tone="gold" digits={4} />);
    const root = q(container, '.kit-money');
    expect(q(root, '.kit-money__cur').textContent).toBe('£');
    expect(q(root, '.kit-money__val').textContent).toBe('4.200');
    expect(q(root, '.kit-money__unit').textContent).toBe('M');
    expect(root.getAttribute('style')).toContain('--digits: 4');
    expect(root.className).toContain('kit-money--hero');
    expect(root.className).toContain('kit-money--gold');
  });
});

describe('Panel', () => {
  it('B5 — a footer-less panel takes the bottom safe-inset clearance itself', () => {
    const { container, rerender } = render(<Panel open title="Mayfair">body</Panel>);
    expect(q(container, '.kit-panel__body').className).toContain('kit-panel__body--nofoot');

    rerender(<Panel open title="Mayfair" footer={<Button label="Mortgage" />}>body</Panel>);
    expect(q(container, '.kit-panel__body').className).not.toContain('kit-panel__body--nofoot');
    expect(container.querySelector('.kit-panel__foot')).not.toBeNull();
  });

  it('R5 — a toast inside a panel drops its backdrop-filter', () => {
    const { container } = render(<Panel open title="X"><Toast open>hi</Toast></Panel>);
    expect(q(container, '.kit-toast').className).toContain('kit-toast--flat');
  });

  it('a toast outside a panel keeps its blur', () => {
    const { container } = render(<Toast open>hi</Toast>);
    expect(q(container, '.kit-toast').className).not.toContain('kit-toast--flat');
  });

  it('slides only when open', () => {
    const { container, rerender } = render(<Panel open={false} title="X">b</Panel>);
    expect(q(container, '.kit-panel').className).not.toContain('is-on');
    rerender(<Panel open title="X">b</Panel>);
    expect(q(container, '.kit-panel').className).toContain('is-on');
  });
});

describe('Deed', () => {
  it('B3/B4 — a locked row is marked, and every label is a truncating node', () => {
    const { container } = render(
      <Deed
        color="#2f5fd0"
        title="Mayfair"
        rows={[
          { label: 'Rent', value: <Money value={2_000_000} size="glance" />, current: true },
          { label: 'With a very long colour set label', value: <Money value={4_000_000} size="glance" />, locked: true },
        ]}
      />,
    );
    const rows = container.querySelectorAll('.kit-deed__row');
    expect(rows[0].className).toContain('is-current');
    expect(rows[1].className).toContain('is-locked');
    expect(container.querySelectorAll('.kit-deed__label')).toHaveLength(2);
  });
});

describe('SetPips', () => {
  it('shows the count when partial and the word when complete', () => {
    const { container, rerender } = render(<SetPips color="#8fd3ef" owned={2} total={3} />);
    expect(q(container, '.kit-set__count').textContent).toBe('2/3');
    expect(container.querySelectorAll('.kit-pip.is-on')).toHaveLength(2);

    rerender(<SetPips color="#ef8a3c" owned={3} total={3} complete />);
    expect(container.querySelector('.kit-set__flag')).not.toBeNull();
    expect(q(container, '.kit-set').className).toContain('is-complete');
  });
});

describe('CodeInput', () => {
  it('is one real input behind N display cells, and upper-cases as you type', () => {
    const onChange = vi.fn();
    const { container } = render(<CodeInput value="k7q" onChange={onChange} cells={6} />);
    expect(container.querySelectorAll('.kit-code__cell')).toHaveLength(6);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'k7qx' } });
    expect(onChange).toHaveBeenCalledWith('K7QX');
  });
});

describe('Segs', () => {
  it('reports the chosen value and marks the active item', () => {
    const onChange = vi.fn();
    render(
      <Segs
        value={3}
        onChange={onChange}
        ariaLabel="Players"
        options={[{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]}
      />,
    );
    expect(screen.getByRole('radio', { name: '3' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });
});

describe('sa() — safe inset + padding', () => {
  it('emits max(), never a sum', () => {
    expect(sa('r', 14)).toBe('max(var(--sa-r), 14px)');
    expect(sa('l')).toBe('var(--sa-l)');
    expect(sa('b', 8)).not.toContain('+');
  });
});
