import { describe, it, expect } from 'vitest';
import { socketManager } from './SocketManager';

describe('socketManager', () => {
  it('is a singleton with a socket API', () => {
    expect(typeof socketManager.connect).toBe('function');
    expect(typeof socketManager.on).toBe('function');
    expect(typeof socketManager.emit).toBe('function');
  });
  it('reports disconnected before connect()', () => {
    expect(socketManager.connected).toBe(false);
    expect(socketManager.playerId).toBe(null);
  });
});
