import { describe, it, expect } from 'vitest';
import { EVENTS } from './SocketEvents';
import type { C_RoomCreate, C_RoomJoin } from './SocketEvents';
import type { Player } from './GameState';

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

  // CT2 — character field must be present (optional) on both create/join payloads
  // and on the Player interface. These are compile-time checks; they pass if TS
  // allows assigning the character field without error.
  it('C_RoomCreate accepts an optional character field', () => {
    const payload: C_RoomCreate = { playerName: 'Maya', token: 'red', character: 'Suit_Male' };
    expect(payload.character).toBe('Suit_Male');
  });
  it('C_RoomJoin accepts an optional character field', () => {
    const payload: C_RoomJoin = { roomCode: 'ABC', playerName: 'Maya', token: 'red', character: 'Wizard' };
    expect(payload.character).toBe('Wizard');
  });
  it('Player interface has an optional character field', () => {
    const p: Partial<Player> = { character: 'Ninja_Male' };
    expect(p.character).toBe('Ninja_Male');
  });
});
