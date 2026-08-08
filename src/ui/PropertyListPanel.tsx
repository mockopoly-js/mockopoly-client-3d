import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { BOARD_SPACES } from '../constants/board';
import { COLOR_GROUP_HEX, TOKEN_HEX } from '../constants/theme';
import type { ColorGroup, Partnership, Player, PropertyState } from '../types/GameState';
import {
  Badge, Dot, KIT, Panel, SafeBox, SetCap, SetPips, ZoneRead, cx, groupColor, withVars,
} from './kit';
import type { KitStyle } from './kit';
import { HUD_TOGGLE_DEEDS } from './TurnHud';
import { useHudStandDown } from './takeoverStage';

/**
 * MY HOLDINGS — two surfaces, one derivation.
 *
 *  1. the always-visible SET STRIP in the read-only left column: swatch, pips,
 *     count. The 3D board can light WHICH tiles are mine; it cannot say "2 of
 *     3", so this flat index is mandated, not optional.
 *  2. the DEEDS PANEL, a right slide-in opened from the cluster's DEEDS button,
 *     listing every property by set.
 *
 * *** GAP 1 — PARTNERSHIP PROPERTIES WERE INDISTINGUISHABLE. ***
 * The old filter deliberately pulled in properties held through a partnership
 * and then rendered every row identically, so a partner's property sat under
 * "Your properties" with their name nowhere on the screen. Worse, the filter
 * matched on the COLOUR GROUP alone: any property in a partnered group counted,
 * even one owned by a player who is not in the partnership at all.
 *
 * The fix reuses the identity language this system already has — every pod,
 * plate and token is tinted with a specific player's `--pc`, so a partner's
 * stake is marked with THEIR OWN token colour rather than a new hue:
 *   · set strip — the partner's pip carries their colour (it is OWNED, so it
 *     must not render as the unowned grey and misreport the set as incomplete),
 *     the row is washed + ringed in their colour, and my equity % rides the end
 *     of the row. That is the one fact the 26px row has space for.
 *   · deeds panel — the group header repeats those pips and adds the full
 *     "YOU 60% · ● PRIYA 40%" breakdown; the partner's own rows are washed in
 *     their colour, led by a dot, and their name is in the meta line.
 */

// ── board-derived indices, built once ───────────────────────────────────────
const GROUP_SPACES = ((): Map<ColorGroup, number[]> => {
  const m = new Map<ColorGroup, number[]>();
  for (const s of BOARD_SPACES) {
    if (s.colorGroup === undefined) continue;
    const list = m.get(s.colorGroup) ?? [];
    list.push(s.index);
    m.set(s.colorGroup, list);
  }
  return m;
})();
const SPACE_NAME = new Map(BOARD_SPACES.map((s) => [s.index, s.name]));
const GROUP_ORDER = [...GROUP_SPACES.keys()];

/**
 * The strip shows at most THREE groups.
 *
 * MEASURED in the browser at 844x390, not estimated: the safe box is 369 tall,
 * a <Pod> renders 49px (not the 40px min-height — a 13px name over a 15px money
 * value plus padding), three opponents plus their 4px gaps end at y 195, and the
 * log peek owns the bottom 44px from y 325. That leaves 130px, minus the 12px
 * dead space each side, for the cap (17px) and the rows (26px each): three fit
 * with 15px to spare, four overflow into the pod band by 11px. The overflow
 * count rides the caption instead of costing a fourth row, and the full list is
 * one tap away in the panel.
 */
const STRIP_ROWS = 3;

type PipKind = 'mine' | 'partner' | 'off';
interface Pip { kind: PipKind; hex: string; mortgaged: boolean }
interface Holding {
  spaceIndex: number;
  name: string;
  meta: string;
  mortgaged: boolean;
  partnerName: string | null;
  partnerHex: string | null;
}
interface GroupView {
  group: ColorGroup;
  color: string;
  total: number;
  mine: number;
  complete: boolean;
  pips: Pip[];
  /** First other partner, used for the row tint. */
  tintHex: string | null;
  /** My percentage in this group's partnership. */
  equity: number | null;
  /** Every partner including me, for the panel's breakdown line. */
  shares: { name: string; hex: string | null; pct: number }[];
  holdings: Holding[];
}

export function PropertyListPanel() {
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const partnerships: Partnership[] = useGameStore((s) => s.state?.partnerships) ?? [];
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const myId = useGameStore((s) => s.myPlayerId);
  const selectProperty = useGameStore((s) => s.selectProperty);
  const isOut = useGameStore((s) => s.state?.players.find((p) => p.id === s.myPlayerId)?.isBankrupt ?? false);
  const [open, setOpen] = useState(false);
  // BOTH stages yield, and they have to be told separately — they are two
  // sibling `position:fixed` elements, so neither inherits anything from the
  // other. The strip leaks like the pods do; the deeds panel is a 392px opaque
  // slab that can be left open when a takeover arrives (nothing closes it) and
  // would otherwise print through the takeover's right column.
  const standDown = useHudStandDown();

  useGameBusEvent(HUD_TOGGLE_DEEDS, () => { setOpen((o) => !o); });

  if (myId === null) return null;

  const groups = buildGroups(properties, partnerships, players, myId);
  const owned = groups.reduce((n, g) => n + g.mine, 0);
  const shared = groups.filter((g) => g.equity !== null).length;

  const strip = [...groups].sort(stripPriority).slice(0, STRIP_ROWS);
  const hidden = groups.length - strip.length;

  return (
    <>
      <div style={{ ...readStage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
        <SafeBox>
          <ZoneRead>
            {(groups.length > 0 || isOut) && (
              <div style={stripSlot}>
                <SetCap>{hidden > 0 ? `My sets · +${hidden} in deeds` : 'My sets'}</SetCap>
                {groups.length === 0
                  ? <div style={emptyRow}><Badge tone="out">All transferred</Badge></div>
                  : strip.map((g) => <StripRow key={g.group} g={g} />)}
              </div>
            )}
          </ZoneRead>
        </SafeBox>
      </div>

      {/*
        A SECOND STAGE, and it has to be second.
        Both stages are `position:fixed`, so each is its own stacking context and
        the kit's `--z-panel` (134) inside a `--z-hud-under` (108) stage can never
        beat TurnHud's `--z-hud` (110) stage: the action cluster and the centre
        readout drew straight through an open panel. z-index only orders siblings
        WITHIN a context, so the stage itself has to carry the panel layer.

        The panel also stays mounted when closed, so the slide-out animates.
      */}
      <div style={{ ...panelStage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <Panel
        open={open}
        width="wide"
        title="My properties"
        sub={`${owned} owned · ${shared} shared · ${groups.length} sets`}
        onClose={() => { setOpen(false); }}
      >
        {groups.length === 0 ? (
          <div style={panelEmpty}>You do not hold any property yet.</div>
        ) : (
          groups.map((g) => (
            <div key={g.group} style={panelGroup}>
              <div className="kit-set" style={withVars({ '--gc': g.color }, groupHead)}>
                <i className="kit-set__swatch" aria-hidden="true" />
                <Pips pips={g.pips} />
                {g.complete
                  ? <span className="kit-set__flag">Monopoly</span>
                  : <span className="kit-set__count">{g.mine}/{g.total}</span>}
                {g.equity !== null && <ShareTag shares={g.shares} />}
              </div>
              {g.holdings.map((h) => (
                <button
                  key={h.spaceIndex}
                  type="button"
                  style={
                    h.partnerHex === null
                      ? holdingRow
                      : withVars({ '--pc': h.partnerHex }, { ...holdingRow, ...holdingPartner })
                  }
                  onClick={() => { selectProperty(h.spaceIndex); setOpen(false); }}
                >
                  <span className="kit-trunc" style={holdingName}>
                    {h.partnerHex !== null && <Dot style={{ '--pc': h.partnerHex, ...dotPc }} />}
                    {h.name}
                  </span>
                  <span style={holdingMeta}>
                    {h.partnerName === null ? h.meta : `${h.meta} · ${h.partnerName}'s`}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </Panel>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ROWS
// ────────────────────────────────────────────────────────────────────────────

/**
 * A plain group falls through to the kit's own <SetPips>. A partnered one is
 * hand-composed from the SAME `kit-set` / `kit-pip` classes, because the kit
 * has no partner pip and no equity slot — the mockup declared both page-local
 * for exactly this reason. Nothing here invents a colour: the tint, the ring
 * and the pip all read the partner's own `--pc`.
 */
function StripRow({ g }: { g: GroupView }) {
  if (g.tintHex === null) {
    return (
      <SetPips
        color={g.color}
        owned={g.mine}
        total={g.total}
        complete={g.complete}
        mortgaged={g.pips.flatMap((p, i) => (p.mortgaged && p.kind === 'mine' ? [i] : []))}
      />
    );
  }
  const tint = g.tintHex;
  return (
    <div
      className="kit-set"
      style={withVars({ '--gc': g.color, '--pc': tint }, {
        borderRadius: KIT.rPill,
        padding: '0 8px 0 5px',
        background: `linear-gradient(90deg, color-mix(in srgb, ${tint} 18%, transparent), transparent 88%)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 50%, transparent)`,
      })}
    >
      <i className="kit-set__swatch" aria-hidden="true" />
      <Pips pips={g.pips} />
      <span className="kit-set__count">{g.mine}/{g.total}</span>
      {g.equity !== null && (
        <span style={{ ...equity, color: tint }}>{`${g.equity}%`}</span>
      )}
    </div>
  );
}

function Pips({ pips }: { pips: Pip[] }) {
  return (
    <span className="kit-pips" aria-hidden="true">
      {pips.map((p, i) => (
        <i
          key={i}
          className={cx('kit-pip', p.kind !== 'off' && 'is-on', p.mortgaged && 'is-mortgaged')}
          style={
            p.kind === 'partner'
              ? {
                  background: p.hex,
                  boxShadow: `0 0 9px 1px ${p.hex}, inset 0 1px 0 rgb(255 255 255 / 40%)`,
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

/** "YOU 60% · ● PRIYA 40%" — scales to three partners, nothing is hardcoded. */
function ShareTag({ shares }: { shares: { name: string; hex: string | null; pct: number }[] }) {
  return (
    <span style={shareTag}>
      {shares.map((s, i) => (
        <span key={s.name + String(i)} style={shareBit}>
          {i > 0 && <span style={shareSep}>·</span>}
          {s.hex !== null && <Dot style={{ '--pc': s.hex, ...dotPc }} />}
          {s.name}
          <b style={sharePct}>{`${s.pct}%`}</b>
        </span>
      ))}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DERIVATION
// ────────────────────────────────────────────────────────────────────────────

function buildGroups(
  properties: PropertyState[],
  partnerships: Partnership[],
  players: Player[],
  myId: string,
): GroupView[] {
  const byIndex = new Map(properties.map((p) => [p.spaceIndex, p]));
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Partner';
  const hexOf = (id: string) => {
    const p = players.find((q) => q.id === id);
    return p ? TOKEN_HEX[p.token] : KIT.text2;
  };

  const out: GroupView[] = [];

  for (const group of GROUP_ORDER) {
    const spaces = GROUP_SPACES.get(group) ?? [];
    const pact = partnerships.find(
      (pt) => pt.status === 'active'
        && pt.colorGroup === group
        && pt.partners.some((e) => e.playerId === myId),
    );
    // ONLY actual partners count as "held with me" — the old code matched the
    // colour group alone, so a stranger's property in a partnered group was
    // listed as mine.
    const partnerIds = new Set(
      (pact?.partners ?? []).map((e) => e.playerId).filter((id) => id !== myId),
    );

    const mineIdx: number[] = [];
    const partnerIdx: number[] = [];
    const offIdx: number[] = [];
    for (const idx of spaces) {
      const st = byIndex.get(idx);
      if (st?.ownerId === myId) mineIdx.push(idx);
      else if (st?.ownerId != null && partnerIds.has(st.ownerId)) partnerIdx.push(idx);
      else offIdx.push(idx);
    }
    if (mineIdx.length === 0 && partnerIdx.length === 0) continue;

    const color = groupColor(COLOR_GROUP_HEX[group], true);
    const pip = (idx: number, kind: PipKind): Pip => ({
      kind,
      hex: kind === 'partner' ? hexOf(byIndex.get(idx)?.ownerId ?? '') : color,
      mortgaged: byIndex.get(idx)?.isMortgaged ?? false,
    });

    const holdings: Holding[] = [...mineIdx, ...partnerIdx].map((idx) => {
      const st = byIndex.get(idx);
      const ownerId = st?.ownerId ?? null;
      const partnerId = ownerId !== null && partnerIds.has(ownerId) ? ownerId : null;
      return {
        spaceIndex: idx,
        name: SPACE_NAME.get(idx) ?? `#${idx}`,
        meta: buildMeta(st),
        mortgaged: st?.isMortgaged ?? false,
        partnerName: partnerId === null ? null : nameOf(partnerId),
        partnerHex: partnerId === null ? null : hexOf(partnerId),
      };
    });

    const myPct = pact?.partners.find((e) => e.playerId === myId)?.percentage ?? null;

    out.push({
      group,
      color,
      total: spaces.length,
      mine: mineIdx.length,
      // A partnered group is never gold: gold means "100% mine", and conflating
      // the two would misreport a partnership as a monopoly.
      complete: mineIdx.length === spaces.length && pact === undefined,
      pips: [
        ...mineIdx.map((i) => pip(i, 'mine')),
        ...partnerIdx.map((i) => pip(i, 'partner')),
        ...offIdx.map((i) => pip(i, 'off')),
      ],
      tintHex: partnerIdx.length > 0 ? hexOf(byIndex.get(partnerIdx[0])?.ownerId ?? '') : null,
      equity: myPct,
      shares: (pact?.partners ?? []).map((e) => ({
        name: e.playerId === myId ? 'You' : nameOf(e.playerId),
        hex: e.playerId === myId ? null : hexOf(e.playerId),
        pct: e.percentage,
      })),
      holdings,
    });
  }
  return out;
}

function buildMeta(st: PropertyState | undefined): string {
  if (!st) return '—';
  if (st.isMortgaged) return 'Mortgaged';
  if (st.hasHotel) return 'Hotel';
  if (st.houses === 1) return '1 house';
  return `${st.houses} houses`;
}

/** Monopolies first, then partnerships (the rows that carry a second party),
 *  then the fullest sets — the four most decision-relevant rows. */
function stripPriority(a: GroupView, b: GroupView): number {
  if (a.complete !== b.complete) return a.complete ? -1 : 1;
  const ap = a.equity !== null, bp = b.equity !== null;
  if (ap !== bp) return ap ? -1 : 1;
  if (a.mine !== b.mine) return b.mine - a.mine;
  return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

/** See PlayerPods — App.tsx mounts this as a bare sibling, so it supplies the
 *  positioned full-size ancestor the kit's absolute surfaces assume. */
const readStage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zHudUnder, pointerEvents: 'none',
};
/** The panel + its scrim, at the panel layer — see the note at the call site. */
const panelStage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zPanel, pointerEvents: 'none',
};
/** Bottom-anchored 56px up: the log peek's 44px plus the 12px dead space, so
 *  the strip grows UPWARD into the gap between the pods and the log and the
 *  peek's tap target never moves. */
const stripSlot: KitStyle = { position: 'absolute', left: 4, right: 0, bottom: 56 };
const emptyRow: KitStyle = { paddingLeft: 5, paddingTop: 2 };
const equity: KitStyle = {
  marginLeft: 'auto',
  font: `800 ${KIT.fsMicro}/1 ${KIT.font}`,
  fontVariantNumeric: 'tabular-nums',
  textShadow: KIT.textLegible,
};

const panelEmpty: KitStyle = { font: `400 ${KIT.fsLabelLg}/1.38 ${KIT.font}`, color: KIT.text2 };
const panelGroup: KitStyle = { marginBottom: KIT.sp3 };
const groupHead: KitStyle = { width: '100%' };
const holdingRow: KitStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: KIT.sp2,
  width: '100%', minHeight: KIT.tapMin, padding: `0 ${KIT.rowPad}`,
  border: 0, borderRadius: KIT.rSm, background: 'none',
  color: KIT.text, textAlign: 'left', cursor: 'pointer', touchAction: 'manipulation',
};
/** THEIR colour, not mine and not a generic warning tone. */
const holdingPartner: KitStyle = {
  background: 'linear-gradient(90deg, color-mix(in srgb, var(--pc) 12%, transparent), transparent 85%)',
};
const holdingName: KitStyle = {
  display: 'flex', alignItems: 'center', gap: 5,
  font: `600 ${KIT.fsLabelLg}/1.22 ${KIT.font}`,
};
const holdingMeta: KitStyle = {
  flex: '0 0 auto',
  font: `600 ${KIT.fsMicro}/1.22 ${KIT.font}`,
  textTransform: 'uppercase', letterSpacing: KIT.lsWider, color: KIT.text2,
};
const dotPc: KitStyle = {
  flex: '0 0 auto',
  background: 'var(--pc)',
  boxShadow: '0 0 8px 2px color-mix(in srgb, var(--pc) 55%, transparent)',
};
const shareTag: KitStyle = {
  marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
  font: `600 ${KIT.fsMicro}/1 ${KIT.font}`,
  textTransform: 'uppercase', letterSpacing: KIT.lsWide,
  color: KIT.text2, whiteSpace: 'nowrap',
};
const shareBit: KitStyle = { display: 'inline-flex', alignItems: 'center', gap: 4 };
const shareSep: KitStyle = { color: KIT.text3 };
const sharePct: KitStyle = { color: KIT.text, fontWeight: 800 };
