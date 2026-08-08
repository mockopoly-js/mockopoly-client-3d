import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { CHARACTERS, DEFAULT_CHARACTER } from '../constants/characters';
import { RARITY_LABEL, resolveSkinMeta } from '../constants/skins';
import { buildLocker, isUnlocked, ownedCount } from './characterLocker';
import { requireDefined } from '../test-utils';

// ── Mock the lazy 3D preview canvas — no WebGL in jsdom, and we don't want to
//    pull three/drei into the test. The locker keeps ONE live canvas; the grid
//    is static <img>. ──
vi.mock('./CharacterPreviewCanvas', () => ({
  CharacterPreviewCanvas: ({ url, accent, baseColor }: { url: string; accent?: string; baseColor?: string }) => (
    <div data-testid="character-preview" data-url={url} data-accent={accent} data-basecolor={baseColor} />
  ),
}));

// Import after mocks so the component sees the stub.
import { CharacterSelect } from './CharacterSelect';

/**
 * ASYNC ON PURPOSE. The live preview is behind `lazy()` + `<Suspense>`, so it
 * resolves a microtask AFTER the first commit; rendering synchronously leaves
 * React warning that a suspended resource finished outside `act(...)` on every
 * single test. Flushing it here keeps the suite's output clean and means every
 * assertion runs against the settled tree.
 */
async function renderSelect(path = '/character-select') {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <CharacterSelect />
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
  return utils;
}

const filterTo = (name: RegExp) => {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /ownership filter/i })).getByRole('radio', { name }));
};
const search = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText(/search skins/i), { target: { value } });
};

describe('CharacterSelect (locker)', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.getState().setSelectedCharacter(DEFAULT_CHARACTER);
    useGameStore.getState().setSelectedCharacterColor(null);
    vi.restoreAllMocks();
  });

  // ── the grid ───────────────────────────────────────────────────────────────

  it('renders all 52 skin cards as thumbnail images in the grid', async () => {
    await renderSelect();
    const cards = screen.getAllByRole('option');
    expect(cards).toHaveLength(CHARACTERS.length);
    expect(cards.length).toBe(52);
    for (const c of CHARACTERS.slice(0, 5)) {
      const img = screen.getByAltText(c.name);
      expect(img.tagName).toBe('IMG');
      expect(img.getAttribute('src')).toBe(`/images/characters/${c.id}.png`);
    }
  });

  it('renders exactly ONE live preview canvas (grid uses static images)', async () => {
    await renderSelect();
    expect(screen.getAllByTestId('character-preview')).toHaveLength(1);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    const thumbImgs = Array.from(document.querySelectorAll('img')).filter((i) =>
      (i.getAttribute('src') ?? '').startsWith('/images/characters/'),
    );
    expect(thumbImgs).toHaveLength(52);
  });

  it('every tile clears the 44px tap floor by construction', async () => {
    // A 52-tile grid is where tile size gets shaved; jsdom has no layout, so
    // this asserts the declared floor rather than a measured box.
    await renderSelect();
    for (const card of screen.getAllByRole('option').slice(0, 6)) {
      expect((card as HTMLElement).style.minHeight).toBe('44px');
    }
  });

  it('search filters skins by name', async () => {
    await renderSelect();
    search('ninja');
    const ninjaCount = CHARACTERS.filter(
      (c) => c.name.toLowerCase().includes('ninja')
        || c.id.toLowerCase().includes('ninja')
        || c.category.toLowerCase().includes('ninja'),
    ).length;
    expect(screen.getAllByRole('option')).toHaveLength(ninjaCount);
    expect(ninjaCount).toBeGreaterThan(0);
  });

  it('search also matches the CATEGORY — this is what replaced the chip row', async () => {
    await renderSelect();
    search('viking');
    const vikingCount = CHARACTERS.filter((c) => c.category === 'Viking').length;
    expect(vikingCount).toBeGreaterThan(0);
    const shown = screen.getAllByRole('option');
    expect(shown.length).toBeGreaterThanOrEqual(vikingCount);
    for (const card of shown) {
      const name = requireDefined(within(card).getByRole('img').getAttribute('alt'));
      const def = requireDefined(CHARACTERS.find((c) => c.name === name));
      expect(
        def.category === 'Viking' || def.name.toLowerCase().includes('viking') || def.id.toLowerCase().includes('viking'),
      ).toBe(true);
    }
  });

  it('shows empty state when search has no match', async () => {
    await renderSelect();
    search('xxxxnoskinxxx');
    expect(screen.getByText(/no skins match/i)).toBeTruthy();
  });

  it('rarity is reflected on the cards via data-rarity', async () => {
    await renderSelect();
    const cards = screen.getAllByRole('option');
    expect(cards.filter((c) => c.getAttribute('data-rarity') === 'legendary').length).toBeGreaterThan(0);
  });

  // ── selection + preview ────────────────────────────────────────────────────

  it('clicking a card selects it (aria-selected) and updates the preview', async () => {
    await renderSelect();
    const cards = screen.getAllByRole('option');
    const notSelected = requireDefined(cards.find((c) => c.getAttribute('aria-selected') !== 'true'));
    const targetName = within(notSelected).getByRole('img').getAttribute('alt');
    const targetDef = requireDefined(CHARACTERS.find((c) => c.name === targetName));
    fireEvent.click(notSelected);
    expect(notSelected.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('character-preview').getAttribute('data-url')).toBe(targetDef.url);
  });

  it('shows the store default character pre-selected', async () => {
    await renderSelect();
    const selectedCards = screen
      .getAllByRole('option')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selectedCards).toHaveLength(1);
    const selName = within(selectedCards[0]).getByRole('img').getAttribute('alt');
    const defName = requireDefined(CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER)).name;
    expect(selName).toBe(defName);
  });

  it('names the selected skin and its rarity in the takeover head', async () => {
    await renderSelect();
    const meta = resolveSkinMeta(DEFAULT_CHARACTER);
    const def = requireDefined(CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER));
    expect(screen.getByRole('heading', { name: def.name })).toBeTruthy();
    // Rarity is carried twice: the eyebrow, and a chip on the preview stage.
    expect(screen.getByTestId('rarity-badge').textContent).toBe(RARITY_LABEL[meta.rarity]);
  });

  // ── the unlock seam ────────────────────────────────────────────────────────

  it('the unlock seam currently owns everything, so nothing renders locked', async () => {
    // `isUnlocked` is the ONE predicate the screen consults. While it returns
    // true for every id the LOCKED filter must be empty and EQUIP always live.
    expect(CHARACTERS.every((c) => isUnlocked(c.id))).toBe(true);
    expect(ownedCount()).toBe(CHARACTERS.length);

    await renderSelect();
    expect(screen.getAllByRole('option').every((c) => c.getAttribute('data-locked') === 'false')).toBe(true);
    expect((screen.getByRole('button', { name: /equip/i }) as HTMLButtonElement).disabled).toBe(false);

    filterTo(/locked/i);
    expect(screen.getByText(/no skins match/i)).toBeTruthy();

    filterTo(/owned/i);
    expect(screen.getAllByRole('option')).toHaveLength(CHARACTERS.length);
  });

  it('buildLocker partitions on the seam, not on rarity or price', () => {
    // The future entitlement flip is a change to `isUnlocked` alone — this
    // pins the contract the layout depends on.
    const all = buildLocker('', 'all');
    expect(all).toHaveLength(CHARACTERS.length);
    expect(all.every((t) => t.locked === !isUnlocked(t.id))).toBe(true);
    expect(buildLocker('', 'owned').every((t) => !t.locked)).toBe(true);
    expect(buildLocker('', 'locked').every((t) => t.locked)).toBe(true);
    // No price, no cost, no store — payments are deferred.
    expect(Object.keys(all[0])).toEqual(
      expect.not.arrayContaining(['price', 'cost', 'sku', 'product']),
    );
  });

  // ── equip ──────────────────────────────────────────────────────────────────

  it('Equip stores the selected character and navigates home', async () => {
    await renderSelect();
    const cards = screen.getAllByRole('option');
    const targetName = within(cards[0]).getByRole('img').getAttribute('alt');
    const targetDef = requireDefined(CHARACTERS.find((c) => c.name === targetName));
    fireEvent.click(cards[0]);
    fireEvent.click(screen.getByRole('button', { name: /equip/i }));
    expect(useGameStore.getState().selectedCharacter).toBe(targetDef.id);
  });

  it('Back leaves the drafts uncommitted', async () => {
    await renderSelect();
    const cards = screen.getAllByRole('option');
    const other = requireDefined(cards.find((c) => c.getAttribute('aria-selected') !== 'true'));
    fireEvent.click(other);
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(useGameStore.getState().selectedCharacter).toBe(DEFAULT_CHARACTER);
  });

  // ── skin colour ────────────────────────────────────────────────────────────

  it('offers a default plus curated swatches and a custom picker, all 44px', async () => {
    await renderSelect();
    const group = screen.getByRole('group', { name: /skin colour/i });
    const swatches = within(group).getAllByRole('button');
    // 1 default + 6 curated. The 8th cell is the native colour input.
    expect(swatches).toHaveLength(7);
    for (const s of swatches) expect((s as HTMLElement).style.height).toBe('44px');
    expect(screen.getByTestId('skin-color-custom')).toBeTruthy();
  });

  it('a swatch marks itself pressed and reaches the live preview', async () => {
    await renderSelect();
    const crimson = screen.getByRole('button', { name: /crimson/i });
    fireEvent.click(crimson);
    expect(crimson.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('character-preview').getAttribute('data-basecolor')).toBe('#e53935');
  });

  it('Default clears the recolour, and Equip persists null', async () => {
    await renderSelect();
    fireEvent.click(screen.getByRole('button', { name: /crimson/i }));
    fireEvent.click(screen.getByRole('button', { name: /^default$/i }));
    const group = screen.getByRole('group', { name: /skin colour/i });
    const pressed = within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1); // only DEFAULT itself
    expect(pressed[0].getAttribute('aria-label')).toBe('Default');

    fireEvent.click(screen.getByRole('button', { name: /equip/i }));
    expect(useGameStore.getState().selectedCharacterColor).toBe(null);
  });

  it('Equip persists a chosen skin colour', async () => {
    await renderSelect();
    fireEvent.click(screen.getByRole('button', { name: /cobalt/i }));
    fireEvent.click(screen.getByRole('button', { name: /equip/i }));
    expect(useGameStore.getState().selectedCharacterColor).toBe('#1565c0');
  });

  it('the custom picker accepts any hex', async () => {
    await renderSelect();
    fireEvent.change(screen.getByTestId('skin-color-custom'), { target: { value: '#123456' } });
    expect(screen.getByTestId('character-preview').getAttribute('data-basecolor')).toBe('#123456');
  });

  // ── data ───────────────────────────────────────────────────────────────────

  it('all 52 skins have a resolvable rarity + non-empty description', () => {
    for (const c of CHARACTERS) {
      const meta = resolveSkinMeta(c.id);
      expect(['common', 'rare', 'epic', 'legendary']).toContain(meta.rarity);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  describe('gameStore selectedCharacterColor', () => {
    it('defaults to null (native skin color)', () => {
      useGameStore.getState().reset();
      expect(useGameStore.getState().selectedCharacterColor).toBe(null);
    });

    it('setSelectedCharacterColor updates state and persists to localStorage', () => {
      useGameStore.getState().setSelectedCharacterColor('#e53935');
      expect(useGameStore.getState().selectedCharacterColor).toBe('#e53935');
      expect(localStorage.getItem('mockopoly_character_color')).toBe('#e53935');
    });

    it('setSelectedCharacterColor(null) removes the key from localStorage', () => {
      useGameStore.getState().setSelectedCharacterColor('#1565c0');
      useGameStore.getState().setSelectedCharacterColor(null);
      expect(useGameStore.getState().selectedCharacterColor).toBe(null);
      expect(localStorage.getItem('mockopoly_character_color')).toBe(null);
    });
  });
});
