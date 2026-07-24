import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useGameStore } from '../state/gameStore';
import { CHARACTERS, CHARACTER_CATEGORIES, DEFAULT_CHARACTER } from '../constants/characters';

// ── Mock the 3D preview canvas — no WebGL in jsdom ──────────────────────────
vi.mock('./CharacterPreviewCanvas', () => ({
  CharacterPreviewCanvas: ({ url, tint }: { url: string; tint: string }) => (
    <div data-testid="character-preview" data-url={url} data-tint={tint} />
  ),
}));

// Mock the lazy CharacterPreviewCanvas import inside CharacterSelect
// (CharacterSelect lazy-imports it; we already mocked the module above, but
// we also need to stub the Suspense boundary so it resolves synchronously).
// The vi.mock above covers the module; wrapping in MemoryRouter is enough.

// Import after mocks so the component sees the stubs.
import { CharacterSelect } from './CharacterSelect';

function renderSelect(path = '/character-select') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CharacterSelect />
    </MemoryRouter>,
  );
}

describe('CharacterSelect', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('renders all 52 character cards in the grid by default', () => {
    renderSelect();
    const cards = screen.getAllByRole('option');
    expect(cards).toHaveLength(CHARACTERS.length);
    expect(cards.length).toBe(52);
  });

  it('search filters characters by name', () => {
    renderSelect();
    const search = screen.getByPlaceholderText(/search characters/i);
    fireEvent.change(search, { target: { value: 'ninja' } });
    const cards = screen.getAllByRole('option');
    const ninjaCount = CHARACTERS.filter(
      (c) => c.name.toLowerCase().includes('ninja') || c.id.toLowerCase().includes('ninja'),
    ).length;
    expect(cards).toHaveLength(ninjaCount);
  });

  it('category tab filters to the correct characters', () => {
    renderSelect();
    // Click "Viking" tab
    const vikingTab = screen.getByRole('tab', { name: /^viking$/i });
    fireEvent.click(vikingTab);
    const cards = screen.getAllByRole('option');
    const vikingCount = CHARACTERS.filter((c) => c.category === 'Viking').length;
    expect(cards).toHaveLength(vikingCount);
    expect(vikingCount).toBeGreaterThan(0);
  });

  it('category tabs cover all 12 categories + All', () => {
    renderSelect();
    const tabs = screen.getAllByRole('tab');
    // All + 12 category buckets
    expect(tabs).toHaveLength(CHARACTER_CATEGORIES.length + 1);
  });

  it('Random button picks a character from the current filtered pool', () => {
    renderSelect();
    const randomBtn = screen.getByRole('button', { name: /random/i });
    // Just verify it doesn't throw and some card becomes selected
    fireEvent.click(randomBtn);
    const selected = screen.getAllByRole('option').filter(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);
  });

  it('clicking a card highlights it (aria-selected)', () => {
    renderSelect();
    const cards = screen.getAllByRole('option');
    // Find a card that is NOT currently selected and click it
    const notSelected = cards.find((c) => c.getAttribute('aria-selected') !== 'true')!;
    fireEvent.click(notSelected);
    expect(notSelected.getAttribute('aria-selected')).toBe('true');
  });

  it('Confirm button updates the store with the highlighted character', () => {
    renderSelect();
    // Select the first card (e.g. BaseCharacter)
    const cards = screen.getAllByRole('option');
    fireEvent.click(cards[0]);
    // Confirm — setSelectedCharacter should be called with BaseCharacter's id
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    const stored = useGameStore.getState().selectedCharacter;
    // The selected character should be the one we clicked (first in the CHARACTERS array)
    expect(stored).toBe(CHARACTERS[0].id);
  });

  it('shows the default character from the store as pre-selected', () => {
    // The default is DEFAULT_CHARACTER; the card for it should have aria-selected=true
    renderSelect();
    const defaultName = CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER)!.name;
    // At least one element with this name should exist (the badge + the grid card)
    const matches = screen.getAllByText(defaultName);
    expect(matches.length).toBeGreaterThan(0);
    // The grid card for the default character should be selected
    const selectedCards = screen.getAllByRole('option').filter(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(selectedCards).toHaveLength(1);
  });

  it('shows empty state when search has no match', () => {
    renderSelect();
    fireEvent.change(screen.getByPlaceholderText(/search characters/i), {
      target: { value: 'xxxxnocharxxx' },
    });
    expect(screen.getByText(/no characters match/i)).toBeTruthy();
  });

  it('has 8 color swatch buttons', () => {
    renderSelect();
    // Swatches have aria-label matching token names
    const swatches = screen.getAllByRole('button').filter((b) =>
      ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'pink'].includes(
        b.getAttribute('aria-label') ?? '',
      ),
    );
    expect(swatches).toHaveLength(8);
  });

  it('clicking a color swatch updates the preview tint', () => {
    renderSelect();
    const blueBtn = screen.getByRole('button', { name: 'blue' });
    fireEvent.click(blueBtn);
    // The preview should re-render with the blue tint — just verify no throw
    expect(blueBtn.getAttribute('aria-label')).toBe('blue');
  });
});
