import { useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { BOARD_SPACES } from '../constants/board';
import type { Player } from '../types/GameState';
import type { S_PartnershipBuildCostSplit, S_PartnershipRentSplit } from '../types/SocketEvents';
import { Badge, KIT, Money, SafeBox } from './kit';
import type { BadgeTone, KitStyle } from './kit';
import { useHudStandDown } from './takeoverStage';

/**
 * THE BIG MOMENT — one display-only card in the band the HUD always leaves free:
 * below the toast stack (ends y 92), above the action cluster (starts y 209),
 * right of the read-only column (ends x 250).
 *
 * *** GAP 2 — PARTNERSHIP_RENT_SPLIT / PARTNERSHIP_BUILD_COST_SPLIT. ***
 * Both events reach the client bus (GameStateSync relays them) and nothing has
 * ever consumed them in any client: rent got split between partners and no one
 * was told who received what. This is that consumer. Not a toast — a split is
 * comparative, per-partner information that a one-line notice cannot carry, and
 * the amounts are exactly what the recipients need to see.
 *
 * *** GUARANTEED TEARDOWN, BY TWO INDEPENDENT MECHANISMS. ***
 * A per-moment `setTimeout`, AND a 200ms watchdog that clears by MEASURED AGE
 * (`Date.now()` against the moment's own birth stamp) and hard-clears at
 * life + 400ms. A throttled or dropped timer cannot leave a card on screen. A
 * new moment always replaces the live one, so two can never sit inert together.
 */

const SPACE_NAME = new Map(BOARD_SPACES.map((s) => [s.index, s.name]));

/** Routine events read fast and clear fast; a dramatic one earns a beat. */
const LIFE_ROUTINE = 2600;
const LIFE_SPLIT = 4200;
const LIFE_BIG = 3200;
/** Watchdog tick + the grace beyond `life` before the hard clear. */
const SWEEP_MS = 200;
const GRACE_MS = 400;

interface MomentRow { key: string; label: string; amount: number; gain: boolean }
interface Moment {
  id: number;
  bornAt: number;
  life: number;
  badge: string;
  tone: BadgeTone;
  title: string;
  /** Hero type. Reserved for the beats that change the table. */
  big: boolean;
  sub?: string;
  rows?: MomentRow[];
}

export function BigMomentOverlay() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  const [moment, setMoment] = useState<Moment | null>(null);
  /**
   * THE WORST BLEED OF THE LOT, AND IT IS A GEOMETRY ACCIDENT. This stage is
   * --z-hud-over (114) and its card is bottom-anchored in the centre band,
   * x 297..539, y 104..222. The takeover's `.rn-window` mask is centred: the
   * plateau runs 50% +/- 110px and the ramps to +/- 134, so at 844 the
   * deliberately transparent column is x 288..556 — which this card now sits
   * ENTIRELY inside, having moved into the centre band. Everything
   * else on the HUD leaks a few percent through the 95-98.5% fill; this one
   * lands in the ~35% window, right on top of the verdict figure the window
   * exists to reveal. It yields like every other HUD-layer surface.
   *
   * The card is transient (2.6-4.2s) and its own watchdog keeps running while
   * hidden, so a moment raised under a takeover expires unseen rather than
   * queueing — correct: it is a notice about a beat that has already passed,
   * and the log and pods carry the durable version of the same fact.
   */
  const standDown = useHudStandDown();

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'A player';
  const place = (i: number) => SPACE_NAME.get(i) ?? 'a property';
  const show = (m: Omit<Moment, 'id' | 'bornAt'>) => {
    setMoment((prev) => ({ ...m, id: (prev?.id ?? 0) + 1, bornAt: Date.now() }));
  };

  useGameBusEvent('rent-collected', (d: { fromId: string; toId: string; amount: number }) => {
    show({
      badge: 'Rent', tone: 'warn', big: false, life: LIFE_ROUTINE,
      title: `${name(d.fromId)} paid rent to ${name(d.toId)}`,
      rows: [{ key: d.toId, label: d.toId === myId ? 'You' : name(d.toId), amount: d.amount, gain: d.toId === myId }],
    });
  });

  useGameBusEvent('jail-sent', (d: { playerId: string }) => {
    show({ badge: 'Jail', tone: 'jail', big: false, life: LIFE_ROUTINE, title: `${name(d.playerId)} → Jail` });
  });

  useGameBusEvent('player-bankrupt', (d: { playerId: string }) => {
    const left = players.filter((p) => !p.isBankrupt && p.id !== d.playerId).length;
    show({
      badge: 'Bankrupt', tone: 'out', big: true, life: LIFE_BIG,
      title: `${name(d.playerId)} went bankrupt`,
      sub: left === 1 ? '1 player left' : `${left} players left`,
    });
  });

  useGameBusEvent('free-parking-collected', (d: { playerId: string; amount: number }) => {
    show({
      badge: 'Free parking', tone: 'good', big: true, life: LIFE_BIG,
      title: `${name(d.playerId)} scooped the pot`,
      rows: [{ key: d.playerId, label: d.playerId === myId ? 'You' : name(d.playerId), amount: d.amount, gain: true }],
    });
  });

  // ── GAP 2 ────────────────────────────────────────────────────────────────
  useGameBusEvent('partnership-rent-split', (d: S_PartnershipRentSplit) => {
    show({
      badge: 'Rent split', tone: 'good', big: false, life: LIFE_SPLIT,
      title: `${name(d.fromId)} paid rent on ${place(d.spaceIndex)}`,
      rows: d.splits.map((s) => ({
        key: s.playerId,
        label: s.playerId === myId ? 'You' : name(s.playerId),
        amount: s.amount,
        gain: true,
      })),
    });
  });

  useGameBusEvent('partnership-build-cost-split', (d: S_PartnershipBuildCostSplit) => {
    show({
      badge: 'Build split', tone: 'warn', big: false, life: LIFE_SPLIT,
      title: `Building on ${place(d.spaceIndex)}`,
      rows: d.splits.map((s) => ({
        key: s.playerId,
        label: s.playerId === myId ? 'You' : name(s.playerId),
        amount: s.amount,
        gain: false,
      })),
    });
  });

  // Two independent teardowns. The interval never reads the timeout's state.
  useEffect(() => {
    if (!moment) return;
    const id = moment.id;
    const clear = () => { setMoment((cur) => (cur?.id === id ? null : cur)); };
    const timer = setTimeout(clear, moment.life);
    const sweep = setInterval(() => {
      if (Date.now() - moment.bornAt > moment.life + GRACE_MS) clear();
    }, SWEEP_MS);
    return () => { clearTimeout(timer); clearInterval(sweep); };
  }, [moment]);

  if (!moment) return null;

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <SafeBox inert>
        <div style={slot}>
          <div key={moment.id} style={card} className="kit-in-top" role="status">
            <Badge tone={moment.tone}>{moment.badge}</Badge>
            <div style={moment.big ? titleBig : title}>{moment.title}</div>
            {moment.sub !== undefined && <div style={sub}>{moment.sub}</div>}
            {moment.rows !== undefined && moment.rows.length > 0 && (
              <div style={rowWrap}>
                {moment.rows.map((r) => (
                  <span key={r.key} style={rowItem}>
                    <span style={rowLabel}>{r.label}</span>
                    <Money
                      value={r.amount}
                      size="label"
                      tone={r.gain ? 'gain' : 'loss'}
                      digits={3}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </SafeBox>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

const stage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zHudOver, pointerEvents: 'none',
};
/**
 * THE CENTRE THIRD, BECAUSE THE TOAST STACK NOW OWNS THE RIGHT ONE.
 *
 * This used to be `right: 0` — the whole band from the read column to the safe
 * edge — which centred the card at x 547 and ran it to 717. That was clear of
 * the toast stack only while the stack started at y 6: two stacked toasts ended
 * at y 86 (100 with a wrapping second line) and this card starts at 100. The
 * chrome row has since taken the top-right corner and the stack moved down to
 * y 60, so it now ends at 154 and the two overlap by 54px in x 539..717.
 *
 * THAT IS NOT AN EDGE CASE, WHICH IS WHY THE BAND MOVED RATHER THAN THE Y.
 * GameStateSync raises a toast AND a bus event for the same beats — bankruptcy,
 * free parking, rent — so a big moment is co-present with a toast about the
 * SAME EVENT by construction, not by coincidence.
 *
 * MOVING IT DOWN INSTEAD WAS MEASURED AND DOES NOT FIT. Below the stack the
 * card would start at y 160 and end at 252, and the centre money readout — now
 * bottom-anchored — tops out at y 232 (224 at worst-case insets). There is
 * 72px of gap and the card is 92px tall. Narrowing the band is the only move
 * that costs nothing: `right: --zone-act-w` stops this column exactly where
 * the toast column begins, and it re-centres the card on x 422, which is the
 * same axis the pot, my cash and the GO pill already share. One vertical
 * spine, and the right column is left to the notices.
 *
 * `right` ADDS --badge-reserve, and that 8px is not cosmetic: <ZoneAct> and the
 * toast stack are both held back from the safe edge by it, so the toast column
 * actually begins 8px LEFT of `--zone-act-w`. Without the addition this band
 * ran 8px under the stack at every inset — measured 526 against 518 at the
 * 68px worst case.
 *
 * *** BOTTOM-ANCHORED NOW, NOT `top: 100`, AND THAT IS THE LOAD-BEARING PART. ***
 * A narrower band wraps the title, so the card's own height is no longer close
 * to constant: the bankrupt card measures 92px in the old wide band, 118px at
 * 47/47 insets and 144px at the 68px worst case. Pinned by its top, that
 * variation all lands on the thing BELOW — the permanent centre money readout —
 * and at the worst case it printed straight through the free-parking caption
 * with 1.7px to spare. Pinned by its bottom, the variation lands on the empty
 * board above instead, and the gap to the readout is 8px by construction at
 * every inset. Same reasoning, and the same idiom, as the two money slots in
 * TurnHud.
 *
 * 147 = the readout's own 139 (34 of reserved GO-pill band + a 105px two-value
 * block) + --sp-2. MEASURED, and it is a coupling: if the centre readout ever
 * gains a line, this is the number to re-measure.
 *
 * MEASURED at 844x390, bankrupt card, both money values live:
 *   0/0/0/0      card x 262..574  y 113..231   readout from 239
 *   0/47/21/47   card x 297..539  y 104..222   readout from 230
 *   20/68/29/68  card x 318..518  y  70..214   readout from 222
 * and the tallest card this component can build (a 3-row rent split at the
 * narrowest band, ~150px) still clears <ZoneTop>'s strip by 12px.
 */
const slot: KitStyle = {
  position: 'absolute',
  left: KIT.zoneReadW,
  right: `calc(${KIT.zoneActW} + ${KIT.badgeReserve})`,
  bottom: 147,
  display: 'flex', justifyContent: 'center',
};
const card: KitStyle = {
  /* The band is 250px at 47/47 insets and 208 at the 68px worst case, so this
     cap only binds on a wide desktop viewport. It stays as the upper bound. */
  maxWidth: 388,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: KIT.sp1,
  padding: `${KIT.sp3} ${KIT.sp4}`,
  borderRadius: KIT.rLg,
  background: 'radial-gradient(120% 140% at 50% 0%, rgb(18 18 30 / 94%), rgb(6 6 13 / 86%) 76%)',
  boxShadow: `${KIT.ringHair}, ${KIT.shadow4}`,
  textAlign: 'center',
};
const title: KitStyle = {
  font: `600 ${KIT.fsLabelLg}/1.22 ${KIT.font}`, color: KIT.text, marginTop: 2,
};
const titleBig: KitStyle = {
  font: `800 ${KIT.fsHeroLg}/1 ${KIT.font}`, letterSpacing: KIT.lsTight,
  color: KIT.text, marginTop: 2,
};
const sub: KitStyle = {
  font: `500 ${KIT.fsLabel}/1.22 ${KIT.font}`,
  textTransform: 'uppercase', letterSpacing: KIT.lsWider, color: KIT.text2,
};
const rowWrap: KitStyle = {
  display: 'flex', alignItems: 'center', gap: KIT.sp4, marginTop: 2, flexWrap: 'wrap',
  justifyContent: 'center',
};
const rowItem: KitStyle = { display: 'inline-flex', alignItems: 'center', gap: KIT.sp1 };
const rowLabel: KitStyle = {
  font: `600 ${KIT.fsMicro}/1.22 ${KIT.font}`,
  textTransform: 'uppercase', letterSpacing: KIT.lsWider, color: KIT.text2,
};
