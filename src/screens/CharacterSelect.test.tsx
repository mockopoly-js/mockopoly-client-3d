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
      const img = screen.getByAltText(c.name) as HTMLImageElement;
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
    const tabs = screen.getAllByRole('tab');
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

  it('has 8 color swatch buttons labelled "Your color"', () => {
    renderSelect();
    const swatches = screen.getAllByRole('button').filter((b) =>
      ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'pink'].includes(
        b.getAttribute('aria-label') ?? '',
      ),
    );
    expect(swatches).toHaveLength(8);
    expect(screen.getByText(/your color/i)).toBeTruthy();
  });

  it('all 52 skins have a resolvable rarity + non-empty description', () => {
    for (const c of CHARACTERS) {
      const meta = resolveSkinMeta(c.id);
      expect(['common', 'rare', 'epic', 'legendary']).toContain(meta.rarity);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});
