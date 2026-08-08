import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import {
  BADGE_RESERVE, CAPS, DeedRowView, KIT, NUM, TAP_MIN, TYPE,
  sa, withVars, type KitStyle,
} from './kit';
import { useTakeoverStage } from './takeoverStage';

/**
 * SHARED PARTS for the two money takeovers (auction, bankruptcy liquidation).
 *
 * Everything here is either (a) a composition of kit primitives, or (b) a
 * primitive the kit does not ship and both surfaces need. NO new colour, type
 * or spacing VALUE is invented — every number resolves to a token.
 *
 * Components only. The pure rules live in `takeoverMath.ts` so they can be
 * asserted without a DOM, and so this file stays fast-refresh clean.
 *
 * ── DELIBERATELY NOT MERGED WITH `src/ui/rules/RuleSurface.tsx` ────────────
 *
 * The two files were written in parallel by two agents who could not see each
 * other and they look like duplicates. They were compared part by part; the
 * verdict is that ONE part was a genuine duplicate and has been extracted, and
 * the rest are different components that happen to rhyme. Do not re-litigate
 * this without re-reading both — a wrong merge silently changes six finished
 * panels.
 *
 *   EXTRACTED. The stage host. `TakeoverHost` and `.rn-layer` had byte-identical
 *   computed geometry (fixed / inset 0 / --z-takeover / pointer-events none) and
 *   identical purpose. The shared BEHAVIOUR — registering as an open takeover,
 *   and standing down when a later one buries it — now lives in
 *   `src/ui/takeoverStage.ts` and both call it. The geometry stayed where it
 *   was (inline here, CSS there) because moving it would rewrite rules.css for
 *   no behavioural gain.
 *
 *   NOT MERGED, and why:
 *   · <Cons> vs <WarnCard> — same job, different vocabularies. Cons has FOUR
 *     tones including `calm`, which the negotiation surfaces have no use for;
 *     WarnCard has three and carries role="note". Unifying means renaming a
 *     tone in one of them, i.e. editing panels, for zero pixels changed.
 *   · <AssetChip> vs <AssetChip> — same name, incompatible data models, and
 *     this is the one that looks most mergeable and is least so. The
 *     negotiation chip is keyed by `spaceIndex` and derives its name and price
 *     from BOARD_SPACES, because a trade moves whole deeds. The liquidation
 *     chip takes an explicit name/tag/value/blocked, because liquidation sells
 *     things that have no space index of their own — four houses off one lot,
 *     a hotel, a mortgage — and has to be able to say WHY a chip is locked.
 *     A merged chip would need every field of both and a discriminant.
 *   · <ChipGrid> vs <AssetGrid>, <EstRow> vs <Row>, <ColCap> vs <Hdr> — the
 *     pairs differ in row height (20px tabular estate line vs the 26px
 *     --deed-row negotiation row), in whether the caption has a second
 *     right-aligned slot, and in inline-style vs CSS-class delivery. Each is
 *     ~10 lines. Merging trades three small honest components for one
 *     parameterised one, in a system where the row heights are load-bearing
 *     measurements.
 *   · <ConfirmCard> vs <ConfirmPlate> — different confirmation contracts.
 *     ConfirmCard unmounts when closed and takes `rows` as an opaque node;
 *     ConfirmPlate stays mounted so it can animate and takes structured
 *     `{label, value}` rows. Same idea, genuinely different lifecycles.
 *   · <MoreCue> / <ScrollBox> have no counterpart at all — RuleSurface cues
 *     overflow with a 6px mask fade, this counts the hidden rows from live
 *     geometry. Both are right for their column heights.
 *
 *   ONE STALE JUSTIFICATION, LEFT IN PLACE ON PURPOSE. <TakeoverHead>'s first
 *   reason (the h2 UA margin) is FIXED: kit.css:903 ships
 *   `.kit-takeover__title { margin: 0 }` and kit.rules.test.ts asserts it —
 *   verified, and that reason is now marked as history where it is written. Its
 *   second reason — a live value pinned right of the head at zero height cost —
 *   still stands on its own, so the component stays. Removing the workaround is
 *   a head-geometry change to two finished panels and wants its own screenshot
 *   pass.
 */

// ────────────────────────────────────────────────────────────────────────────
// HOST
// ────────────────────────────────────────────────────────────────────────────

/**
 * The positioned ancestor a <Takeover> needs.
 *
 * `.kit-takeover` is `position:absolute; inset:0`, and App mounts these panels
 * as bare siblings of the 3D canvas with no positioned parent, so an absolute
 * takeover would resolve against the initial containing block and drift with
 * document scroll. A `fixed` host pins it to the viewport instead.
 *
 * `pointer-events:none` on the host so the board stays tappable while the
 * takeover is closed; `.kit-takeover.is-on` puts them back on itself, which is
 * the same mechanism <SafeBox> uses.
 *
 * `open` IS REQUIRED, and it is not decoration. It is this host's registration
 * with the takeover registry (`src/ui/takeoverStage.ts`), which is what makes
 * the HUD stand down instead of printing through the surface, and what ranks
 * two simultaneous takeovers by recency rather than by DOM order. A stage that
 * defaulted `open` to false would opt out of both, silently — exactly the kind
 * of position-dependent bug the registry exists to end. Pass the same value the
 * <Takeover> inside gets.
 */
export function TakeoverHost({ open, children }: { open: boolean; children?: ReactNode }) {
  const stage = useTakeoverStage(open);
  return (
    <div
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', ...stage.style }}
      // <Takeover> sets aria-hidden from its own `open`, which is still true on
      // a buried surface — the host has to say it for the whole stage.
      aria-hidden={stage.buried ? true : undefined}
    >
      {children}
    </div>
  );
}

/**
 * The three-slot takeover body.
 *
 * `.kit-takeover__body` is a two-column comparison at `--sp-6` (24px). All the
 * bodies here are THREE-part — read-only context | read-only live state |
 * interactive — which is five children and four gutters, and 24px would spend
 * 96px of a 750px content box on air.
 *
 * The body is handed ONE child (this row), so its own gap never applies and no
 * kit CSS has to be touched. At gap 12 with a 220px middle, the two side
 * columns are 240px each and every interactive sits clear of the middle third
 * of a landscape phone (frame x 297..547), where neither thumb reaches —
 * measured: the columns land at 47..287, 312..532 and 557..797.
 */
export function TriBody({ children }: { children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minWidth: 0 }}>{children}</div>
  );
}

/**
 * Fixed BORDER-BOX width of the display-only middle column: 204px of content
 * inside `.kit-takeover__col`'s 2x8px padding-inline.
 *
 * This is the JS twin of `.kit-takeover__col.rn-mid` in rules.css and the two
 * must agree — they lay out the same three-slot body. Both were written as 204
 * and rendered 220, because a content-box flex-basis sizes the CONTENT box.
 * index.css now sets border-box globally, so the basis IS the border box and
 * 220 is the number to declare. At a literal 204 the middle column shrinks
 * 16px and the auction's bidder names lose two to three characters to the
 * ellipsis ("KONSTA…" became "KONS…").
 */
export const MID_COL_W = 220;

// ────────────────────────────────────────────────────────────────────────────
// HEAD
// ────────────────────────────────────────────────────────────────────────────

/**
 * The whole takeover head — eyebrow, title, and a live value pinned right —
 * rendered into the <Takeover> `eyebrow` slot with NO `title` passed.
 *
 * TWO REASONS. THE FIRST IS HISTORY — READ IT AS THE RECORD OF A FIXED BUG,
 * NOT AS A LIVE ONE. ONLY THE SECOND STILL JUSTIFIES THIS COMPONENT.
 *
 * 1. `.kit-takeover__title` WAS AN <h2> WITH NO UA-MARGIN RESET. *** FIXED. ***
 *    Neither kit.css nor index.css zeroed heading margins, so the h2 carried
 *    the browser default `margin-block: .83em`, which at the 26px title size is
 *    21.6px above AND below. MEASURED at 844x390: the head came out 84.6px
 *    instead of 41.5, and the body 196.4 instead of 237.6 — 41px, which is the
 *    difference between the bid pad fitting and its MIN / ALL IN row being
 *    silently cut off below the fold. Nothing in the DOM was wrong; only a
 *    screenshot showed it, and it affected EVERY <Takeover> in the system.
 *    The real fix — one line in kit.css — HAS LANDED: kit.css:903 ships
 *    `.kit-takeover__title { margin: 0 }` and kit.rules.test.ts pins it
 *    ("headings and UA-margin elements declare margin: 0"). So this component
 *    is no longer a workaround for anything, and a <Takeover title> is safe to
 *    use directly. (`.rn-tk .kit-takeover__title` in rules.css repeats the
 *    `margin: 0` — that half is now redundant and harmless. The rest of that
 *    rule is NOT: its flex row is what seats the GO tracker beside the title,
 *    and negotiation.test.ts asserts the whole block.)
 *
 * 2. THE VALUE COSTS NO HEIGHT — AND THIS IS THE WHOLE JUSTIFICATION NOW.
 *    The high bid and the running shortfall are the
 *    single most glance-critical numbers on their screens and they are LIVE, so
 *    putting either inside a column means it can be scrolled out of view or
 *    pushed down by a growing list. `.kit-takeover__head` is a 2-column grid
 *    (title | close) and a third slot would need kit CSS — but it does not need
 *    one, because the caption rides the eyebrow's line and the value rides the
 *    title's, so the stacked block appears at the right of the head at exactly
 *    the head's own height.
 *
 * The eyebrow's own gold / 11px / caps / wide-tracking styling is inherited by
 * the first line deliberately; every other node overrides what it needs.
 */
export function TakeoverHead({ eyebrow, title, cap, value }: {
  eyebrow: ReactNode;
  title: ReactNode;
  cap?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'block', ...TRUNC }}>{eyebrow}</span>
        <span
          style={{
            ...TYPE.heroLg, display: 'block',
            textTransform: 'none', letterSpacing: '-0.2px', color: KIT.text,
            lineHeight: 1.08, ...TRUNC,
          }}
        >
          {title}
        </span>
      </span>
      {(cap !== undefined || value !== undefined) && (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: '0 0 auto', lineHeight: 1 }}>
          {cap}
          {value}
        </span>
      )}
    </span>
  );
}

const TRUNC = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/** The 11px caption above a head value. Tone carries the verdict, never opacity. */
export function HeadCap({ tone = 'muted', children }: { tone?: 'muted' | 'good' | 'bad'; children?: ReactNode }) {
  const color = tone === 'good' ? '#9ff0bb' : tone === 'bad' ? '#ffb3a8' : KIT.text2;
  return <span style={{ ...TYPE.micro, ...CAPS, color, whiteSpace: 'nowrap' }}>{children}</span>;
}

// ────────────────────────────────────────────────────────────────────────────
// CAPTION
// ────────────────────────────────────────────────────────────────────────────

/**
 * Column caption, aligned to the 5px inset every <SetPips> row uses.
 *
 * `min-height`, NOT `height`: a caption that outgrows one line must push the
 * stack down (where a clipped-container check can see it) rather than overflow
 * a fixed 16px row and be sliced in half.
 */
export function ColCap({ children, extra }: { children?: ReactNode; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 16, paddingLeft: 5, flex: '0 0 auto' }}>
      <span style={{ ...TYPE.micro, ...CAPS, letterSpacing: '1px', color: KIT.text2, whiteSpace: 'nowrap' }}>
        {children}
      </span>
      {extra}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CONSEQUENCE CALLOUT
// ────────────────────────────────────────────────────────────────────────────

export type ConsTone = 'danger' | 'warn' | 'good' | 'calm';

const CONS: Record<ConsTone, { rgb: string; bar: string; head: string; body: string }> = {
  danger: { rgb: '229,83,61',  bar: KIT.danger,  head: '#ffb3a8', body: '#e4cdc9' },
  warn:   { rgb: '232,163,61', bar: KIT.warn,    head: KIT.warnBright, body: '#e8dcc6' },
  good:   { rgb: '70,177,106', bar: KIT.success, head: '#9ff0bb', body: '#cae4d5' },
  calm:   { rgb: '212,175,55', bar: KIT.gold,    head: KIT.goldBright, body: KIT.text2 },
};

/**
 * The consequence callout — "this collapses your orange rent".
 *
 * <Badge> tops out at 16px/11px, which cannot carry a sentence with the weight
 * it deserves, and <Toast> is a transient in the HUD layer. 13px black head +
 * 11px body, a 2px inset accent bar, and `--row-pad` of inline padding so the
 * head clears the bar.
 *
 * RULE R1: inset shadows only. This lives inside a column that clips X, so it
 * has ZERO outward paint by construction.
 */
export function Cons({ tone = 'calm', head, children }: { tone?: ConsTone; head: ReactNode; children?: ReactNode }) {
  const c = CONS[tone];
  return (
    <div
      style={{
        flex: '0 0 auto',
        padding: `5px ${String(12)}px`,
        borderRadius: KIT.rSm,
        background: `linear-gradient(180deg, rgba(${c.rgb},.24), rgba(${c.rgb},.08))`,
        boxShadow: `inset 0 0 0 1px rgba(${c.rgb},.62), inset 2px 0 0 ${c.bar}`,
      }}
    >
      <div style={{ ...TYPE.label, fontWeight: 900, ...CAPS, lineHeight: 1.1, color: c.head }}>{head}</div>
      {children !== undefined && (
        <div style={{ ...TYPE.micro, marginTop: 2, lineHeight: 1.28, color: c.body }}>{children}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ESTATE ROW
// ────────────────────────────────────────────────────────────────────────────

/**
 * A read-only estate line.
 *
 * <DeedRowView> is 24px with a bottom hairline and is right for a rent ladder.
 * An itemised estate needs twelve lines in one column, so this is 20px, ruleless
 * and tabular. Display only — 20px is below `--tap-min` and it is never tappable.
 */
export function EstRow({ color, label, value }: { color?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div
      // Named so <MoreCue> can count these rows by geometry without depending
      // on the tag name of whatever wraps them.
      data-estrow=""
      style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 20, flex: '0 0 auto',
        paddingInline: 12, ...TYPE.microLg, color: KIT.text2,
      }}
    >
      {color !== undefined && (
        <i aria-hidden="true" style={{ width: 3, height: 11, borderRadius: 2, flex: '0 0 auto', background: color }} />
      )}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ marginLeft: 'auto', ...NUM, color: KIT.text, flex: '0 0 auto' }}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LOT DEED
// ────────────────────────────────────────────────────────────────────────────

/**
 * The lot, as a deed body sized for a takeover column.
 *
 * NOT <Deed>, and that is a measurement, not a preference. `.kit-deed__band`
 * carries `box-shadow: 0 0 18px 3px` — 21px of outward paint on a full-column
 * -width element. `.kit-takeover__col` is `overflow-y:auto`, which makes the X
 * axis clip too, so that glow is sliced on BOTH sides at every inline padding
 * short of 21px, and 21px would cost 42 of the column's 248. The glow is pure
 * decoration; the band keeps its top-edge light catch and loses the halo.
 * (Reported: this wants a `.kit-deed--incol` variant in kit.css.)
 *
 * NO deed title either — it would repeat the takeover title verbatim, 24px
 * under a 26px copy of the same word, and cost 30px the set impact needs.
 */
export function LotDeed({ color, sub, rows }: {
  color: string;
  sub: ReactNode;
  rows: { label: ReactNode; value: ReactNode; current?: boolean }[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 auto' }}>
      <i
        aria-hidden="true"
        style={{
          height: 16, borderRadius: KIT.rXs, flex: '0 0 auto', background: color,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30)',
        }}
      />
      <div style={{ ...TYPE.label, fontWeight: 600, ...CAPS, color: KIT.gold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sub}
      </div>
      <div style={{ marginTop: 4 }}>
        {rows.map((r, i) => (
          <DeedRowView key={i} row={{ label: r.label, value: r.value, current: r.current }} />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SELECTABLE ASSET CHIP
// ────────────────────────────────────────────────────────────────────────────

/**
 * The liquidation selector chip. No kit primitive covers multi-select:
 * `.kit-segs__item` is single-choice and carries no colour band or value,
 * <Pod> is inert, and <Button> has no selected state.
 *
 * TWO ACROSS, NOT THREE. Three chips in a 228px column leave 56px of label.
 * Two measure 108px, ~92px of label after the padding — and 92px is not enough
 * for one line of a real name, so the name is a FIXED TWO-LINE BOX at 11px:
 * 26px name + 13px value inside a 44px chip. Every value therefore sits on one
 * baseline across the whole grid, and no name needs an abbreviation.
 *
 * Disabled uses COLOUR, never opacity (rule R3), and the reason replaces the
 * value so a locked chip still says why.
 */
export function AssetChip({
  color, name, tag, value, ariaLabel, selected, blocked, hurt = false, onToggle,
}: {
  color: string;
  name: string;
  /** 2–5 characters, on the value line: "HOTEL", "H3". Empty for the rest. */
  tag: string;
  value: string;
  /** The plain sentence a screen reader (and a test) hears. */
  ariaLabel: string;
  selected: boolean;
  blocked: string | null;
  hurt?: boolean;
  onToggle: () => void;
}) {
  const disabled = blocked !== null;
  const fill = disabled
    ? 'linear-gradient(180deg, rgba(18,18,30,.72), rgba(9,10,18,.72))'
    : selected && hurt
      ? 'linear-gradient(180deg, rgba(232,163,61,.28), rgba(9,10,18,.86))'
      : selected
        ? 'linear-gradient(180deg, rgba(70,177,106,.26), rgba(9,10,18,.84))'
        : 'linear-gradient(180deg, rgba(28,30,48,.62), rgba(9,10,18,.72))';
  const ring = disabled
    ? 'inset 0 0 0 1px rgba(232,232,240,.06)'
    : selected
      ? `${KIT.liftTop}, inset 0 0 0 2px ${hurt ? KIT.warn : KIT.success}, ${KIT.shadow1}`
      : `${KIT.ringHair}, ${KIT.shadow1}`;
  const valueColor = disabled
    ? KIT.text3
    : selected
      ? (hurt ? KIT.warnBright : KIT.successBright)
      : KIT.text2;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onToggle}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        height: TAP_MIN, padding: '0 4px 0 10px', border: 0, borderRadius: KIT.rMd,
        textAlign: 'left', background: fill, boxShadow: ring, cursor: disabled ? 'default' : 'pointer',
        touchAction: 'manipulation', fontFamily: KIT.font,
      }}
    >
      <i
        aria-hidden="true"
        style={{ position: 'absolute', left: 4, top: 8, bottom: 8, width: 3, borderRadius: 2, background: disabled ? KIT.text3 : color }}
      />
      {/* A FIXED two-line box, not a min-height. The value line owns 13px of
          the 44px chip, so a name that took a third line would push the value
          out of the chip entirely — which is how a grid of prices ends up with
          no prices on it. Every board name fits two lines at this width. */}
      <span
        style={{
          ...TYPE.micro, fontWeight: 700, height: 26, overflow: 'hidden', lineHeight: 1.16,
          color: disabled ? KIT.text3 : selected ? KIT.text : KIT.text2,
        }}
      >
        {name}
      </span>
      <span style={{ ...TYPE.micro, fontWeight: 900, lineHeight: 1.18, ...NUM, whiteSpace: 'nowrap', color: valueColor }}>
        {blocked ?? (tag === '' ? value : `${tag} ${value}`)}
      </span>
    </button>
  );
}

/** Two-across chip grid. `scrolls` opts in to the fade cue + <MoreCue> below. */
export function ChipGrid({ children, style }: { children?: ReactNode; style?: KitStyle }) {
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12,
        alignContent: 'flex-start',
        // 8px, not 6: a chip carries --shadow-1 (0 2px 6px), an 8px outward
        // extent, and the outer column of chips is otherwise sliced by 2px by
        // the scroll container's X clip. The matching negative margin keeps the
        // chips at their intended width.
        padding: '0 8px 2px', margin: '0 -8px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Sticky group header inside a scrolling chip grid. Opaque — chips pass under it. */
export function ChipGroup({ label, note }: { label: ReactNode; note?: ReactNode }) {
  return (
    <div
      style={{
        gridColumn: '1 / -1', position: 'sticky', top: 0, zIndex: 2,
        display: 'flex', alignItems: 'center', gap: 8, height: 20, paddingLeft: 5,
        background: '#0a0a12', boxShadow: '0 1px 0 rgba(232,232,240,.08)',
      }}
    >
      <span style={{ ...TYPE.micro, ...CAPS, color: KIT.gold }}>{label}</span>
      {note !== undefined && <span style={{ ...TYPE.micro, color: KIT.text2 }}>{note}</span>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// THE ANTI-SILENT-TRUNCATION CUE
// ────────────────────────────────────────────────────────────────────────────

/**
 * A `max-height` + `overflow-y:auto` with no cue truncates SILENTLY — it cut
 * three of eight entries invisibly in an earlier pass, and nothing in a DOM
 * audit reported it.
 *
 * A bottom mask fade is the system's usual answer, but a fade only says
 * "something is soft down there"; it does not say HOW MUCH, and a 500px list
 * inside a 190px viewport needs a number. This recomputes the count from REAL
 * GEOMETRY on every scroll and resize, and swaps to "END OF LIST" at the bottom.
 *
 * IN FLOW, NOT AN OVERLAY. Absolutely positioned over the list it covered the
 * bottom 20px of two 44px chips — hiding the very values it advertises. A
 * permanently reserved 20px row below the scroller can neither cover anything
 * nor cause a layout jump when the count changes.
 *
 * `getBoundingClientRect`, NOT `offsetTop`: offsetTop is measured from the
 * nearest POSITIONED ancestor, which here is the takeover, so a first version
 * was off by the grid's own offset and claimed "12 MORE BELOW" when 10 were
 * hidden. A count that is wrong is worse than a fade.
 */
export function MoreCue({
  scrollRef,
  itemSelector,
  total,
}: {
  scrollRef: React.RefObject<HTMLElement>;
  itemSelector: string;
  total: number;
}) {
  const [below, setBelow] = useState(0);

  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const edge = box.getBoundingClientRect().bottom;
    let n = 0;
    box.querySelectorAll(itemSelector).forEach((el) => {
      if (el.getBoundingClientRect().bottom > edge + 1) n += 1;
    });
    setBelow(n);
  }, [scrollRef, itemSelector]);

  useLayoutEffect(measure);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    box.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      box.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [scrollRef, measure]);

  const on = below > 0;
  return (
    <span
      role="status"
      style={{
        flex: '0 0 auto', alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 20, padding: '0 8px', borderRadius: KIT.rPill, whiteSpace: 'nowrap', pointerEvents: 'none',
        ...TYPE.micro, fontWeight: 900, ...CAPS, letterSpacing: '1px',
        color: on ? KIT.textOnGold : KIT.text2,
        background: on ? `linear-gradient(180deg, ${KIT.goldBright}, ${KIT.gold})` : 'none',
      }}
    >
      {on ? `${below} more below` : `End of list · ${total} total`}
      {on && (
        <i
          aria-hidden="true"
          style={{
            // 8x8 BORDER box = 6px of stroke span plus the two 2px borders
            // that draw the chevron. index.css sets border-box globally, so a
            // declared 6x6 would shrink the rotated glyph's bounding box from
            // 11.3px to 8.5px — this is the outer number.
            width: 8, height: 8, flex: '0 0 auto', marginTop: -3, transform: 'rotate(45deg)',
            borderRight: `2px solid ${KIT.textOnGold}`, borderBottom: `2px solid ${KIT.textOnGold}`,
          }}
        />
      )}
    </span>
  );
}

/** The scroll box a <MoreCue> reports on: fades its own last 14px as a second cue. */
export function ScrollBox({
  boxRef, children, style,
}: { boxRef: React.RefObject<HTMLDivElement>; children?: ReactNode; style?: KitStyle }) {
  const mask = 'linear-gradient(180deg, #000 0, #000 calc(100% - 14px), rgba(0,0,0,.10) 100%)';
  return (
    <div
      ref={boxRef}
      style={{
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
        WebkitMaskImage: mask, maskImage: mask,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EXPLICIT CONFIRM — and it is NOT a nested modal
// ────────────────────────────────────────────────────────────────────────────

/**
 * The system's policy is <Arm> / <Hold> everywhere EXCEPT accept-trade and
 * bankruptcy. A bankruptcy commit is an irreversible transfer of everything, so
 * it earns a real confirmation.
 *
 * *** NOT A NESTED MODAL. *** A flat scrim plus a card INSIDE the takeover: no
 * second backdrop-filter (rule R5), no new z-layer, and three ways out — BACK
 * (the larger of the two buttons), a scrim tap, and Escape. Nested modals with
 * no emergency exit are the documented trap this avoids.
 *
 * GEOMETRY, AND THE TRAP IN IT: this is `inset:0` inside the takeover, and an
 * absolutely positioned child resolves against its ancestor's PADDING box —
 * which on a border-less takeover is the whole frame, NOT the 750px content
 * box. So the safe inset has to be reapplied here, with `sa('r', 14)`, and the
 * card is held a further BADGE_RESERVE off the edge so its shadow tail stops on
 * the safe line.
 *
 * NO scale() ON THE ENTRANCE, and that is a measured defect rather than taste:
 * a scale on a CONTAINER scales its descendants' rendered geometry, so for the
 * length of the entrance both 44px buttons inside measured 42.2px — under
 * `--tap-min`, and a tap arriving mid-entrance lands on an undersized target.
 */
export function ConfirmCard({
  open, onDismiss, cap, headline, rows, note, confirmLabel, onConfirm,
}: {
  open: boolean;
  onDismiss: () => void;
  cap: ReactNode;
  headline: ReactNode;
  rows: ReactNode;
  note: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 6, display: 'flex',
        alignItems: 'center', justifyContent: 'flex-end',
        paddingRight: sa('r', 14),
        background: 'rgba(4,4,10,.84)',
      }}
      onClick={onDismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={typeof headline === 'string' ? headline : confirmLabel}
        onClick={(e) => { e.stopPropagation(); }}
        style={withVars({}, {
          // 320 is the OUTER width — index.css sets border-box globally. Before
          // that reset this carried its own `boxSizing`, because a content-box
          // 320 + 2x16 padding measured 352 and the card grew leftward into the
          // display-only middle band.
          width: 320,
          marginRight: BADGE_RESERVE, padding: 16, borderRadius: KIT.rLg,
          background: KIT.surfacePanel,
          // --shadow-3, not --shadow-4: the card's right edge sits on the safe
          // line and --shadow-4's 68px tail is clipped by the device frame.
          boxShadow: `inset 0 0 0 1px rgba(229,83,61,.5), ${KIT.shadow3}`,
        })}
      >
        <div style={{ ...TYPE.micro, ...CAPS, color: KIT.gold }}>{cap}</div>
        <div style={{ ...TYPE.hero, lineHeight: 1.14, margin: '2px 0 6px' }}>{headline}</div>
        {rows}
        {/* `margin: 6px 0 0`, not `marginTop: 6`. Nothing in this app resets UA
            margins, so a bare marginTop left the <p>'s `margin-bottom: 1em`
            standing — ~11px of dead space between the note and the button row,
            on a card whose whole job is to be read in one glance. This is the
            same defect `.kit-takeover__title` had (there it cost 40px per
            column and hid a control below the fold); here it is only cosmetic,
            which is exactly why it survived a DOM audit. */}
        <p style={{ ...TYPE.micro, fontWeight: 500, color: KIT.text2, margin: '6px 0 0', lineHeight: 1.35 }}>{note}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
          <ConfirmBtn variant="ghost" label="Back" onClick={onDismiss} />
          <ConfirmBtn variant="danger" label={confirmLabel} onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}

/**
 * The confirm card's own buttons. <Button> would be right, but the card is a
 * plain positioned div rather than a takeover footer, and the kit's 44px floor
 * plus the 12px gap are the only geometry that matters here — so these are
 * `.kit-btn` verbatim, consumed as classes, with no new styling at all.
 */
function ConfirmBtn({ variant, label, onClick }: { variant: 'ghost' | 'danger'; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`kit-btn kit-btn--${variant}`} onClick={onClick}>
      <span className="kit-btn__label">{label}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FOOTER CONTEXT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read-only context on the LEFT of the footer, one primary on the RIGHT — and
 * that is a design decision, not a workaround.
 *
 * The interactive strip is 250px. A 176px primary (`--btn-w-primary`) plus the
 * 12px dead space leaves 62px, and no second real label fits in 62px. So every
 * escape action on these screens (auction PASS, liquidation I-CAN'T-PAY, forced
 * BACK) lives at the top or bottom of a column instead, hundreds of pixels from
 * the primary. That is better than a cramped pair anyway: THE MEMORISED
 * BOTTOM-RIGHT TAP ALWAYS FIRES THE ACTION YOU CAME FOR AND CAN NEVER FIRE THE
 * IRREVERSIBLE ALTERNATIVE.
 *
 * Capped at 240px so it never reaches the middle of the frame.
 */
export function FootCtx({ children }: { children?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-end',
        gap: 2, marginRight: 'auto', minWidth: 0, maxWidth: 240,
      }}
    >
      {children}
    </div>
  );
}

/** The 11px legible caption inside a <FootCtx>. */
export function FootNote({ children }: { children?: ReactNode }) {
  return (
    <span
      style={{
        ...TYPE.micro, ...CAPS, color: KIT.text2, textShadow: KIT.textLegible,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
      }}
    >
      {children}
    </span>
  );
}
