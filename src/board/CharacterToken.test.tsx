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
// clip prop drives an animation action, NOT to exercise WebGL/skinning
// (browser-only). The `tint` prop is a no-op (characters render native colors);
// it is still accepted for back-compat, so the tests pass it harmlessly.
import { noop } from '../test-utils';

vi.mock('@react-three/fiber', () => ({ useFrame: noop }));

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
    scene: { traverse: noop },
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
// the per-instance material-clone pass runs without a real Object3D graph.
vi.mock('three/examples/jsm/utils/SkeletonUtils.js', () => ({
  clone: () => ({ traverse: noop }),
}));

// Import AFTER mocks are registered.
import { CharacterToken, type CharacterTokenHandle, pickSkinMaterialNames, pickPrimaryMaterialName } from './CharacterToken';

/* eslint-disable @typescript-eslint/no-deprecated -- this suite deliberately
   exercises the DEPRECATED back-compat surface (the `tint` no-op prop and the
   `pickPrimaryMaterialName` delegate) precisely to guard that they keep working;
   the deprecation warnings here are expected and intentional, not accidents. */

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

  it('drives the reactive `clip` prop (Idle→Walk) without a re-mount', () => {
    // Mount on Idle (default clip prop unset → initialClip 'Idle').
    const { rerender } = render(
      <CharacterToken url="/models/characters/Suit_Male.glb" tint="#3498db" clip="Idle" />,
    );
    expect(idleAction.play).toHaveBeenCalled();
    expect(walkAction.play).not.toHaveBeenCalled();
    // Flipping clip → 'Walk' crossfades to the Walk action (same instance).
    rerender(
      <CharacterToken url="/models/characters/Suit_Male.glb" tint="#3498db" clip="Walk" />,
    );
    expect(walkAction.play).toHaveBeenCalled();
  });

  it('exposes a preload helper', () => {
    expect(typeof CharacterToken.preload).toBe('function');
  });

  it('accepts baseColor prop without throwing (recolor is applied after clone)', () => {
    expect(() =>
      render(<CharacterToken url="/models/characters/Wizard.glb" baseColor="#e53935" />),
    ).not.toThrow();
  });

  it('renders with undefined baseColor (native colors) without throwing', () => {
    expect(() =>
      render(<CharacterToken url="/models/characters/Suit_Male.glb" baseColor={undefined} />),
    ).not.toThrow();
  });
});

// ── pickSkinMaterialNames — flesh material picker ─────────────────────────────
//
// The "Skin Color" feature recolors ONLY the character's FLESH material ("Skin"),
// whose geometry spans the whole body (face flesh + arms + hands). Outfit, hair,
// eyes, and — crucially — the "Face" material (the flat eyes/eyebrows/mouth decal
// panel, NOT flesh) keep their native colors.
//
// VERIFIED against all 52 .glb models via @gltf-transform NodeIO:
//   • "Skin" primitive bbox spans y≈-0.02..3.13 (full body) → flesh, recolored.
//   • "Face" primitive is a ~0.08–0.21-deep flat panel at z≈0.34–0.50, y≈2.44–2.79
//     (in front of the head) carrying the drawn eyes/brows/mouth → NOT recolored.
// Recoloring "Face" was the reported bug (blue eyes/eyebrows).

describe('pickSkinMaterialNames (flesh material picker)', () => {
  it('picks ONLY the flesh "Skin" material — the eyes/brows "Face" decal is excluded', () => {
    // BaseCharacter (Skin + Face) → only Skin recolored; Face (eyes/brows) kept
    expect(pickSkinMaterialNames(['Skin', 'Face'])).toEqual(['Skin']);
    // Suit_Male: only Skin; Black/Belt/Shirt/Details/Face/Hair left alone
    expect(pickSkinMaterialNames(['Skin', 'Black', 'Belt', 'Shirt', 'Details', 'Face', 'Hair'])).toEqual(['Skin']);
    // Ninja_Male: only Skin; Main/Details/Grey/Face left alone
    expect(pickSkinMaterialNames(['Skin', 'Main', 'Details', 'Grey', 'Face'])).toEqual(['Skin']);
    // Wizard: only Skin; Clothes/Belt/Gold/Hat/Hair/Face left alone
    expect(pickSkinMaterialNames(['Skin', 'Clothes', 'Belt', 'Gold', 'Hat', 'Hair', 'Face'])).toEqual(['Skin']);
  });

  it('is case-insensitive — matches SKIN, skin.001; excludes FACE, face_mesh', () => {
    expect(pickSkinMaterialNames(['SKIN', 'FACE', 'SHIRT'])).toEqual(['SKIN']);
    expect(pickSkinMaterialNames(['skin.001', 'face_mesh', 'Clothes'])).toEqual(['skin.001']);
  });

  it('returns Skin regardless of whether a Face material is present', () => {
    // Knight_* variants have Skin but no Face (helmet) → Skin recolored.
    expect(pickSkinMaterialNames(['Skin', 'Armor', 'Hair'])).toEqual(['Skin']);
  });

  it('returns empty array when the model has no flesh material (no recolor)', () => {
    // A fully-armored / non-humanoid model with no Skin material.
    expect(pickSkinMaterialNames(['Armor', 'Armor_Dark', 'Detail', 'Red'])).toEqual([]);
    // A model with ONLY a Face decal (no flesh) → nothing recolored.
    expect(pickSkinMaterialNames(['Face', 'Hair'])).toEqual([]);
    expect(pickSkinMaterialNames([])).toEqual([]);
  });

  it('never includes outfit, accessory, or the Face decal in the result', () => {
    const result = pickSkinMaterialNames(['Skin', 'Shirt', 'Pants', 'Belt', 'Hat', 'Jacket', 'Armor', 'Main', 'Clothes', 'Face', 'Hair']);
    expect(result).toEqual(['Skin']);
    // Outfit + Face + Hair are ALL absent.
    expect(result).not.toContain('Shirt');
    expect(result).not.toContain('Pants');
    expect(result).not.toContain('Armor');
    expect(result).not.toContain('Hair');
    expect(result).not.toContain('Face');
  });

  it('NEVER recolors the Face decal, eyes, eyebrows, hair, or facial-hair — only pure flesh', () => {
    // The "Face" eyes/brows/mouth decal is excluded even alongside flesh.
    expect(pickSkinMaterialNames(['Face', 'Skin'])).toEqual(['Skin']);
    expect(pickSkinMaterialNames(['Eyebrow', 'Face', 'Skin'])).toEqual(['Skin']);
    // A material that matches "skin" but also an exclude token stays excluded.
    expect(pickSkinMaterialNames(['FaceSkin', 'Skin', 'Face'])).toEqual(['Skin']);
    expect(pickSkinMaterialNames(['Eye_L', 'Eye_R', 'Skin'])).toEqual(['Skin']);

    // All exclude tokens individually (case-insensitive) must return [].
    const excludedMaterials = [
      // The face-feature decal panel.
      'Face', 'FACE',
      // Eyes & ocular
      'Eye', 'EYES', 'Eyebrow', 'Brow_L', 'Lash', 'Pupil', 'Iris', 'Sclera', 'Lens',
      // Hair & facial hair
      'Hair', 'Beard', 'Mustache', 'Moustache', 'Stubble', 'Goatee', 'Sideburn', 'Whisker', 'FacialHair',
      // Other facial features / accessories
      'Teeth', 'Tooth', 'Mouth', 'Lip', 'Tongue', 'Nose', 'Ear', 'Nail', 'Glasses', 'Mask',
    ];
    for (const mat of excludedMaterials) {
      expect(pickSkinMaterialNames([mat]), `expected "${mat}" to be excluded`).toEqual([]);
    }

    // Skin is STILL recolored (only flesh changes).
    expect(pickSkinMaterialNames(['Skin', 'Face'])).toEqual(['Skin']);

    // Full humanoid material list — only Skin survives; Face (eyes/brows) does not.
    const full = [
      'Skin', 'Face', 'Eye_L', 'Eye_R', 'Eyebrow', 'Beard', 'Hair',
      'Shirt', 'Pants', 'Belt', 'Hat', 'Glasses',
    ];
    expect(pickSkinMaterialNames(full)).toEqual(['Skin']);
  });

  it('preserves order of appearance for multiple flesh materials', () => {
    // Only Skin-like names survive; order is preserved among them.
    expect(pickSkinMaterialNames(['Face', 'Clothes', 'Skin'])).toEqual(['Skin']);
    expect(pickSkinMaterialNames(['Skin_Body', 'Clothes', 'Skin_Head'])).toEqual(['Skin_Body', 'Skin_Head']);
  });
});

// ── pickPrimaryMaterialName (deprecated back-compat) ──────────────────────────

describe('pickPrimaryMaterialName (deprecated — delegates to pickSkinMaterialNames)', () => {
  it('returns the first flesh material or null (Face is not flesh)', () => {
    expect(pickPrimaryMaterialName(['Skin', 'Face', 'Shirt'])).toBe('Skin');
    // Face alone is the eyes/brows decal, not flesh → null.
    expect(pickPrimaryMaterialName(['Face', 'Clothes'])).toBe(null);
    expect(pickPrimaryMaterialName(['Shirt', 'Pants'])).toBe(null);
    expect(pickPrimaryMaterialName([])).toBe(null);
  });
});
