import { describe, it, expect } from 'vitest';
import { EVENTS } from './SocketEvents';

describe('wire contract', () => {
  it('exposes the core state-sync event', () => {
    expect(EVENTS.GAME_STATE_UPDATE).toBeTruthy();
  });
  it('exposes the connection ack event', () => {
    expect(EVENTS.CONNECT_ACK).toBeTruthy();
  });
  it('exposes turn animation events consumed by the client', () => {
    expect(EVENTS.TURN_DICE_ROLLED).toBeTruthy();
    expect(EVENTS.TURN_PLAYER_MOVED).toBeTruthy();
    expect(EVENTS.TURN_LANDED).toBeTruthy();
  });
});
