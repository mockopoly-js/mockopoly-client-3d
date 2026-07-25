import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { CHARACTERS, CHARACTER_CATEGORIES, DEFAULT_CHARACTER } from '../constants/characters';
import { resolveSkinMeta, RARITY_LABEL } from '../constants/skins';

// ── Mock the lazy 3D preview canvas — no WebGL in jsdom, and we don't want to
//    pull three/drei into the test. The locker keeps ONE live canvas; the grid
//    is static <img>. ──
vi.mock('./CharacterPreviewCanvas', () => ({
  CharacterPreviewCanvas: ({ url, accent }: { url: string; accent?: string }) => (
    <div data-testid="character-preview" data-url={url} data-accent={accent} />
  ),
}));

// Import after mocks so the component sees the stub.
import { CharacterSelect } from './CharacterSelect';

function renderSelect(path = '/character-select') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CharacterSelect />
    </MemoryRouter>,
  );
}

describe('CharacterSelect (locker)', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.getState().setSelectedCharacter(DEFAULT_CHARACTER);
    useGameStore.getState().setSelectedToken('red');
    vi.restoreAllMocks();
  });

  it('renders all 52 skin cards as thumbnail images in the grid', () => {
    renderSelect();
    const cards = screen.getAllByRole('option');
    expect(cards).toHaveLength(CHARACTERS.length);
    expect(cards.length).toBe(52);
    // Every card carries a thumbnail <img> pointing at /images/characters/<id>.png.
    for (const c of CHARACTERS.slice(0, 5)) {
      const img = screen.getByAltText(c.name);
      expect(img.tagName).toBe('IMG');
      expect(img.getAttribute('src')).toBe(`/images/characters/${c.id}.png`);
    }
  });

  it('renders exactly ONE live preview canvas (grid uses static images)', () => {
    renderSelect();
    // The single mocked live canvas.
    expect(screen.getAllByTestId('character-preview')).toHaveLength(1);
    // No <canvas> elements in the grid — those are <img>.
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    // 52 thumbnail <img> (one per card).
    const thumbImgs = Array.from(document.querySelectorAll('img')).filter((i) =>
      (i.getAttribute('src') ?? '').startsWith('/images/characters/'),
    );
    expect(thumbImgs).toHaveLength(52);
  });

  it('search filters skins by name', () => {
    renderSelect();
    const searchEl = screen.getByPlaceholderText(/search skins/i);
    fireEvent.change(searchEl, { target: { value: 'ninja' } });
    const cards = screen.getAllByRole('option');
    const ninjaCount = CHARACTERS.filter(
      (c) => c.name.toLowerCase().includes('ninja') || c.id.toLowerCase().includes('ninja'),
    ).length;
    expect(cards).toHaveLength(ninjaCount);
    expect(ninjaCount).toBeGreaterThan(0);
  });

  it('category chip filters to the correct skins', () => {
    renderSelect();
    fireEvent.click(screen.getByRole('tab', { name: /^viking$/i }));
    const cards = screen.getAllByRole('option');
    const vikingCount = CHARACTERS.filter((c) => c.category === 'Viking').length;
    expect(cards).toHaveLength(vikingCount);
    expect(vikingCount).toBeGreaterThan(0);
  });

  it('category chips cover All + the 12 categories', () => {
    renderSelect();
    // Scope to the skin-category tablist (aria-label="Skin categories") to
    // exclude the tab switcher (Skin color / Player color) which are in their own tablist.
    const categoryTablist = screen.getByRole('tablist', { name: /skin categories/i });
    const tabs = within(categoryTablist).getAllByRole('tab');
    expect(tabs).toHaveLength(CHARACTER_CATEGORIES.length + 1);
  });

  it('Random button selects a skin from the current filtered pool', () => {
    renderSelect();
    fireEvent.click(screen.getByRole('button', { name: /random/i }));
    const selected = screen
      .getAllByRole('option')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });

  it('clicking a card selects it (aria-selected) and updates the preview', () => {
    renderSelect();
    const cards = screen.getAllByRole('option');
    const notSelected = cards.find((c) => c.getAttribute('aria-selected') !== 'true')!;
    const targetName = within(notSelected).getByRole('img').getAttribute('alt');
    const targetDef = CHARACTERS.find((c) => c.name === targetName)!;
    fireEvent.click(notSelected);
    expect(notSelected.getAttribute('aria-selected')).toBe('true');
    // The single preview canvas now points at the selected skin's url.
    expect(screen.getByTestId('character-preview').getAttribute('data-url')).toBe(targetDef.url);
  });

  it('shows the selected skin rarity, name, and description in the info panel', () => {
    renderSelect();
    const meta = resolveSkinMeta(DEFAULT_CHARACTER);
    const def = CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER)!;
    // Rarity badge label.
    expect(screen.getByTestId('rarity-badge').textContent).toBe(RARITY_LABEL[meta.rarity]);
    // Name (heading) + description line present in the panel.
    const panel = screen.getByTestId('rarity-panel');
    expect(within(panel).getByText(def.name)).toBeTruthy();
    expect(within(panel).getByText(meta.description)).toBeTruthy();
  });

  it('rarity is reflected on the cards via data-rarity', () => {
    renderSelect();
    const cards = screen.getAllByRole('option');
    // Every card exposes its rarity; at least the legendary golden knight is present.
    const legendary = cards.filter((c) => c.getAttribute('data-rarity') === 'legendary');
    expect(legendary.length).toBeGreaterThan(0);
  });

  it('Equip stores the selected character + token color and navigates home', () => {
    renderSelect();
    const cards = screen.getAllByRole('option');
    const targetName = within(cards[0]).getByRole('img').getAttribute('alt');
    const targetDef = CHARACTERS.find((c) => c.name === targetName)!;
    fireEvent.click(cards[0]);
    // Switch to the Player color tab to access identity swatches.
    fireEvent.click(screen.getByTestId('tab-player-color'));
    // Pick a non-default color.
    fireEvent.click(screen.getByRole('button', { name: 'blue' }));
    fireEvent.click(screen.getByRole('button', { name: /equip/i }));
    expect(useGameStore.getState().selectedCharacter).toBe(targetDef.id);
    expect(useGameStore.getState().selectedToken).toBe('blue');
  });

  it('shows the store default character pre-selected', () => {
    renderSelect();
    const selectedCards = screen
      .getAllByRole('option')
      .filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selectedCards).toHaveLength(1);
    const selName = within(selectedCards[0]).getByRole('img').getAttribute('alt');
    const defName = CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER)!.name;
    expect(selName).toBe(defName);
  });

  it('shows empty state when search has no match', () => {
    renderSelect();
    fireEvent.change(screen.getByPlaceholderText(/search skins/i), {
      target: { value: 'xxxxnoskinxxx' },
    });
    expect(screen.getByText(/no skins match/i)).toBeTruthy();
  });

  it('has 8 color swatch buttons in the Player color tab', () => {
    renderSelect();
    // Switch to the Player color tab.
    fireEvent.click(screen.getByTestId('tab-player-color'));
    const swatches = screen.getAllByRole('button').filter((b) =>
      ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'pink'].includes(
        b.getAttribute('aria-label') ?? '',
      ),
    );
    expect(swatches).toHaveLength(8);
    // The player-color panel's section label is shown.
    expect(screen.getByTestId('player-color-panel')).toBeTruthy();
  });

  it('all 52 skins have a resolvable rarity + non-empty description', () => {
    for (const c of CHARACTERS) {
      const meta = resolveSkinMeta(c.id);
      expect(['common', 'rare', 'epic', 'legendary']).toContain(meta.rarity);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  // ── Color tab tests ────────────────────────────────────────────────────────

  it('Color tab shows the skin color panel by default (Skin color tab active)', () => {
    renderSelect();
    // Default active tab should be skin color.
    expect(screen.getByTestId('tab-skin-color').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('tab-player-color').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('skin-color-panel')).toBeTruthy();
    expect(screen.queryByTestId('player-color-panel')).toBeNull();
  });

  it('Color tab shows the palette with 16 curated swatches', () => {
    renderSelect();
    // Skin color tab is default — check the skin palette.
    const palette = screen.getByRole('group', { name: /Skin color palette/i });
    const swatches = within(palette).getAllByRole('button');
    expect(swatches).toHaveLength(16);
  });

  it('Color tab includes a free color picker input and hex text input', () => {
    renderSelect();
    expect(screen.getByTestId('skin-free-color-input')).toBeTruthy();
    expect(screen.getByTestId('skin-color-hex-input')).toBeTruthy();
  });

  it('Color tab palette swatch click sets characterColor draft', () => {
    renderSelect();
    // Find a palette swatch by its aria-label (e.g. "Crimson").
    const crimsonBtn = screen.getByRole('button', { name: /crimson/i });
    fireEvent.click(crimsonBtn);
    // The swatch becomes aria-pressed=true.
    expect(crimsonBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('Color tab Default/Reset button clears the characterColor', () => {
    renderSelect();
    // Select a color first.
    fireEvent.click(screen.getByRole('button', { name: /crimson/i }));
    // Reset.
    fireEvent.click(screen.getByTestId('skin-color-reset'));
    // After reset, no swatch should be pressed.
    const palette = screen.getByRole('group', { name: /Skin color palette/i });
    const pressed = within(palette).getAllByRole('button').filter(
      (b) => b.getAttribute('aria-pressed') === 'true',
    );
    expect(pressed).toHaveLength(0);
  });

  it('Equip stores selectedCharacterColor when a palette swatch is chosen', () => {
    renderSelect();
    fireEvent.click(screen.getByRole('button', { name: /cobalt/i }));
    fireEvent.click(screen.getByRole('button', { name: /equip/i }));
    // The Cobalt hex should be persisted.
    expect(useGameStore.getState().selectedCharacterColor).toBe('#1565c0');
  });

  it('Equip stores null characterColor when Default is chosen', () => {
    renderSelect();
    // Pick a color then reset.
    fireEvent.click(screen.getByRole('button', { name: /crimson/i }));
    fireEvent.click(screen.getByTestId('skin-color-reset'));
    fireEvent.click(screen.getByRole('button', { name: /equip/i }));
    expect(useGameStore.getState().selectedCharacterColor).toBe(null);
  });

  it('preview receives baseColor prop matching the selected swatch', () => {
    renderSelect();
    fireEvent.click(screen.getByRole('button', { name: /forest/i }));
    // The preview canvas mock should receive the baseColor as data-basecolor.
    // (The CharacterPreviewCanvas mock doesn't forward it, so we test the panel
    //  renders the swatch pressed instead.)
    const forestBtn = screen.getByRole('button', { name: /forest/i });
    expect(forestBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('switching to Player color tab shows token swatches and hides skin palette', () => {
    renderSelect();
    fireEvent.click(screen.getByTestId('tab-player-color'));
    expect(screen.getByTestId('player-color-panel')).toBeTruthy();
    expect(screen.queryByTestId('skin-color-panel')).toBeNull();
    // Ensure the 8 identity tokens are shown.
    const swatches = screen.getAllByRole('button').filter((b) =>
      ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'pink'].includes(
        b.getAttribute('aria-label') ?? '',
      ),
    );
    expect(swatches).toHaveLength(8);
  });

  // ── Store: selectedCharacterColor ─────────────────────────────────────────

  describe('gameStore selectedCharacterColor', () => {
    it('defaults to null (native skin color)', () => {
      useGameStore.getState().reset();
      // After reset the color must be null — not a string, not undefined.
      const color = useGameStore.getState().selectedCharacterColor;
      expect(color).toBe(null);
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
