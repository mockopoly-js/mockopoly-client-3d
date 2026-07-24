import { lazy, Suspense, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { CHARACTERS, CHARACTER_CATEGORIES, resolveCharacter } from '../constants/characters';
import type { CharacterCategory } from '../constants/characters';
import { TOKEN_HEX, GOLD, GOLD_BRIGHT } from '../constants/theme';
import type { TokenType } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';
import { GameButton } from '../ui/GameButton';
import { useIsMobile } from '../ui/useIsMobile';

// ── Lazy 3D preview — three/drei stay off the menu-screen bundle ──
const CharacterPreview = lazy(() =>
  import('./CharacterPreviewCanvas').then((m) => ({ default: m.CharacterPreviewCanvas })),
);

const TOKENS = Object.keys(TOKEN_HEX) as TokenType[];
const ALL_CAT = 'All' as const;
type CatFilter = typeof ALL_CAT | CharacterCategory;

export function CharacterSelect() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Persisted selections from store
  const storeCharacter = useGameStore((s) => s.selectedCharacter);
  const setSelectedCharacter = useGameStore((s) => s.setSelectedCharacter);

  // Local state — committed on Confirm
  const [highlighted, setHighlighted] = useState(storeCharacter);
  const [category, setCategory] = useState<CatFilter>(ALL_CAT);
  const [search, setSearch] = useState('');
  // Token color is read from store directly so we can show the preview tinted;
  // we don't change the token here (no setToken call needed — just read).
  // But we DO let the user pick a different token on this screen for flair.
  const [previewToken, setPreviewToken] = useState<TokenType>(() => {
    // Read the current token from localStorage if available (not tracked in store)
    return 'red';
  });

  const highlightedDef = useMemo(() => resolveCharacter(highlighted), [highlighted]);

  // Filtered list
  const filtered = useMemo(() => {
    const lc = search.toLowerCase();
    return CHARACTERS.filter((c) => {
      const catOk = category === ALL_CAT || c.category === category;
      const searchOk = !lc || c.name.toLowerCase().includes(lc) || c.id.toLowerCase().includes(lc);
      return catOk && searchOk;
    });
  }, [category, search]);

  const pickRandom = useCallback(() => {
    const pool = filtered.length > 0 ? filtered : CHARACTERS;
    const idx = Math.floor(Math.random() * pool.length);
    setHighlighted(pool[idx].id);
  }, [filtered]);

  const confirm = useCallback(() => {
    setSelectedCharacter(highlighted);
    navigate('/');
  }, [highlighted, setSelectedCharacter, navigate]);

  const back = useCallback(() => navigate('/'), [navigate]);

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={header(isMobile)}>
        <button onClick={back} style={backBtn} aria-label="Back">‹</button>
        <h1 style={titleStyle(isMobile)}>Choose Your Character</h1>
        <div style={{ width: 44 }} /> {/* spacer to balance the back button */}
      </div>

      <div style={body(isMobile)}>
        {/* LEFT: 3D preview + color swatches */}
        <div style={previewCol(isMobile)}>
          <div style={canvasWrap(isMobile)}>
            <Suspense fallback={<div style={previewFallback}>Loading preview…</div>}>
              <CharacterPreview url={highlightedDef.url} tint={TOKEN_HEX[previewToken]} />
            </Suspense>
          </div>
          <div style={charNameBadge}>{highlightedDef.name}</div>

          {/* Color swatches — tint the preview */}
          <div style={swatchRow}>
            {TOKENS.map((t) => (
              <button
                key={t}
                aria-label={t}
                onClick={() => setPreviewToken(t)}
                style={swatchStyle(t === previewToken, TOKEN_HEX[t])}
              />
            ))}
          </div>

          <div style={previewActions(isMobile)}>
            <GameButton variant="tertiary" onClick={pickRandom}>
              Random
            </GameButton>
            <GameButton variant="primary" onClick={confirm}>
              Confirm
            </GameButton>
          </div>
        </div>

        {/* RIGHT: search + category tabs + grid */}
        <div style={pickerCol(isMobile)}>
          {/* Search */}
          <input
            placeholder="Search characters…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInput}
            aria-label="Search characters"
          />

          {/* Category tabs */}
          <div style={tabsRow} role="tablist" aria-label="Character categories">
            {([ALL_CAT, ...CHARACTER_CATEGORIES] as CatFilter[]).map((cat) => (
              <button
                key={cat}
                role="tab"
                aria-selected={category === cat}
                onClick={() => setCategory(cat)}
                style={tabStyle(category === cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Character grid */}
          <div style={grid} role="listbox" aria-label="Characters">
            {filtered.length === 0 && (
              <div style={emptyMsg}>No characters match your search.</div>
            )}
            {filtered.map((char) => {
              const isSelected = char.id === highlighted;
              return (
                <button
                  key={char.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => setHighlighted(char.id)}
                  style={cardStyle(isSelected)}
                  title={char.name}
                >
                  <span style={cardIcon}>&#128100;</span>
                  <span style={cardName}>{char.name}</span>
                  <span style={cardCat}>{char.category}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const FONT = FONT_FAMILY;
const BG = '#08080f';
const PANEL_BG = '#12121e';
const BORDER = '#2a2a40';
const TEXT_PRIMARY = '#e8e8f0';
const TEXT_SECONDARY = '#8888a0';

const pageStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: BG,
  fontFamily: FONT,
  color: TEXT_PRIMARY,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const header = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: m ? '12px 16px' : '16px 24px',
  borderBottom: `1px solid ${BORDER}`,
  flexShrink: 0,
  background: PANEL_BG,
});

const backBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: GOLD,
  fontSize: 28,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '4px 10px',
  borderRadius: 8,
  fontFamily: FONT,
};

const titleStyle = (m: boolean): React.CSSProperties => ({
  fontFamily: FONT,
  fontWeight: 800,
  fontSize: m ? 18 : 22,
  color: GOLD,
  margin: 0,
  letterSpacing: '0.02em',
});

const body = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: m ? 'column' : 'row',
  flex: 1,
  minHeight: 0,
  overflow: m ? 'auto' : 'hidden',
});

const previewCol = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  padding: m ? '16px 16px 8px' : '20px 24px',
  borderRight: m ? 'none' : `1px solid ${BORDER}`,
  borderBottom: m ? `1px solid ${BORDER}` : 'none',
  flexShrink: 0,
  width: m ? '100%' : 260,
  boxSizing: 'border-box',
});

const canvasWrap = (m: boolean): React.CSSProperties => ({
  width: m ? 200 : 220,
  height: m ? 200 : 260,
  borderRadius: 16,
  overflow: 'hidden',
  background: '#1a1a2e',
  border: `1px solid ${BORDER}`,
  flexShrink: 0,
});

const previewFallback: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: TEXT_SECONDARY,
  fontFamily: FONT,
  fontSize: 14,
};

const charNameBadge: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 15,
  color: GOLD_BRIGHT,
  textAlign: 'center',
  padding: '4px 12px',
  background: 'rgba(212,175,55,0.12)',
  borderRadius: 8,
  border: `1px solid rgba(212,175,55,0.3)`,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const swatchRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'center',
  maxWidth: 220,
};

const swatchStyle = (selected: boolean, hex: string): React.CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: hex,
  border: selected ? `3px solid ${GOLD}` : '3px solid rgba(255,255,255,0.2)',
  cursor: 'pointer',
  padding: 0,
  boxShadow: selected ? `0 0 0 2px rgba(212,175,55,0.4)` : 'none',
  transform: selected ? 'scale(1.15)' : 'scale(1)',
  transition: 'transform 0.12s ease',
});

const previewActions = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  gap: 10,
  width: '100%',
  flexDirection: m ? 'row' : 'column',
  justifyContent: 'center',
});

const pickerCol = (m: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  padding: m ? '12px 16px' : '16px 20px',
  gap: 12,
  overflow: 'hidden',
});

const searchInput: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 600,
  color: TEXT_PRIMARY,
  background: PANEL_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '9px 14px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  flexShrink: 0,
};

const tabsRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: active ? 800 : 600,
  padding: '5px 10px',
  borderRadius: 8,
  border: active ? `1px solid ${GOLD}` : `1px solid ${BORDER}`,
  background: active ? 'rgba(212,175,55,0.18)' : PANEL_BG,
  color: active ? GOLD : TEXT_SECONDARY,
  cursor: 'pointer',
  transition: 'background 0.1s ease, color 0.1s ease',
  whiteSpace: 'nowrap',
});

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
  gap: 8,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
  paddingBottom: 8,
};

const emptyMsg: React.CSSProperties = {
  gridColumn: '1 / -1',
  color: TEXT_SECONDARY,
  fontFamily: FONT,
  fontSize: 14,
  textAlign: 'center',
  padding: '32px 0',
};

const cardStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '10px 8px 8px',
  borderRadius: 10,
  border: selected ? `2px solid ${GOLD}` : `1px solid ${BORDER}`,
  background: selected ? 'rgba(212,175,55,0.14)' : PANEL_BG,
  cursor: 'pointer',
  boxShadow: selected ? `0 0 0 2px rgba(212,175,55,0.25)` : 'none',
  transition: 'border 0.1s ease, background 0.1s ease',
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 80,
  textAlign: 'center',
});

const cardIcon: React.CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
};

const cardName: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 700,
  color: TEXT_PRIMARY,
  lineHeight: 1.3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  width: '100%',
};

const cardCat: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 600,
  color: TEXT_SECONDARY,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
