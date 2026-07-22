import { create } from 'zustand';
import type { GameState, Player } from '../types/GameState';
import type { ToastMessage, ToastType } from '../types/ui';

const RECONNECT_KEY = 'mockopoly_reconnect';

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

  // ── actions ──
  update: (state: GameState) => void;
  setMyPlayerId: (id: string) => void;
  setRoomCode: (code: string) => void;
  setReconnectToken: (token: string) => void;
  clearReconnectToken: () => void;
  addToast: (message: string, type?: ToastType) => void;
  selectProperty: (index: number | null) => void;
  toggleTradePanel: (show?: boolean) => void;
  togglePartnershipPanel: (show?: boolean) => void;
  toggleDealPanel: (show?: boolean) => void;
  reset: () => void;
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

  selectProperty: (index) =>
    set({ selectedPropertyIndex: index, showPropertyCard: index !== null }),
  toggleTradePanel: (show) =>
    set((s) => ({ showTradePanel: show ?? !s.showTradePanel })),
  togglePartnershipPanel: (show) =>
    set((s) => ({ showPartnershipPanel: show ?? !s.showPartnershipPanel })),
  toggleDealPanel: (show) =>
    set((s) => ({ showDealPanel: show ?? !s.showDealPanel })),

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
