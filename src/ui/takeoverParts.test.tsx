import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { noop, requireDefined } from '../test-utils';
import { ConfirmCard } from './takeoverParts';

/**
 * UA MARGINS ARE THIS SYSTEM'S RECURRING INVISIBLE DEFECT.
 *
 * `index.css` now resets `box-sizing` globally, but there is still no MARGIN
 * reset, so any element with a browser default margin — <p>, <h2> — silently
 * spends space nothing in the DOM accounts for. `.kit-takeover__title` had
 * exactly this and
 * it cost 40px per column, which hid a control below the fold and was only ever
 * found in a screenshot; kit.rules.test.ts now asserts the `margin: 0` that
 * fixed it. This is the same defect in the confirm card's note, where it is
 * merely cosmetic (~11px of dead space above the button row) and therefore even
 * less likely to be noticed. Asserted, not commented.
 */
describe('ConfirmCard', () => {
  const props = {
    open: true,
    onDismiss: noop,
    cap: 'Bankruptcy',
    headline: 'Settle up',
    rows: <div>rows</div>,
    note: 'Nothing is recoverable after this.',
    confirmLabel: 'Settle up',
    onConfirm: noop,
  };

  it('zeroes the note paragraph bottom margin the UA would otherwise supply', () => {
    const { container } = render(<ConfirmCard {...props} />);
    const note = requireDefined(container.querySelector('p'));
    expect(note.style.marginBottom).toBe('0px');
    // The 6px above it is deliberate and stays.
    expect(note.style.marginTop).toBe('6px');
  });

  it('renders nothing at all when closed', () => {
    const { container } = render(<ConfirmCard {...props} open={false} />);
    expect(container.querySelector('p')).toBeNull();
  });
});
