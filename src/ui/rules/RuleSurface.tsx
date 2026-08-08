/**
 * CUSTOM-RULE NEGOTIATION — the shared surface.
 *
 * <RuleTakeover> is the three-slot body every negotiation screen uses:
 *
 *      LEFT read-only context  |  MIDDLE the verdict  |  RIGHT the controls
 *
 * which is the system's left-read-only / right-interactive rule with the thing
 * you are actually deciding in the middle, where neither thumb reaches and
 * nothing may be tappable. Trade, partnership, rent deal and GO advance all
 * render into it, so the four rule systems read as one family rather than four
 * dialogs that happen to be in the same app.
 *
 * Everything else in this file is a primitive the kit does not have. See
 * rules.css for the measurement that forced each one.
 *
 * SEE ALSO `src/ui/takeoverParts.tsx`, the auction/bankruptcy part library.
 * The two overlap on purpose and are NOT being merged — the reasoning, part by
 * part, is in the header of that file. Read it before extracting anything.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button, Money, SetPips, TakeoverCol, TakeoverRule, Takeover, TurnStrip,
  KIT, turnStyle, withVars, cx,
} from '../kit';
import { BOARD_SPACES } from '../../constants/board';
import type { ColorGroup, PropertyState } from '../../types/GameState';
import { useTakeoverStage } from '../takeoverStage';
import { groupHex, groupLabel, groupOf, shortSpaceName, type SetChange } from './negotiation';
import './rules.css';

// ────────────────────────────────────────────────────────────────────────────
// THE SURFACE
// ────────────────────────────────────────────────────────────────────────────

export interface RuleTakeoverProps {
  open: boolean;
  /** Small gold caps line. CHANNEL 1 of whose-move: "... LAST OFFER BY PRIYA". */
  eyebrow: ReactNode;
  /** CHANNEL 2 of whose-move: "PRIYA COUNTERED" / "AWAITING PARTNERS". */
  title: string;
  onClose: () => void;
  /** Persistent GO-advance tracker, rendered on the title row. */
  tracker?: ReactNode;
  left: ReactNode;
  /** DISPLAY ONLY — the middle third is `pointer-events:none` by convention
   *  here and by force in <ZoneMid>. Never put a control in it. */
  mid: ReactNode;
  right: ReactNode;
  /** Footer-left read-only block: board strip + <TurnStrip>. CHANNEL 3. */
  context: ReactNode;
  /** Footer-right action cluster. CHANNEL 4 lives here (`waiting` primary). */
  actions: ReactNode;
  /** The explicit confirm plate, for accept-trade and accept-deal only. */
  confirm?: ReactNode;
  /** Hex of the player whose move it is. Lights the whole surface (GOTCHA 8). */
  turnHex?: string;
  leftClass?: string;
  rightClass?: string;
}

export function RuleTakeover({
  open, eyebrow, title, onClose, tracker,
  left, mid, right, context, actions, confirm,
  turnHex, leftClass, rightClass,
}: RuleTakeoverProps) {
  // THE LAYER IS ALSO THE REGISTRATION. Every negotiation takeover reaches the
  // screen through this one component, so registering here is what lets the HUD
  // stand down (it prints through the masked window band otherwise) and what
  // ranks two open takeovers by recency instead of by DOM order. The returned
  // style carries both: the z-order, and `visibility:hidden` when a later
  // takeover has buried this one. See src/ui/takeoverStage.ts.
  const stage = useTakeoverStage(open);
  return (
    // GOTCHA 1: kit surfaces are position:absolute and need a positioned
    // full-size ancestor. App.tsx mounts these panels as bare fragment
    // siblings, so this layer is it. GOTCHA 5: always mounted, never
    // conditionally rendered — `open` drives it.
    <div
      className="rn-layer"
      // The stage style goes LAST: --turn is a custom property and the two
      // never collide, but the z-order must not be overridable by a caller.
      style={turnHex === undefined ? stage.style : { ...turnStyle(turnHex), ...stage.style }}
      // <Takeover> sets aria-hidden from its own `open`, which is still true on
      // a buried surface. Hiding the layer keeps a screen reader out of a
      // dialog the sighted user cannot see either.
      aria-hidden={stage.buried ? true : undefined}
    >
      <div className={cx('rn-window', open && 'is-on')} aria-hidden="true" />
      <Takeover
        open={open}
        className="rn-tk"
        label={title}
        eyebrow={eyebrow}
        title={
          <>
            <span className="rn-trunc">{title}</span>
            {tracker}
          </>
        }
        onClose={onClose}
        footer={
          <>
            <div className="rn-ctx">{context}</div>
            {actions}
          </>
        }
      >
        <TakeoverCol top className={leftClass}>{left}</TakeoverCol>
        <TakeoverRule />
        {/* rn-fade: two consequence callouts plus a 26px hero measure ~236px
            against 233px of column, so the verdict CAN overflow by a hair.
            The 6px bottom mask is the scroll cue — deep enough to notice,
            shallow enough not to erase the last line of a callout. */}
        <TakeoverCol top className="rn-mid rn-tight rn-fade">{mid}</TakeoverCol>
        <TakeoverRule />
        <TakeoverCol top className={rightClass}>{right}</TakeoverCol>
      </Takeover>
      {confirm}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// COLUMN FURNITURE
// ────────────────────────────────────────────────────────────────────────────

/** Column header: muted label left, gold (or green) statement right. */
export function Hdr({ label, note, ok = false }: { label: ReactNode; note?: ReactNode; ok?: boolean }) {
  return (
    <div className="rn-hdr">
      <span className="kit-t-micro kit-t-caps kit-t-dim">{label}</span>
      {note !== undefined && (
        <span
          className={cx('kit-t-micro', 'kit-t-caps', !ok && 'kit-t-gold')}
          style={ok ? { color: KIT.successBright } : undefined}
        >
          {note}
        </span>
      )}
    </div>
  );
}

/** Caption. `.kit-set-cap` minus the 5px inset that aligns it to <SetPips>. */
export function Cap({ children }: { children: ReactNode }) {
  return <div className="kit-set-cap rn-cap0">{children}</div>;
}

/** An 11px key over a big value. The verdict column's headline pattern. */
export function KV({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rn-kv">
      <span className="rn-kv-key">{label}</span>
      {children}
    </div>
  );
}

/**
 * A read-only row. `<DeedRowView>` with one addition: an optional colour-group
 * swatch, because GAP 1 — which set a property belongs to IS the decision, and
 * it has to survive into the review columns, not only the composer's chips.
 */
export function Row({
  label, group, value, current = false, muted = false,
}: {
  label: ReactNode;
  group?: ColorGroup | null;
  value: ReactNode;
  current?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cx('kit-deed__row', current && 'is-current', muted && 'is-locked')}>
      <span className="kit-deed__label" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        {group !== undefined && group !== null && (
          <i className="rn-swatch" style={withVars({ '--gc': groupHex(group) })} aria-hidden="true" />
        )}
        <span className="rn-trunc">{label}</span>
      </span>
      {value}
    </div>
  );
}

/** Placeholder for an empty read-only list. Never an empty column. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rn-empty">{children}</div>;
}

/** A horizontal hairline. */
export function Line() {
  return <i className="kit-rule" />;
}

// ────────────────────────────────────────────────────────────────────────────
// THE CONSEQUENCE CALLOUT — gap 4
// ────────────────────────────────────────────────────────────────────────────

export type WarnTone = 'bad' | 'warn' | 'good';

export function WarnCard({ tone = 'bad', head, body }: { tone?: WarnTone; head: ReactNode; body?: ReactNode }) {
  return (
    <div className={cx('rn-warn', tone === 'good' && 'is-good', tone === 'warn' && 'is-warn')} role="note">
      <div className="rn-warn-head">{head}</div>
      {body !== undefined && <div className="rn-warn-body">{body}</div>}
    </div>
  );
}

/** `<SetPips>` for one entry of a `setDiff`. */
export function SetChangeRow({ change }: { change: SetChange }) {
  const complete = change.after === change.total;
  return (
    <SetPips
      color={groupHex(change.group)}
      owned={change.after}
      total={change.total}
      complete={complete}
    />
  );
}

/**
 * The verdict column's stack of callouts, worst first.
 *
 * TWO MAXIMUM, AND ONLY THE FIRST KEEPS ITS BODY. The column is 233px and a
 * full callout with a three-line body is ~70px; two of them under a 26px hero
 * and a header measured 69px of overflow, which the 6px scroll fade cannot
 * honestly signal — the second card was sliced through the middle of a
 * sentence. The leading consequence is the one that needs explaining; the
 * second is a headline, which is all a 13px black caps line needs to be.
 */
export function Consequences(opts: {
  mine: { lost: SetChange[]; gained: SetChange[] };
  theirs?: { lost: SetChange[] };
  theirName?: string;
}) {
  const specs: { key: string; tone: WarnTone; head: string; body: string }[] = [];
  for (const c of opts.mine.lost) {
    specs.push({
      key: `lost-${c.group}`, tone: 'bad',
      head: `Your ${groupLabel(c.group)} monopoly lost`,
      body: `The set drops to ${String(c.after)}/${String(c.total)}. Doubled group rent stops the moment it leaves.`,
    });
  }
  for (const c of opts.mine.gained) {
    specs.push({
      key: `gain-${c.group}`, tone: 'good',
      head: `${groupLabel(c.group)} monopoly completed`,
      body: `${String(c.total)}/${String(c.total)} after this. Group rent doubles and you can build.`,
    });
  }
  for (const c of opts.theirs?.lost ?? []) {
    specs.push({
      key: `their-${c.group}`, tone: 'warn',
      head: `Breaks ${opts.theirName ?? 'their'} ${groupLabel(c.group)}`,
      body: `Their set drops to ${String(c.after)}/${String(c.total)} — that is your leverage, not just their loss.`,
    });
  }
  return (
    <>
      {specs.slice(0, 2).map((s, i) => (
        <WarnCard key={s.key} tone={s.tone} head={s.head} body={i === 0 ? s.body : undefined} />
      ))}
    </>
  );
}


// ────────────────────────────────────────────────────────────────────────────
// ASSET CHIP — multi-select
// ────────────────────────────────────────────────────────────────────────────

export function AssetGrid({ children, scroll = true, label }: { children: ReactNode; scroll?: boolean; label?: string }) {
  return <div className={cx('rn-grid', scroll && 'rn-grid-scroll')} role="group" aria-label={label}>{children}</div>;
}

export function AssetChip({
  spaceIndex, selected, breaks = false, disabled = false, onToggle, testId,
}: {
  spaceIndex: number;
  selected: boolean;
  /** Selecting this would break one of MY completed sets. The chip says so. */
  breaks?: boolean;
  disabled?: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  const space = BOARD_SPACES.find((s) => s.index === spaceIndex);
  const name = space?.name ?? `Space ${String(spaceIndex)}`;
  const price = space?.price ?? 0;
  return (
    <button
      type="button"
      data-testid={testId}
      className={cx('rn-chip', selected && 'is-on', breaks && 'is-break')}
      style={withVars({ '--gc': groupHex(groupOf(spaceIndex)) })}
      aria-pressed={selected}
      aria-label={`${name}, ${String(price / 1_000_000)} million`}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="rn-chip-name">{shortSpaceName(name).toUpperCase()}</span>
      <span className="rn-chip-val"><Money value={price} size="micro" digits={3} /></span>
    </button>
  );
}

/**
 * GAP 2: the server has carried `offeredJailCards` / `requestedJailCards`
 * since day one and the client hard-coded 0 and surfaced nothing. A Get Out of
 * Jail Free card is a tradeable asset, so it is a chip in the same grid as the
 * properties rather than a control somewhere else.
 * Tapping cycles 0 -> 1 -> ... -> held -> 0; nobody holds more than two.
 */
export function JailCardChip({
  held, count, onCycle, testId,
}: { held: number; count: number; onCycle: () => void; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      className={cx('rn-chip', count > 0 && 'is-on')}
      style={withVars({ '--gc': KIT.gold })}
      aria-pressed={count > 0}
      aria-label={`Get out of jail free card, ${String(held)} held, ${String(count)} in this offer`}
      disabled={held === 0}
      onClick={onCycle}
    >
      <span className="rn-chip-name">JAIL FREE CARD</span>
      <span className="rn-chip-val">{count > 0 ? `×${String(count)} OF ${String(held)}` : `×${String(held)} HELD`}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// WIDE STEPPER READOUT
// ────────────────────────────────────────────────────────────────────────────

/** The label / value pair that goes inside a `<Stepper className="rn-step">`. */
export function StepReadout({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <span className="rn-step-key">{label}</span>
      <span className="rn-step-num">{children}</span>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EQUITY
// ────────────────────────────────────────────────────────────────────────────

export function EqBar({ segments }: { segments: { pct: number; color: string; key: string }[] }) {
  return (
    <div
      className="rn-eqbar"
      role="img"
      aria-label={`Equity split ${segments.map((s) => `${String(s.pct)}%`).join(' / ')}`}
    >
      {segments.map((s) => (
        <i key={s.key} className="rn-eqseg" style={withVars({ '--pct': s.pct, '--pc': s.color })} />
      ))}
    </div>
  );
}

/** Player colour dot for a table row. Glow-free so it cannot be clipped. */
export function PDot({ color }: { color: string }) {
  return <i className="rn-dot" style={withVars({ '--pc': color })} aria-hidden="true" />;
}

/** name · % · money-in · money-out. Three numbers per partner. */
export function SplitRow({
  color, name, pct, inAmount, outAmount,
}: { color: string; name: string; pct: number; inAmount: string; outAmount: string }) {
  return (
    <div className="rn-split">
      <span className="rn-split-name">
        <PDot color={color} />
        <span className="rn-trunc">{name}</span>
      </span>
      <span className="rn-split-pct">{pct}%</span>
      <span className="rn-split-amt is-in">{inAmount}</span>
      <span className="rn-split-amt is-out">{outAmount}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BOARD STRIP — the functional half of "do not hide the board"
// ────────────────────────────────────────────────────────────────────────────

const BOARD_KIND: ('corner' | 'void' | ColorGroup)[] = BOARD_SPACES.map((s) =>
  s.type === 'go' || s.type === 'jail' || s.type === 'free-parking' || s.type === 'go-to-jail'
    ? 'corner'
    : (s.colorGroup ?? 'void'),
);

export function BoardStrip({
  properties, myId, hits, label,
}: { properties: PropertyState[]; myId: string; hits: readonly number[]; label: string }) {
  const hit = new Set(hits);
  const owner = new Map(properties.map((p) => [p.spaceIndex, p.ownerId]));
  const sides = [0, 1, 2, 3];
  return (
    <div className="rn-board" role="img" aria-label={label}>
      {sides.map((s) => (
        <div className="rn-board-side" key={s}>
          {Array.from({ length: 10 }, (_, k) => {
            const i = s * 10 + k;
            const kind = BOARD_KIND[i];
            const isCorner = kind === 'corner';
            const isVoid = kind === 'void';
            return (
              <i
                key={i}
                className={cx(
                  'rn-tile',
                  isCorner && 'is-corner',
                  isVoid && 'is-void',
                  !isCorner && !isVoid && owner.get(i) === myId && 'is-mine',
                  hit.has(i) && 'is-hit',
                )}
                style={isCorner || isVoid ? undefined : withVars({ '--gc': groupHex(kind) })}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The footer-left read-only block. CHANNEL 3 of whose-move: a flat sentence
 * naming the player who has to act and what they can do about it, lit in that
 * player's own colour. A colour is not a name, so it says both.
 */
export function RuleContext({
  properties, myId, hits, boardLabel, who, phase, color,
}: {
  properties: PropertyState[];
  myId: string;
  hits: readonly number[];
  boardLabel: string;
  who: string;
  phase: string;
  color: string;
}) {
  return (
    <>
      <BoardStrip properties={properties} myId={myId} hits={hits} label={boardLabel} />
      <TurnStrip who={who} phase={phase} color={color} />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// QUICK REPLIES — gap 6
// ────────────────────────────────────────────────────────────────────────────

/**
 * "Need more" without opening a counter. A one-way "guess what I want" flow is
 * the named failure in Catan Universe and Pokemon TCG Pocket, and the fix
 * players actually asked for was two cheap words, not a better composer.
 *
 * The reply is a game-log line, not a state change, so it is a single tap and
 * it acknowledges in place — the offer stays open either way. Rejection sits
 * beside it as an <Arm>, because that one does end the negotiation.
 */
export function QuickReply({ label, sent, onSend }: { label: string; sent: string; onSend: () => void }) {
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return (
    <Button
      variant="secondary"
      label={flash ? sent : label}
      disabled={flash}
      onClick={() => {
        setFlash(true);
        onSend();
        timer.current = setTimeout(() => { setFlash(false); }, 1800);
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EXPLICIT CONFIRM — accept-trade and accept-deal only
// ────────────────────────────────────────────────────────────────────────────

export interface ConfirmRow { label: string; value: ReactNode }

/**
 * Arm-then-fire is the confirmation everywhere in Mockopoly EXCEPT the two
 * irreversible asset transfers: accepting a trade and accepting a rent deal.
 * Those move property and cash the instant they fire and can never be undone,
 * so they earn a real confirmation that restates what moves.
 */
export function ConfirmPlate({
  open, sub, title, rows, note, noteBody, noteTone = 'bad', okLabel, onOk, onBack,
}: {
  open: boolean;
  sub: string;
  title: string;
  rows: ConfirmRow[];
  note?: string;
  noteBody?: string;
  noteTone?: WarnTone;
  okLabel: string;
  onOk: () => void;
  onBack: () => void;
}) {
  return (
    <div className={cx('rn-confirm', open && 'is-on')} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open}>
      <div className="rn-confirm-card">
        <div className="rn-confirm-sub">{sub}</div>
        <div className="rn-confirm-title">{title}</div>
        <div className="rn-confirm-rows">
          {rows.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
        </div>
        {note !== undefined && <div style={{ marginTop: 8 }}><WarnCard tone={noteTone} head={note} body={noteBody} /></div>}
        <div className="rn-confirm-row">
          <Button variant="icon" glyph="←" sub="BACK" ariaLabel="Back, do not accept" onClick={onBack} />
          {/* --btn-w-primary is 176; with the 44px BACK button and a 12px gap
              that is 232 inside the card's 288px of content. No override. */}
          <Button variant="gold" label={okLabel} onClick={onOk} />
        </div>
      </div>
    </div>
  );
}

