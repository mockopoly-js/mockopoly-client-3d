/**
 * GO ADVANCE — borrow against future GO salaries.
 *
 * GAP 3 IN THE BRIEF: this rule had NO user interface at all. The only trace
 * of it in the client was three unlabelled "Take 1 / 2 / 3" buttons buried in
 * the rent-deal panel, and nothing anywhere told you a loan was running. An
 * active GO advance silently eats £2M of income every time you pass GO, for up
 * to five laps, and a player who forgets it walks into bankruptcy holding what
 * they think is a healthy balance.
 *
 * So this ships two things:
 *
 *   <GoAdvancePanel>  the borrow flow — what you give up (left), what it does
 *                     to your cash (middle), how many passes to sell (right).
 *   <GoLoanPill>      the tracker. Deliberately REDUNDANT: it rides in the
 *                     head of EVERY negotiation takeover, so no surface where
 *                     money moves can be read without it in frame.
 *
 * SERVER CONTRACT (GameEngine.canGoDeduction / GameRoom.goDeduction):
 *   - LOAN_GO_DEDUCTION { count } -> money += count * £2M, goDeductionsUsed +=
 *     count, goSkipsRemaining += count. Nothing is ever repaid from cash.
 *   - lifetime cap 5: goDeductionsUsed + count must be <= 5
 *   - only available in debt: money < 0 or turn.mustPayRent
 *
 * WHY A STEPPER AND NOT <Segs> FOR 1..5 (gotcha 6): five 44px segments plus
 * the group's 12px gaps measure 274px against 232px of column, and squeezing
 * the gap to make it fit is the Catan +1/-1 mis-tap trap in a new costume. The
 * wide stepper puts − and + 144px apart, and the pip row below carries the
 * 1..5 range and the lifetime cap the segments would have shown.
 */
import { useEffect, useState } from 'react';
import { Button, Hold, Money, cx } from './kit';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, PropertyState } from '../types/GameState';
import { Hdr, KV, Line, Row, RuleContext, RuleTakeover, StepReadout, WarnCard } from './rules/RuleSurface';
import { Stepper } from './kit';

/** £2M per GO pass. Mirrors RULES.GO_SALARY on the server. */
export const GO_SALARY = 2_000_000;
/** Lifetime cap on GO deductions, per player. Mirrors GameEngine. */
export const GO_LIFETIME_CAP = 5;

// ────────────────────────────────────────────────────────────────────────────
// THE TRACKER
// ────────────────────────────────────────────────────────────────────────────

/**
 * The persistent GO-advance pill.
 *
 * Uses `.kit-pips` — the system's MANDATED flat count fallback — rather than
 * inventing a second counting idiom: hatched pips are passes already consumed,
 * lit amber pips are salaries still to be forgone, empty pips are advances
 * still available under the lifetime cap.
 *
 * Renders nothing when the player has never taken one AND has none running,
 * so it costs an untouched player no head space at all.
 */
export function GoLoanPill({ player, full = false }: { player: Player | undefined; full?: boolean }) {
  if (!player) return null;
  const used = player.goDeductionsUsed;
  const left = player.goSkipsRemaining;
  if (used === 0 && left === 0) return null;

  const spent = Math.max(0, used - left);
  const owed = left * GO_SALARY;

  return (
    <div className="rn-golock" role="status">
      <span className="rn-golock-cap">GO ADVANCE</span>
      <span className="kit-pips" aria-hidden="true">
        {Array.from({ length: GO_LIFETIME_CAP }, (_, i) => (
          <i key={i} className={cx('kit-pip', i < spent ? 'rn-pip-spent' : i < used ? 'rn-pip-due' : '')} />
        ))}
      </span>
      <span className="rn-golock-val">
        {left > 0 ? `${String(left)} SKIP${left === 1 ? '' : 'S'} LEFT` : `${String(used)} OF ${String(GO_LIFETIME_CAP)} USED`}
      </span>
      {full && left > 0 && (
        <>
          <i className="rn-golock-sep" aria-hidden="true" />
          <span className="rn-golock-val is-warn">−<Money value={owed} size="label" digits={3} /></span>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// THE BORROW FLOW
// ────────────────────────────────────────────────────────────────────────────

export interface GoAdvancePanelProps {
  open: boolean;
  onClose: () => void;
  me: Player | undefined;
  properties: PropertyState[];
  /** Rent that triggered this, if any — states the reason in the eyebrow. */
  owed?: number;
}

export function GoAdvancePanel({ open, onClose, me, properties, owed = 0 }: GoAdvancePanelProps) {
  const used = me?.goDeductionsUsed ?? 0;
  const cash = me?.money ?? 0;
  const maxN = Math.max(1, GO_LIFETIME_CAP - used);
  const [count, setCount] = useState(1);

  // Re-clamp whenever the cap moves under us (another advance completed, or a
  // reconnect delivered a different lifetime count). Without this the stepper
  // could sit on a value the server will reject.
  useEffect(() => { setCount((n) => Math.max(1, Math.min(maxN, n))); }, [maxN]);

  const n = Math.max(1, Math.min(maxN, count));
  const raise = n * GO_SALARY;
  const exhausted = used >= GO_LIFETIME_CAP;
  const myHex = me ? TOKEN_HEX[me.token] : TOKEN_HEX.blue;

  const take = () => {
    socketManager.emit(EVENTS.LOAN_GO_DEDUCTION, { count: n });
    onClose();
  };

  const lapRows = Array.from({ length: n }, (_, k) => (
    <Row
      key={k}
      label={`Next pass ${String(k + 1)} · GO`}
      value={<span className="kit-badge kit-badge--warn">NO SALARY</span>}
    />
  ));

  return (
    <RuleTakeover
      open={open}
      turnHex={myHex}
      eyebrow={
        exhausted
          ? `GO ADVANCE · ${String(used)} OF ${String(GO_LIFETIME_CAP)} USED · CAP REACHED`
          : `GO ADVANCE · ${String(used)} OF ${String(GO_LIFETIME_CAP)} USED · LIFETIME CAP IS ${String(GO_LIFETIME_CAP)}`
      }
      title="Borrow against GO"
      tracker={<GoLoanPill player={me} />}
      onClose={onClose}
      leftClass="rn-tight"
      rightClass="rn-tight"
      left={
        <>
          <Hdr label="What you give up" note={`Next ${String(n)} pass${n === 1 ? '' : 'es'}`} />
          {lapRows}
          <Line />
          <Row
            label="Salary forgone"
            current
            value={<Money value={raise} size="glance" tone="loss" digits={3} />}
          />
          <WarnCard
            tone="warn"
            head="Not a loan you repay"
            body="Nothing is ever deducted from your cash. You simply pass GO without collecting £2M, once for every pass you sold."
          />
        </>
      }
      mid={
        <>
          <Hdr label="Net effect" note="Today" />
          <KV label="Cash now"><Money value={raise} size="hero-lg" tone="gain" digits={3} legible /></KV>
          <KV label="Cash after"><Money value={cash + raise} size="glance-lg" digits={3} legible /></KV>
          {/* ONE CARD, NOT TWO. The column is 233px and a 26px hero, a 17px
              secondary and two full callouts measured 60px over — the second
              was sliced mid-sentence. When a rent is actually pending that is
              the live question, so it REPLACES the general note rather than
              stacking under it. */}
          {owed > 0 ? (
            <WarnCard
              tone={cash + raise >= owed ? 'good' : 'bad'}
              head={cash + raise >= owed ? 'This clears the rent' : 'Still short of the rent'}
              body={
                cash + raise >= owed
                  ? 'No interest, and nothing is repaid from cash — the server collects the rent the moment the advance lands.'
                  : 'No interest, but this is not enough on its own. Sell or mortgage as well, or offer the creditor a rent deal.'
              }
            />
          ) : (
            <WarnCard
              tone="good"
              head="No interest"
              body="Nothing is repaid from cash. The whole cost is future salary, which is why it is easy to forget."
            />
          )}
        </>
      }
      right={
        <>
          <Hdr label="How many GO passes" note="£2M each" />
          <Stepper
            className="rn-step"
            value={n}
            min={1}
            max={maxN}
            step={1}
            onChange={setCount}
            ariaLabel="GO passes to sell"
          >
            <StepReadout label="Passes sold">{n}</StepReadout>
          </Stepper>
          <KV label="You receive now"><Money value={raise} size="glance-lg" tone="gain" digits={3} /></KV>
          <Row
            label="Lifetime"
            value={
              <span className="kit-pips" aria-hidden="true">
                {Array.from({ length: GO_LIFETIME_CAP }, (_, i) => (
                  <i key={i} className={cx('kit-pip', i < used ? 'rn-pip-spent' : i < used + n ? 'rn-pip-due' : '')} />
                ))}
              </span>
            }
          />
          <Row
            label="Used after this"
            current
            value={<span className="kit-t-glance kit-t-gold kit-t-num">{used + n} OF {GO_LIFETIME_CAP}</span>}
          />
        </>
      }
      context={
        <RuleContext
          properties={properties}
          myId={me?.id ?? ''}
          hits={[0]}
          boardLabel="Board: GO is highlighted"
          who="Your move"
          phase="Takes effect immediately"
          color={myHex}
        />
      }
      actions={
        <>
          <Button variant="ghost" label="Cancel" onClick={onClose} />
          {/* <Hold>, not <Arm>: the advance fires instantly and the lifetime
              cap is never refunded, so it is one of the few genuinely
              irreversible actions on this surface. Gold tone — irreversible
              but positive. */}
          <Hold
            tone="gold"
            disabled={exhausted}
            label={exhausted ? 'GO advance cap reached' : <>Hold to take <Money value={raise} size="glance-lg" digits={3} /></>}
            ariaLabel={`Hold to take ${String(raise / 1_000_000)} million against ${String(n)} GO passes`}
            onComplete={take}
          />
        </>
      }
    />
  );
}
