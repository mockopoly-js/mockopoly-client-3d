import { describe, it, expect, beforeEach } from 'vitest';
import { initAudioOnGesture, playSfx, setMuted, isMuted } from './sfx';
import type { SfxName } from './sfx';

// jsdom has no AudioContext — these tests validate the no-op / guard behaviour.

describe('sfx — jsdom guards (no AudioContext)', () => {
  beforeEach(() => {
    // Ensure muted is reset to false before each test
    setMuted(false);
  });

  it('initAudioOnGesture() does not throw without AudioContext', () => {
    expect(() => initAudioOnGesture()).not.toThrow();
  });

  it('playSfx("roll") does not throw without AudioContext', () => {
    expect(() => playSfx('roll')).not.toThrow();
  });

  it('playSfx("win") does not throw without AudioContext', () => {
    expect(() => playSfx('win')).not.toThrow();
  });

  it('playSfx with an unknown name is a safe no-op (no throw)', () => {
    expect(() => playSfx('nonexistent' as SfxName)).not.toThrow();
  });

  it('all SfxName values do not throw without AudioContext', () => {
    const names: SfxName[] = ['roll', 'hop', 'buy', 'rent', 'jail', 'bankrupt', 'win'];
    for (const name of names) {
      expect(() => playSfx(name)).not.toThrow();
    }
  });
});

describe('sfx — mute state persistence', () => {
  beforeEach(() => {
    setMuted(false);
  });

  it('setMuted(true) makes isMuted() return true', () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
  });

  it('setMuted(false) makes isMuted() return false', () => {
    setMuted(true);
    setMuted(false);
    expect(isMuted()).toBe(false);
  });

  it('mute state is persisted to localStorage', () => {
    setMuted(true);
    expect(localStorage.getItem('mockopoly_muted')).toBe('true');
  });

  it('unmute state is persisted to localStorage', () => {
    setMuted(true);
    setMuted(false);
    expect(localStorage.getItem('mockopoly_muted')).toBe('false');
  });

  it('playSfx does not throw when muted (even without AudioContext)', () => {
    setMuted(true);
    expect(() => playSfx('roll')).not.toThrow();
    expect(() => playSfx('win')).not.toThrow();
  });
});
