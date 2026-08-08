import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { resolveCharacter } from '../constants/characters';
import { RARITY_COLOR, RARITY_LABEL, resolveSkinMeta } from '../constants/skins';
import {
  Button, Field, KIT, Segs, Takeover, TakeoverCol, TakeoverRule, cx,
} from '../ui/kit';
import type { KitStyle } from '../ui/kit';
import { buildLocker, isUnlocked, ownedCount } from './characterLocker';
import type { LockerFilter, LockerTile } from './characterLocker';
import { NEUTRAL_TURN, SHELL_BACKDROP, SHELL_STAGE_TAKEOVER } from './shellChrome';
import { SkinColorPicker } from './TokenPicker';

/**
 * THE LOCKER — 52 cosmetic skins, laid out Fortnite-style.
 *
 * *** PAYMENTS ARE DEFERRED. *** There is no purchase flow, no price and no
 * store anywhere on this screen. What there is, is the shape a store needs:
 * owned tiles and locked tiles, visibly different, driven by ONE predicate —
 * `isUnlocked(characterId)` in `characterLocker.ts` — which returns true for
 * everything today. A later commit flips that one function body and this
 * layout does not move.
 *
 * WHY A TAKEOVER. The kit reserves takeovers for comparative, full-attention
 * surfaces. A browsable 52-tile grid beside a pinned live preview is exactly
 * that shape: you are comparing a candidate against what you have equipped, and
 * a 250px read-only column cannot host either half. The approved mockup uses
 * the takeover's own head / body / two-column / footer structure verbatim, and
 * so does this.
 *
 * THE MEASURED BUDGET, at 844x390 — measured in the browser, not estimated.
 * The takeover's content box is 750x353. The head is 44 (the close button's
 * 44px floor sets it, not the title) and the footer 56, leaving 237 for the
 * body and 233 for a column. The wide column takes 1.9 of 2.9 (454px, 438
 * inside its padding) and the narrow column the rest (247, 231 inside). The
 * filter row takes 50, so the grid gets 175 — TWO full rows of 67px tiles plus
 * a visible slice of a third, which IS the scroll affordance. Everything below
 * is arithmetic on those numbers.
 *
 * BOTH COLUMNS ARE `overflow: visible`. `TakeoverCol` is a scroll container by
 * default, and `overflow-y:auto` clips the X axis too, which would slice the
 * tiles' rarity rings and the preview stage's drop shadow. The ONE thing that
 * scrolls is the grid, in its own wrapper.
 */

// ── Lazy 3D preview — three/drei stay off the menu-screen entry bundle. This is
//    the ONLY live WebGL canvas on the screen; the 52 grid tiles are static <img>.
const CharacterPreview = lazy(() =>
  import('./CharacterPreviewCanvas').then((m) => ({ default: m.CharacterPreviewCanvas })),
);

/**
 * SIX COLUMNS: (438 - 5x8) / 6 = 66.3px tiles, 74.3px of row pitch, so twelve
 * portraits and a slice of a thirteenth row are on screen at once.
 *
 * The alternative was five 82px tiles, which fits exactly two rows and NO
 * partial third — a grid with no visible cut edge reads as complete, and a
 * locker showing 10 of 52 with no sign of the other 42 is the wrong lie to
 * tell. Seven columns (56px) fits nearly three rows but the portraits stop
 * being identifiable, which is the only thing a tile is for.
 */
const GRID_COLS = 6;

const FILTERS: { value: LockerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'locked', label: 'Locked' },
];

export function CharacterSelect() {
  const navigate = useNavigate();

  const storeCharacter = useGameStore((s) => s.selectedCharacter);
  const setSelectedCharacter = useGameStore((s) => s.setSelectedCharacter);
  const storeCharacterColor = useGameStore((s) => s.selectedCharacterColor);
  const setSelectedCharacterColor = useGameStore((s) => s.setSelectedCharacterColor);

  // Local drafts — committed on Equip, so backing out changes nothing.
  const [selectedId, setSelectedId] = useState(storeCharacter);
  const [characterColor, setCharacterColor] = useState<string | null>(storeCharacterColor);
  const [filter, setFilter] = useState<LockerFilter>('all');
  const [search, setSearch] = useState('');

  const selectedDef = useMemo(() => resolveCharacter(selectedId), [selectedId]);
  const selectedMeta = useMemo(() => resolveSkinMeta(selectedDef.id), [selectedDef]);
  const accent = RARITY_COLOR[selectedMeta.rarity];
  const tiles = useMemo(() => buildLocker(search, filter), [search, filter]);
  const owned = ownedCount();

  /** A locked skin still previews — you can look at what you do not own. */
  const canEquip = isUnlocked(selectedDef.id);

  /**
   * THE EQUIPPED SKIN HAS TO BE ON SCREEN WHEN THE LOCKER OPENS. Nine rows of
   * six, two and a bit visible: open it with your own character equipped from
   * row eight and the grid shows you six strangers and no sign of yourself.
   * Runs once, on mount, and only for the id that came out of the store —
   * tapping a tile must never yank the grid around under the finger.
   */
  const equippedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = equippedRef.current;
    // jsdom has no layout and no scrollIntoView; the guard keeps tests honest.
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, []);

  const back = useCallback(() => { navigate('/'); }, [navigate]);
  const equip = useCallback(() => {
    if (!isUnlocked(selectedDef.id)) return;
    setSelectedCharacter(selectedDef.id);
    setSelectedCharacterColor(characterColor);
    navigate('/');
  }, [selectedDef.id, characterColor, setSelectedCharacter, setSelectedCharacterColor, navigate]);

  return (
    <div style={{ ...SHELL_STAGE_TAKEOVER, ...NEUTRAL_TURN }}>
      <i style={SHELL_BACKDROP} aria-hidden="true" />

      {/*
        `open` IS A LITERAL HERE, and that is not the mistake it looks like.
        A <Panel> stays mounted when closed so its exit can animate; this
        takeover IS the route — React unmounts the whole screen on navigation,
        so there is no exit to animate and no state to keep. Deferring `open` by
        a frame to force the fade-in only bought a 450ms delay on a route change
        and left the surface `aria-hidden` for that frame.
      */}
      <Takeover
        open
        label="Character select"
        eyebrow={`Locker · ${RARITY_LABEL[selectedMeta.rarity]} · ${owned}/52 owned`}
        title={selectedDef.name}
        onClose={back}
        footer={
          <>
            {/*
              THE COLOUR PICKER LIVES IN THE FOOTER, and that is worth 100px of
              preview. Stacked under the preview it took two 44px rows out of a
              233px column and left the live character 131px tall — about 42px
              of actual figure, because the camera's vertical field of view is
              fixed and a short viewport simply renders a smaller person. As one
              44px row down here the footer does not grow at all (EQUIP is 48),
              the preview takes the whole column, and the character doubles.

              `marginRight: auto` against the footer's `justify-content:flex-end`
              is what pushes it left of the two buttons.
            */}
            <div style={footerPicker}>
              <SkinColorPicker value={characterColor} onChange={setCharacterColor} columns={8} />
            </div>
            <Button variant="ghost" label="Back" onClick={back} />
            <Button
              variant="gold"
              sheen={canEquip}
              label={canEquip ? 'Equip' : 'Locked'}
              disabled={!canEquip}
              onClick={equip}
            />
          </>
        }
      >
        <TakeoverCol top style={wideCol}>
          <div style={filterRow}>
            <Segs value={filter} options={FILTERS} onChange={setFilter} ariaLabel="Ownership filter" />
            {/*
              SEARCH ALSO MATCHES THE CATEGORY, which is what replaced the old
              row of 13 category chips: the grid only has 175px of height, and a
              second filter row would have cost a third of it. Typing "viking"
              still reaches the nine Viking skins.
            */}
            <Field value={search} onChange={setSearch} placeholder="Search skins or theme" />
          </div>

          <div style={gridWrap}>
            <div style={grid} role="listbox" aria-label="Skins">
              {tiles.length === 0 && <div style={emptyMsg}>No skins match that search.</div>}
              {tiles.map((t) => (
                <SkinTile
                  key={t.id}
                  tile={t}
                  selected={t.id === selectedId}
                  tileRef={t.id === storeCharacter ? equippedRef : undefined}
                  onSelect={() => { setSelectedId(t.id); }}
                />
              ))}
            </div>
          </div>
        </TakeoverCol>

        <TakeoverRule />

        {/* Not `top`: the column's auto margins centre the single capped stage. */}
        <TakeoverCol style={narrowCol}>
          {/*
            THE ONE LIVE CANVAS, and it now owns the whole column. `flex:1 1
            auto; min-height:0` inside a column with a definite height gives it
            a definite height too — an explicit aspect-ratio here would lose a
            flexbox auto-minimum-size fight and measure 0px tall.
          */}
          <div style={previewStage}>
            <Suspense fallback={<div style={previewFallback}>Loading preview…</div>}>
              <CharacterPreview
                url={selectedDef.url}
                accent={accent}
                baseColor={characterColor ?? undefined}
              />
            </Suspense>
            <span style={stageTag(accent)} data-testid="rarity-badge">
              {RARITY_LABEL[selectedMeta.rarity]}
            </span>
            {!canEquip && (
              <span style={stageLock}>
                <Lock size={11} aria-hidden />
                Locked
              </span>
            )}
          </div>
        </TakeoverCol>
      </Takeover>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TILE
// ────────────────────────────────────────────────────────────────────────────

/**
 * One skin card. EVERY DECORATION IS INSET — no outward box-shadow, no negative
 * margin — because these live inside the grid's scroll container, and a
 * scrolling ancestor beats any z-index (rule R1).
 *
 * Locked is carried three ways, never by colour alone: a lock chip, a solid
 * muted name colour (never opacity — rule R3), and a desaturating filter on the
 * portrait itself.
 */
function SkinTile({
  tile,
  selected,
  tileRef,
  onSelect,
}: {
  tile: LockerTile;
  selected: boolean;
  /** Set only on the tile that was equipped when the locker opened. */
  tileRef?: RefObject<HTMLButtonElement>;
  onSelect: () => void;
}) {
  return (
    <button
      ref={tileRef}
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={tile.locked ? `${tile.name}, locked` : tile.name}
      data-rarity={tile.rarity}
      data-locked={tile.locked}
      title={tile.name}
      onClick={onSelect}
      style={tileBox(selected, tile.frame)}
    >
      <img
        src={tile.thumb}
        alt={tile.name}
        loading="lazy"
        decoding="async"
        style={tile.locked ? tileImgLocked : tileImg}
      />
      {tile.locked && (
        <span style={tileLock} aria-hidden="true">
          <Lock size={10} />
        </span>
      )}
      <span className={cx('kit-trunc')} style={tile.locked ? tileNameLocked : tileName}>
        {tile.name}
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY — every number is arithmetic on the budget in the header note.
// ────────────────────────────────────────────────────────────────────────────

/** 1.9 : 1 against the narrow column. overflow:visible — see the header note. */
const wideCol: KitStyle = { flex: '1.9 1 0', overflow: 'visible' };
const narrowCol: KitStyle = { flex: '1 1 0', maxWidth: 262, overflow: 'visible' };

/** Segs (3 items, ~232 natural) + a flexible search field, on one 50px row. */
const filterRow: KitStyle = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: KIT.tapGap,
};

/**
 * The one scroll container on the screen. The bottom mask softens the last
 * visible row instead of hard-clipping it, so a half-row reads as "there is
 * more" rather than as a rendering error.
 */
const gridWrap: KitStyle = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
  // scrollIntoView on the equipped tile lands it flush against the edge
  // otherwise, which reads as clipped rather than as scrolled.
  scrollPaddingBlock: 8,
  maskImage: 'linear-gradient(180deg, #000 0, #000 calc(100% - 18px), rgb(0 0 0 / 12%) 100%)',
  WebkitMaskImage: 'linear-gradient(180deg, #000 0, #000 calc(100% - 18px), rgb(0 0 0 / 12%) 100%)',
};

const grid: KitStyle = {
  display: 'grid',
  gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
  gap: KIT.sp2,
  gridAutoRows: 'min-content',
  alignContent: 'start',
  paddingBottom: 2,
};

const emptyMsg: KitStyle = {
  gridColumn: '1 / -1',
  padding: `${KIT.sp6} 0`,
  textAlign: 'center',
  font: `500 ${KIT.fsLabelLg}/${KIT.lhSnug} ${KIT.font}`,
  color: KIT.text2,
};

/**
 * ~67px square at six columns. Comfortably above the 44px tap floor, and small
 * enough that twelve portraits and a slice of a thirteenth row are on screen at
 * once — a locker that shows four skins is a list, not a locker.
 */
function tileBox(selected: boolean, frame: string): KitStyle {
  return {
    position: 'relative',
    aspectRatio: '1',
    minHeight: 44,
    padding: 0,
    border: 0,
    borderRadius: KIT.rMd,
    cursor: 'pointer',
    touchAction: 'manipulation',
    overflow: 'hidden',
    // SELECTED MUST NOT READ AS "LEGENDARY". Legendary's frame is already gold,
    // so a gold ring alone is ambiguous: selection adds a gold WASH and a
    // second, brighter ring inside it. Both are inset — nothing may overhang a
    // scroll container (rule R1).
    background: selected
      ? 'linear-gradient(160deg, rgb(212 175 55 / 24%), rgb(9 10 18 / 92%))'
      : `linear-gradient(160deg, ${KIT.surfaceRaised}, ${KIT.surfaceSunken})`,
    boxShadow: selected
      ? `inset 0 0 0 2px ${KIT.goldBright}, inset 0 0 0 5px rgb(240 208 96 / 30%)`
      : `inset 0 0 0 2px ${frame}`,
    transition: `box-shadow ${KIT.durTap} ${KIT.easeOut}, transform ${KIT.durTap} ${KIT.easeOut}`,
  };
}

/** The art stops 15px short of the bottom so the name band is never drawn over
 *  a face. A portrait centred in the remaining 52px still reads at 67px wide. */
const tileImg: KitStyle = {
  position: 'absolute',
  inset: '0 0 15px',
  width: '100%',
  height: 'calc(100% - 15px)',
  objectFit: 'contain',
};
/** Locked art is desaturated, not faded — opacity on a tile would fade its
 *  name and ring with it (rule R3). */
const tileImgLocked: KitStyle = { ...tileImg, filter: 'grayscale(1) brightness(0.6)' };

/**
 * The name band. Full-bleed with its own scrim rather than a separate
 * overlapping element: two absolute siblings would need a z-index to keep the
 * text above the gradient, and one box cannot be out of order with itself.
 * Sentence case, no tracking — caps plus 0.4px of tracking cost two characters
 * of an already tight 61px.
 */
const tileNameBase: KitStyle = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  display: 'block',
  padding: '0 3px 1px',
  font: `700 ${KIT.fsMicro}/14px ${KIT.font}`,
  letterSpacing: KIT.lsNone,
  textAlign: 'center',
  textShadow: KIT.textLegible,
  background: 'linear-gradient(180deg, transparent, rgb(4 4 10 / 78%) 55%)',
};
const tileName: KitStyle = { ...tileNameBase, color: KIT.text };
const tileNameLocked: KitStyle = { ...tileNameBase, color: KIT.text3 };

const tileLock: KitStyle = {
  position: 'absolute',
  top: 3,
  right: 3,
  width: 16,
  height: 16,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  color: KIT.text2,
  background: 'rgb(4 4 10 / 82%)',
  boxShadow: 'inset 0 0 0 1px rgb(232 232 240 / 18%)',
};

/**
 * The whole narrow column — see the footer note about why.
 *
 * CAPPED AT 200px, AND THAT IS A CAMERA CONSTRAINT, NOT A TASTE ONE.
 * `CharacterPreviewCanvas` is frozen: its camera is a 38° VERTICAL field of
 * view at 1.55 units, which puts the podium's 0.6-unit ring exactly at the
 * frame edge when the stage is square. At the column's full 233px the stage is
 * 231x233 and the ring is sliced on both sides; at 231x200 the horizontal
 * half-extent is 0.72 units and it clears. The column's auto margins centre
 * what is left over.
 */
const previewStage: KitStyle = {
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 120,
  maxHeight: 200,
  borderRadius: KIT.rLg,
  overflow: 'hidden',
  background: 'radial-gradient(120% 90% at 50% 8%, rgb(212 175 55 / 12%), transparent 60%), linear-gradient(180deg, #1c1d30, #0c0c16)',
  // --shadow-1 (6px reach), not --shadow-2 (16px): this column is only
  // `overflow: visible` because nothing in it needs to escape far.
  boxShadow: `${KIT.ringHair}, ${KIT.shadow1}`,
};

const previewFallback: KitStyle = {
  width: '100%',
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  font: `500 ${KIT.fsLabel}/${KIT.lhSnug} ${KIT.font}`,
  color: KIT.text2,
};

/** Pushed left of BACK / EQUIP by the footer's own `justify-content:flex-end`. */
const footerPicker: KitStyle = { marginRight: 'auto' };

/**
 * A LOCKED SKIN STILL PREVIEWS — you can look at what you do not own, which is
 * the whole point of a locker. This chip is the second carrier of that state
 * (the third is EQUIP reading "LOCKED" and being inert), so it never rests on
 * the tile's lock glyph alone.
 */
const stageLock: KitStyle = {
  position: 'absolute',
  right: KIT.sp2,
  bottom: KIT.sp2,
  height: 16,
  padding: `0 ${KIT.sp2}`,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderRadius: KIT.rPill,
  font: `700 ${KIT.fsMicro}/${KIT.lhFlat} ${KIT.font}`,
  textTransform: 'uppercase',
  letterSpacing: KIT.lsWider,
  color: KIT.text2,
  background: 'rgb(4 4 10 / 82%)',
  boxShadow: 'inset 0 0 0 1px rgb(232 232 240 / 18%)',
};

/** Rarity, pinned to the stage rather than given its own row — the narrow
 *  column is the live preview and nothing else. */
function stageTag(hex: string): KitStyle {
  return {
    position: 'absolute',
    left: KIT.sp2,
    bottom: KIT.sp2,
    padding: `0 ${KIT.sp2}`,
    height: 16,
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: KIT.rPill,
    font: `700 ${KIT.fsMicro}/${KIT.lhFlat} ${KIT.font}`,
    textTransform: 'uppercase',
    letterSpacing: KIT.lsWider,
    color: hex,
    background: 'rgb(4 4 10 / 74%)',
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 55%, transparent)`,
  };
}
