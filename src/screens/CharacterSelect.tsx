import { lazy, Suspense, useState, useMemo, useCallback } from 'react';
import { Lock, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { CHARACTERS, CHARACTER_CATEGORIES, resolveCharacter } from '../constants/characters';
import type { CharacterCategory } from '../constants/characters';
import {
  resolveSkinMeta,
  isSkinUnlocked,
  skinThumbnailUrl,
  RARITY_COLOR,
  RARITY_LABEL,
} from '../constants/skins';
import { TOKEN_HEX, GOLD, GOLD_BRIGHT } from '../constants/theme';
import type { TokenType } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';
import { GameButton } from '../ui/GameButton';
import { useIsMobile } from '../ui/useIsMobile';

// ── Lazy 3D preview — three/drei stay off the menu-screen entry bundle. This is
//    the ONLY live WebGL canvas on the screen; the 52 grid cards use static
//    thumbnail <img>. ──
const CharacterPreview = lazy(() =>
  import('./CharacterPreviewCanvas').then((m) => ({ default: m.CharacterPreviewCanvas })),
);

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];
const ALL_CAT = 'All' as const;
type CatFilter = typeof ALL_CAT | CharacterCategory;

export function CharacterSelect() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Persisted selections from the store.
  const storeCharacter = useGameStore((s) => s.selectedCharacter);
  const setSelectedCharacter = useGameStore((s) => s.setSelectedCharacter);
  const storeToken = useGameStore((s) => s.selectedToken);
  const setSelectedToken = useGameStore((s) => s.setSelectedToken);

  // Local drafts — committed on Equip.
  const [selectedId, setSelectedId] = useState(storeCharacter);
  const [token, setToken] = useState<TokenType>(storeToken);
  const [category, setCategory] = useState<CatFilter>(ALL_CAT);
  const [search, setSearch] = useState('');

  const selectedDef = useMemo(() => resolveCharacter(selectedId), [selectedId]);
  const selectedMeta = useMemo(() => resolveSkinMeta(selectedDef.id), [selectedDef]);
  const accent = RARITY_COLOR[selectedMeta.rarity];

  const filtered = useMemo(() => {
    const lc = search.trim().toLowerCase();
    return CHARACTERS.filter((c) => {
      const catOk = category === ALL_CAT || c.category === category;
      const searchOk =
        !lc || c.name.toLowerCase().includes(lc) || c.id.toLowerCase().includes(lc);
      return catOk && searchOk;
    });
  }, [category, search]);

  const pickRandom = useCallback(() => {
    const pool = filtered.length > 0 ? filtered : CHARACTERS;
    setSelectedId(pool[Math.floor(Math.random() * pool.length)].id);
  }, [filtered]);

  const equip = useCallback(() => {
    setSelectedCharacter(selectedDef.id);
    setSelectedToken(token);
    navigate('/');
  }, [selectedDef.id, token, setSelectedCharacter, setSelectedToken, navigate]);

  const back = useCallback(() => navigate('/'), [navigate]);

  // ── The shared building blocks (used by both desktop columns & mobile stack) ──

  const previewPanel = (
    <div style={s.previewPanel}>
      <div style={s.canvasWrap(isMobile)}>
        <Suspense fallback={<div style={s.previewFallback}>Loading preview…</div>}>
          <CharacterPreview url={selectedDef.url} accent={accent} />
        </Suspense>
      </div>

      {/* Rarity banner + name + category + description (the "EPIC | OUTFIT" panel) */}
      <div style={s.infoPanel(accent)} data-testid="rarity-panel">
        <div style={s.rarityRow}>
          <span style={s.rarityBadge(accent)} data-testid="rarity-badge">
            {RARITY_LABEL[selectedMeta.rarity]}
          </span>
          <span style={s.rarityDivider}>·</span>
          <span style={s.categoryLabel}>{selectedDef.category}</span>
          {selectedMeta.premium && <span style={s.premiumTag}>PREMIUM</span>}
        </div>
        <h2 style={s.skinName}>{selectedDef.name}</h2>
        <p style={s.skinDesc}>{selectedMeta.description}</p>
      </div>

      {/* Board-identity color — labelled so it isn't confused with the skin. */}
      <div style={s.colorBlock}>
        <div style={s.colorLabel}>Your color</div>
        <div style={s.swatchRow} role="group" aria-label="Your board color">
          {TOKENS.map((t) => (
            <button
              key={t}
              aria-label={t}
              aria-pressed={t === token}
              onClick={() => setToken(t)}
              style={s.swatch(t === token, TOKEN_HEX[t])}
            />
          ))}
        </div>
      </div>

      <div style={s.actions(isMobile)}>
        <GameButton variant="tertiary" fullWidth onClick={back}>
          Back
        </GameButton>
        <GameButton variant="primary" fullWidth onClick={equip}>
          Equip
        </GameButton>
      </div>
    </div>
  );

  const gridPanel = (
    <div style={s.gridCol(isMobile)}>
      <div style={s.gridHeader}>
        <h1 style={s.title(isMobile)}>LOCKER</h1>
        <div style={s.controls}>
          <input
            placeholder="Search skins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={s.searchInput}
            aria-label="Search skins"
          />
          <GameButton variant="secondary" onClick={pickRandom}>
            Random
          </GameButton>
        </div>
        <div style={s.chipsRow} role="tablist" aria-label="Skin categories">
          {([ALL_CAT, ...CHARACTER_CATEGORIES] as CatFilter[]).map((cat) => (
            <button
              key={cat}
              role="tab"
              aria-selected={category === cat}
              onClick={() => setCategory(cat)}
              style={s.chip(category === cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div style={s.grid} role="listbox" aria-label="Skins">
        {filtered.length === 0 && (
          <div style={s.emptyMsg}>No skins match your search.</div>
        )}
        {filtered.map((char) => {
          const meta = resolveSkinMeta(char.id);
          const frame = RARITY_COLOR[meta.rarity];
          const isSelected = char.id === selectedId;
          const locked = !isSkinUnlocked(char.id);
          return (
            <button
              key={char.id}
              role="option"
              aria-selected={isSelected}
              onClick={() => setSelectedId(char.id)}
              style={s.card(isSelected, frame)}
              title={char.name}
              data-rarity={meta.rarity}
            >
              <span style={s.cardThumbWrap(frame)}>
                <img
                  src={skinThumbnailUrl(char.id)}
                  alt={char.name}
                  loading="lazy"
                  decoding="async"
                  style={s.cardThumb}
                />
                {(locked || meta.premium) && (
                  <span
                    style={s.badge(locked)}
                    aria-label={locked ? 'Locked' : 'Premium'}
                    data-testid="skin-badge"
                  >
                    {locked ? <Lock size={12} aria-hidden /> : <Star size={12} aria-hidden />}
                  </span>
                )}
              </span>
              <span style={s.cardName}>{char.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // Desktop: LEFT = grid (~55%), RIGHT = big preview + info (~45%).
  // Mobile: stack — preview on top, name/rarity/desc + color + Equip, then grid.
  return (
    <div style={s.page}>
      {isMobile ? (
        <div style={s.mobileStack}>
          {previewPanel}
          {gridPanel}
        </div>
      ) : (
        <div style={s.desktop}>
          {gridPanel}
          {previewPanel}
        </div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const FONT = FONT_FAMILY;
const BG = '#08080f';
const PANEL_BG = '#12121e';
const CARD_BG = '#171724';
const BORDER = '#2a2a40';
const TEXT_PRIMARY = '#e8e8f0';
const TEXT_SECONDARY = '#8888a0';
const CREAM = '#f7f0dd';

/** Convert a #rrggbb accent into an rgba() glow at the given alpha. */
function glow(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const s = {
  page: {
    position: 'fixed',
    inset: 0,
    background: BG,
    fontFamily: FONT,
    color: TEXT_PRIMARY,
    overflow: 'hidden',
  } as React.CSSProperties,

  // ── Desktop split ──
  desktop: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
  } as React.CSSProperties,

  // ── Mobile stack ──
  mobileStack: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflowY: 'auto',
    paddingBottom: 'env(safe-area-inset-bottom)',
  } as React.CSSProperties,

  // ── Left: the grid column (desktop ~55%) ──
  gridCol: (m: boolean): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    flex: m ? 'none' : '0 0 55%',
    width: m ? '100%' : '55%',
    padding: m ? '12px 12px 20px' : '20px 22px',
    gap: 12,
    boxSizing: 'border-box',
    borderRight: m ? 'none' : `1px solid ${BORDER}`,
    overflow: m ? 'visible' : 'hidden',
  }),

  gridHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    flexShrink: 0,
  } as React.CSSProperties,

  title: (m: boolean): React.CSSProperties => ({
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: m ? 22 : 28,
    color: GOLD,
    margin: 0,
    letterSpacing: '0.08em',
  }),

  controls: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  } as React.CSSProperties,

  searchInput: {
    fontFamily: FONT,
    fontSize: 16, // 16px avoids iOS focus zoom
    fontWeight: 600,
    color: TEXT_PRIMARY,
    background: PANEL_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: '10px 14px',
    outline: 'none',
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    minHeight: 44,
  } as React.CSSProperties,

  chipsRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  } as React.CSSProperties,

  chip: (active: boolean): React.CSSProperties => ({
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: active ? 800 : 600,
    padding: '7px 11px',
    borderRadius: 999,
    border: active ? `1px solid ${GOLD}` : `1px solid ${BORDER}`,
    background: active ? glow(GOLD, 0.18) : PANEL_BG,
    color: active ? GOLD : TEXT_SECONDARY,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    minHeight: 32,
  }),

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 10,
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
    paddingBottom: 8,
    alignContent: 'start',
  } as React.CSSProperties,

  emptyMsg: {
    gridColumn: '1 / -1',
    color: TEXT_SECONDARY,
    fontFamily: FONT,
    fontSize: 14,
    textAlign: 'center',
    padding: '32px 0',
  } as React.CSSProperties,

  card: (selected: boolean, frame: string): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 14,
    // Rarity-colored frame; SELECTED = prominent gold ring on top.
    border: selected ? `2px solid ${GOLD}` : `2px solid ${frame}`,
    background: selected ? glow(GOLD, 0.14) : CARD_BG,
    boxShadow: selected
      ? `0 0 0 3px ${glow(GOLD, 0.35)}, 0 4px 14px ${glow(GOLD, 0.25)}`
      : `0 2px 8px rgba(0,0,0,0.35)`,
    cursor: 'pointer',
    boxSizing: 'border-box',
    width: '100%',
    textAlign: 'center',
  }),

  cardThumbWrap: (frame: string): React.CSSProperties => ({
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    borderRadius: 10,
    // A subtle rarity-tinted gradient behind the transparent portrait.
    background: `radial-gradient(circle at 50% 38%, ${glow(frame, 0.28)}, ${glow(frame, 0.06)} 70%, transparent)`,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),

  cardThumb: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'auto',
  } as React.CSSProperties,

  badge: (locked: boolean): React.CSSProperties => ({
    position: 'absolute',
    top: 4,
    right: 4,
    lineHeight: 1,
    padding: '3px 5px',
    borderRadius: 8,
    background: locked ? 'rgba(0,0,0,0.65)' : glow(GOLD, 0.85),
    color: locked ? '#fff' : '#1a1400',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),

  cardName: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 700,
    color: TEXT_PRIMARY,
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    width: '100%',
  } as React.CSSProperties,

  // ── Right: the big preview + info panel (desktop ~45%) ──
  previewPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 14,
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    padding: '20px 22px',
    boxSizing: 'border-box',
    background: PANEL_BG,
  } as React.CSSProperties,

  canvasWrap: (m: boolean): React.CSSProperties => ({
    width: '100%',
    height: m ? 240 : 340,
    minHeight: m ? 200 : 260,
    flex: m ? 'none' : 1,
    borderRadius: 18,
    overflow: 'hidden',
    background: '#0d0d18',
    border: `1px solid ${BORDER}`,
  }),

  previewFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: TEXT_SECONDARY,
    fontFamily: FONT,
    fontSize: 14,
  } as React.CSSProperties,

  infoPanel: (accent: string): React.CSSProperties => ({
    borderRadius: 14,
    padding: '12px 16px',
    background: `linear-gradient(135deg, ${glow(accent, 0.22)}, ${glow(accent, 0.06)})`,
    borderLeft: `4px solid ${accent}`,
    border: `1px solid ${glow(accent, 0.4)}`,
  }),

  rarityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  } as React.CSSProperties,

  rarityBadge: (accent: string): React.CSSProperties => ({
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: accent,
  }),

  rarityDivider: {
    color: TEXT_SECONDARY,
    fontWeight: 800,
  } as React.CSSProperties,

  categoryLabel: {
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: TEXT_SECONDARY,
  } as React.CSSProperties,

  premiumTag: {
    marginLeft: 'auto',
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 10,
    letterSpacing: '0.08em',
    color: '#1a1400',
    background: GOLD_BRIGHT,
    borderRadius: 6,
    padding: '2px 6px',
  } as React.CSSProperties,

  skinName: {
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 24,
    color: CREAM,
    margin: '6px 0 2px',
    lineHeight: 1.1,
  } as React.CSSProperties,

  skinDesc: {
    fontFamily: FONT,
    fontWeight: 500,
    fontSize: 13,
    color: TEXT_PRIMARY,
    margin: 0,
    lineHeight: 1.4,
    opacity: 0.85,
  } as React.CSSProperties,

  colorBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,

  colorLabel: {
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: TEXT_SECONDARY,
  } as React.CSSProperties,

  swatchRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  } as React.CSSProperties,

  swatch: (selected: boolean, hex: string): React.CSSProperties => ({
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: hex,
    border: selected ? `3px solid ${GOLD}` : '3px solid rgba(255,255,255,0.25)',
    cursor: 'pointer',
    padding: 0,
    boxShadow: selected ? `0 0 0 2px ${glow(GOLD, 0.4)}` : 'none',
    transform: selected ? 'scale(1.12)' : 'scale(1)',
    transition: 'transform 0.12s ease',
    touchAction: 'manipulation',
  }),

  actions: (m: boolean): React.CSSProperties => ({
    display: 'flex',
    gap: 12,
    marginTop: m ? 4 : 'auto',
    justifyContent: 'stretch',
  }),
};
