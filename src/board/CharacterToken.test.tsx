import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import {
  CHARACTERS,
  CHARACTER_CATEGORIES,
  DEFAULT_CHARACTER,
  CHARACTER_BY_ID,
  resolveCharacter,
} from '../constants/characters';

// R3F intrinsic elements (<group>, <primitive>) are unknown to jsdom's DOM
// renderer, so stub them to plain divs. We render outside a real <Canvas> — the
// point of this test is that CharacterToken's module imports resolve and its
// clip/tint props are accepted, NOT to exercise WebGL/skinning (browser-only).
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));

// Fake useGLTF/useAnimations so the component mounts without fetching a .glb or
// spinning up an AnimationMixer. useAnimations returns a controllable `actions`
// map; each action records the calls CharacterToken.play() makes on it so we can
// assert a clip prop actually drives an animation action.
const makeAction = () => {
  const a = {
    reset: vi.fn(() => a),
    setLoop: vi.fn(() => a),
    fadeIn: vi.fn(() => a),
    crossFadeFrom: vi.fn(() => a),
    setEffectiveWeight: vi.fn(() => a),
    play: vi.fn(() => a),
    clampWhenFinished: false,
    enabled: false,
  };
  return a;
};
const idleAction = makeAction();
const walkAction = makeAction();

vi.mock('@react-three/drei', () => {
  const useGLTF = () => ({
    scene: { traverse: (_fn: (o: unknown) => void) => {} },
    animations: [],
  });
  useGLTF.preload = vi.fn();
  return {
    useGLTF,
    useAnimations: () => ({
      actions: { Idle: idleAction, Walk: walkAction },
      mixer: {},
    }),
  };
});

// SkeletonUtils.clone: return a minimal cloned "scene" with a no-op traverse so
// the tint pass runs without a real Object3D graph.
vi.mock('three/examples/jsm/utils/SkeletonUtils.js', () => ({
  clone: () => ({ traverse: (_fn: (o: unknown) => void) => {} }),
}));

// Import AFTER mocks are registered.
import { CharacterToken, type CharacterTokenHandle } from './CharacterToken';

describe('CHARACTERS catalog', () => {
  it('has 52 entries with unique ids and well-formed urls', () => {
    expect(CHARACTERS).toHaveLength(52);
    const ids = new Set(CHARACTERS.map((c) => c.id));
    expect(ids.size).toBe(52);
    for (const c of CHARACTERS) {
      expect(c.url).toBe(`/models/characters/${c.id}.glb`);
      expect(c.name.length).toBeGreaterThan(0);
      expect(CHARACTER_CATEGORIES).toContain(c.category);
    }
  });

  it('assigns every character to a known category and covers expected buckets', () => {
    const cats = new Set(CHARACTERS.map((c) => c.category));
    // Spot-check the buckets the task called out are populated.
    for (const expected of ['Fantasy', 'Ninja', 'Animal', 'Suit', 'Casual', 'Pirate']) {
      expect(cats).toContain(expected);
    }
    // Animal bucket = the non-humanoids ONLY (Cow, Pug) — must NOT swallow the
    // Cowboy_* humans (the "cow" substring trap).
    const animals = CHARACTERS.filter((c) => c.category === 'Animal').map((c) => c.id);
    expect(animals.sort()).toEqual(['Cow', 'Pug']);
    // Cowboy_* humans go in the Cowboy bucket.
    const cowboys = CHARACTERS.filter((c) => c.category === 'Cowboy').map((c) => c.id);
    expect(cowboys).toEqual(
      expect.arrayContaining(['Cowboy_Male', 'Cowboy_Female', 'Cowboy_Hair']),
    );
    // Every category bucket that exists is non-empty and every char is covered.
    const covered = CHARACTERS.filter((c) => CHARACTER_CATEGORIES.includes(c.category));
    expect(covered).toHaveLength(52);
    // Fantasy bucket per the task spec.
    const fantasy = CHARACTERS.filter((c) => c.category === 'Fantasy').map((c) => c.id);
    expect(fantasy).toEqual(
      expect.arrayContaining(['Wizard', 'Witch', 'Elf', 'Goblin_Male', 'Knight_Male']),
    );
  });

  it('exposes a valid default character and resolver', () => {
    expect(CHARACTER_BY_ID[DEFAULT_CHARACTER]).toBeDefined();
    expect(resolveCharacter(undefined).id).toBe(DEFAULT_CHARACTER);
    expect(resolveCharacter('not-a-real-id').id).toBe(DEFAULT_CHARACTER);
    expect(resolveCharacter('Wizard').id).toBe('Wizard');
  });
});

describe('CharacterToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idleAction.enabled = false;
    walkAction.enabled = false;
  });

  it('mounts with url/tint props and starts on the initial (Idle) clip', () => {
    expect(() =>
      render(<CharacterToken url="/models/characters/Wizard.glb" tint="#e74c3c" />),
    ).not.toThrow();
    // initialClip defaults to 'Idle' → the Idle action is played on mount.
    expect(idleAction.play).toHaveBeenCalled();
  });

  it('accepts scale + initialClip props and plays the requested clip', () => {
    render(
      <CharacterToken
        url="/models/characters/Suit_Male.glb"
        tint="#3498db"
        scale={0.3}
        initialClip="Walk"
      />,
    );
    expect(walkAction.play).toHaveBeenCalled();
    expect(idleAction.play).not.toHaveBeenCalled();
  });

  it('exposes an imperative play() handle for switching clips', () => {
    const ref = createRef<CharacterTokenHandle>();
    render(<CharacterToken ref={ref} url="/models/characters/Ninja_Male.glb" tint="#2ecc71" />);
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.play).toBe('function');
    ref.current?.play('Walk');
    expect(walkAction.play).toHaveBeenCalled();
  });

  it('exposes a preload helper', () => {
    expect(typeof CharacterToken.preload).toBe('function');
  });
});
