import { create } from 'zustand';
import type { GameState, Player, TokenType } from '../types/GameState';
import type { ToastMessage, ToastType } from '../types/ui';
import type { S_GameOver } from '../types/SocketEvents';
import { DEFAULT_CHARACTER } from '../constants/characters';

const RECONNECT_KEY = 'mockopoly_reconnect';
const CHARACTER_KEY = 'mockopoly_character';
const CHARACTER_COLOR_KEY = 'mockopoly_character_color';
const TOKEN_KEY = 'mockopoly_token';

const DEFAULT_TOKEN: TokenType = 'red';
const VALID_TOKENS: readonly TokenType[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'cyan',
  'pink',
];

export type Screen = 'menu' | 'lobby' | 'game' | 'game-over';

interface GameStore {
  // ── durable mirror of server state (was LocalGameState) ──
  state: GameState | null;
  myPlayerId: string | null;
  roomCode: string | null;
  reconnectToken: string | null;

  // ── client-only UI state (was UIState) ──
  toasts: ToastMessage[];
  selectedPropertyIndex: number | null;
  showPropertyCard: boolean;
  showTradePanel: boolean;
  showPartnershipPanel: boolean;
  showDealPanel: boolean;
  showDevHacks: boolean;
  screen: Screen;
  gameOver: S_GameOver | null;

  // ── read-only deed-card inspect (board tile click) ──
  // Separate from selectedPropertyIndex/showPropertyCard which drive MortgagePanel.
  deedCardIndex: number | null;

  // ── character + token color selection (persisted) ──
  selectedCharacter: string;
  setSelectedCharacter: (id: string) => void;
  /** Hex color for the primary outfit material of the selected skin (null = native skin color). */
  selectedCharacterColor: string | null;
  setSelectedCharacterColor: (hex: string | null) => void;
  /** Player board-identity color (the base puck under the token). */
  selectedToken: TokenType;
  setSelectedToken: (token: TokenType) => void;

  // ── actions ──
  update: (state: GameState) => void;
  setMyPlayerId: (id: string) => void;
  setRoomCode: (code: string) => void;
  setReconnectToken: (token: string) => void;
  clearReconnectToken: () => void;
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (timestamp: number) => void;
  selectProperty: (index: number | null) => void;
  openDeedCard: (index: number) => void;
  closeDeedCard: () => void;
  toggleTradePanel: (show?: boolean) => void;
  togglePartnershipPanel: (show?: boolean) => void;
  toggleDealPanel: (show?: boolean) => void;
  toggleDevHacks: (show?: boolean) => void;
  setScreen: (screen: Screen) => void;
  setGameOver: (gameOver: S_GameOver | null) => void;
  reset: () => void;
}

function getStoredCharacter(): string {
  try { return localStorage.getItem(CHARACTER_KEY) || DEFAULT_CHARACTER; } catch { return DEFAULT_CHARACTER; }
}

function getStoredCharacterColor(): string | null {
  try { return localStorage.getItem(CHARACTER_COLOR_KEY) || null; } catch { return null; }
}

function getStoredToken(): TokenType {
  try {
    const t = localStorage.getItem(TOKEN_KEY) as TokenType | null;
    return t && VALID_TOKENS.includes(t) ? t : DEFAULT_TOKEN;
  } catch {
    return DEFAULT_TOKEN;
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  myPlayerId: null,
  roomCode: null,
  reconnectToken: null,
  toasts: [],
  selectedPropertyIndex: null,
  showPropertyCard: false,
  showTradePanel: false,
  showPartnershipPanel: false,
  showDealPanel: false,
  showDevHacks: false,
  screen: 'menu',
  gameOver: null,
  deedCardIndex: null,
  selectedCharacter: getStoredCharacter(),
  selectedCharacterColor: getStoredCharacterColor(),
  selectedToken: getStoredToken(),

  setSelectedCharacter: (id) => {
    set({ selectedCharacter: id });
    try { localStorage.setItem(CHARACTER_KEY, id); } catch { /* ignore */ }
  },
  setSelectedCharacterColor: (hex) => {
    set({ selectedCharacterColor: hex });
    try {
      if (hex === null) {
        localStorage.removeItem(CHARACTER_COLOR_KEY);
      } else {
        localStorage.setItem(CHARACTER_COLOR_KEY, hex);
      }
    } catch { /* ignore */ }
  },
  setSelectedToken: (token) => {
    set({ selectedToken: token });
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  },

  update: (state) => set({ state }),
  setMyPlayerId: (id) => set({ myPlayerId: id }),
  setRoomCode: (code) => set({ roomCode: code }),

  setReconnectToken: (token) => {
    set({ reconnectToken: token });
    try { localStorage.setItem(RECONNECT_KEY, token); } catch { /* ignore */ }
  },
  clearReconnectToken: () => {
    set({ reconnectToken: null });
    try { localStorage.removeItem(RECONNECT_KEY); } catch { /* ignore */ }
  },

  addToast: (message, type = 'info') =>
    set((s) => ({ toasts: [...s.toasts, { message, type, timestamp: Date.now() }] })),

  removeToast: (timestamp) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.timestamp !== timestamp) })),

  selectProperty: (index) =>
    set({ selectedPropertyIndex: index, showPropertyCard: index !== null }),
  openDeedCard: (index) => set({ deedCardIndex: index }),
  closeDeedCard: () => set({ deedCardIndex: null }),
  toggleTradePanel: (show) =>
    set((s) => ({ showTradePanel: show ?? !s.showTradePanel })),
  togglePartnershipPanel: (show) =>
    set((s) => ({ showPartnershipPanel: show ?? !s.showPartnershipPanel })),
  toggleDealPanel: (show) =>
    set((s) => ({ showDealPanel: show ?? !s.showDealPanel })),
  toggleDevHacks: (show) =>
    set((s) => ({ showDevHacks: show ?? !s.showDevHacks })),
  setScreen: (screen) => set({ screen }),
  setGameOver: (gameOver) => set({ gameOver }),

  reset: () => {
    get().clearReconnectToken();
    set({
      state: null,
      myPlayerId: null,
      roomCode: null,
      toasts: [],
      selectedPropertyIndex: null,
      showPropertyCard: false,
      showTradePanel: false,
      showPartnershipPanel: false,
      showDealPanel: false,
      showDevHacks: false,
      screen: 'menu',
      gameOver: null,
      deedCardIndex: null,
    });
  },
}));

// ── selector helpers (derived reads; use with useGameStore(selectX)) ──
export function selectMyPlayer(s: GameStore): Player | undefined {
  if (!s.state || !s.myPlayerId) return undefined;
  return s.state.players.find((p) => p.id === s.myPlayerId);
}
export function selectCurrentPlayer(s: GameStore): Player | undefined {
  if (!s.state) return undefined;
  return s.state.players.find((p) => p.id === s.state!.turn.currentPlayerId);
}
export function selectIsMyTurn(s: GameStore): boolean {
  if (!s.state || !s.myPlayerId) return false;
  return s.state.turn.currentPlayerId === s.myPlayerId;
}

export function getStoredReconnectToken(): string | null {
  try { return localStorage.getItem(RECONNECT_KEY); } catch { return null; }
}
