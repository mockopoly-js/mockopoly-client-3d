import EventEmitter from 'eventemitter3';

// Transient client-side event bus. Replaces the Phaser EventEmitter that
// LocalGameState used to broadcast one-shot animation/UI triggers.
// Durable state lives in gameStore; ephemeral "something just happened"
// signals live here so React components can subscribe imperatively.
export const gameBus = new EventEmitter();
