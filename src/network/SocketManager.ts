import { io, Socket } from 'socket.io-client';
import { EVENTS } from '../types/SocketEvents';

// ─── Socket.io Client Singleton ──────────────────────────────────────────────

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ?? 'http://localhost:3001';

class SocketManager {
  private socket: Socket | null = null;
  private _playerId: string | null = null;

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  get playerId(): string | null {
    return this._playerId;
  }

  get id(): string | undefined {
    return this.socket?.id;
  }

  connect(): Socket {
    // CRITICAL: return existing socket even if disconnected/reconnecting.
    // Socket.io handles reconnection internally. Creating a new socket
    // would orphan all listeners registered by GameStateSync.
    if (this.socket) return this.socket;

    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      console.log('[socket] Connected:', this.socket!.id);
    });

    this.socket.on(EVENTS.CONNECT_ACK, (data: { playerId: string }) => {
      this._playerId = data.playerId;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[socket] Disconnected:', reason);
    });

    this.socket.on('connect_error', (err) => {
      console.error('[socket] Connection error:', err.message);
    });

    return this.socket;
  }

  getSocket(): Socket {
    if (!this.socket) {
      return this.connect();
    }
    return this.socket;
  }

  emit(event: string, data?: any): void {
    this.getSocket().emit(event, data);
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.getSocket().on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void): void {
    this.getSocket().off(event, callback);
  }

  once(event: string, callback: (...args: any[]) => void): void {
    this.getSocket().once(event, callback);
  }

  setPlayerId(id: string): void {
    this._playerId = id;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this._playerId = null;
  }
}

export const socketManager = new SocketManager();
