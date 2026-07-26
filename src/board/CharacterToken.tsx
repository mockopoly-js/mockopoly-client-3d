import { useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { pickSkinMaterialNames } from './skinMaterials';

/**
 * A rigged, animated character usable as a player token (ported from the
 * `spike/characters` proof — see scratchpad/character-spike-report.md). NOT yet
 * wired into PlayerTokens; that integration is CT3.
 *
 * WHY a per-instance clone: `useGLTF(url)` returns a single cached GLTF whose
 * `scene` (and its SkinnedMesh + Skeleton) is SHARED across every consumer of
 * that url. Rendering that shared scene twice would make both instances share
 * one skeleton → they animate in lockstep (same pose) and fight each other.
 * `SkeletonUtils.clone` deep-clones the scene AND rebinds each SkinnedMesh to a
 * fresh Skeleton whose bones are the cloned nodes, so every CharacterToken owns
 * an independent skeleton. drei's `useAnimations(clips, ref)` then spins up a
 * SEPARATE AnimationMixer per instance, bound to that instance's cloned scene,
 * so two tokens with the same url animate fully independently.
 *
 * Animation tracks target bones BY NAME, so the ORIGINAL gltf.animations clips
 * play correctly on the clone (same bone names) — no clip cloning required.
 *
 * COLOR: outfit/accessory materials render with NATIVE authored colors — a Suit
 * stays grey, a Wizard stays purple, etc. Only the character's FLESH material
 * (named "Skin" in the .glb) is recolored when the player picks a skin color via
 * the `baseColor` prop.
 *
 * IMPORTANT — verified against the actual .glb structure (all 52 models share
 * the same Quaternius-style rig, one mesh "Cube.004" split into per-material
 * primitives):
 *   • "Skin"  = the ENTIRE flesh body (head, torso, arms, HANDS, legs). Its
 *     primitive bbox spans the full character height (y≈-0.02 .. 3.13). THIS is
 *     the flesh and the ONLY thing recolored.
 *   • "Face"  = a thin (~0.08–0.21 deep) flat DECAL panel sitting in front of
 *     the head (z≈0.34–0.50, y≈2.44–2.79) that carries the drawn EYES, EYEBROWS
 *     and MOUTH. It is NOT flesh — recoloring it (the old bug) turned the eyes /
 *     brows the skin color. "Face" is therefore EXCLUDED from the recolor and
 *     keeps its authored color.
 * Player identity on the board is shown by the colored base ring under the token
 * (PlayerTokens), NOT by recoloring the outfit. We still clone every material per
 * instance so each token can dispose its own materials on unmount without
 * touching the shared cached gltf. The `tint` prop is retained for API/back-compat
 * but is a no-op.
 */
export type CharacterClip =
  | 'Idle'
  | 'Walk'
  | 'Jump'
  | 'Victory'
  | 'Defeat'
  | 'Run'
  | 'Death'
  | 'SitDown'
  | 'StandUp'
  | 'PickUp'
  | 'RecieveHit';

export interface CharacterTokenHandle {
  play: (clip: CharacterClip, opts?: { loop?: boolean; fade?: number; onFinished?: () => void }) => void;
}

/**
 * Clone a material per instance (so unmount can dispose it without touching the
 * shared cached gltf). Outfit/accessory materials keep their NATIVE authored
 * colors. Only the flesh "Skin" material is recolored via `baseColor`.
 */
function cloneMaterial(mat: THREE.Material): THREE.Material {
  return (mat as THREE.MeshStandardMaterial).clone();
}

/**
 * Apply `baseColor` to the flesh "Skin" material of a cloned scene. Outfit
 * materials (Shirt, Clothes, Main, Jacket, Armor, Hat, Belt, Pants, etc.), the
 * "Face" eyes/eyebrows/mouth decal, hair, and all other accessories are NEVER
 * touched — they keep their original authored colors. Because the "Skin"
 * material's geometry spans the whole body, one recolor reflects the player's
 * chosen skin color uniformly across the face flesh, arms, and hands, while the
 * drawn eyes / eyebrows keep their original color.
 *
 * If the model has no flesh material at all, this is a no-op (native colors are
 * kept as-is).
 */
function applyBaseColor(scene: THREE.Group, baseColor: string): void {
  // Collect all unique material names from the scene.
  const matNames: string[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual meshes have isMesh===true
    if (!mesh.isMesh) return;
    const material: THREE.Material | THREE.Material[] = mesh.material;
    const mats: THREE.Material[] = Array.isArray(material) ? material : [material];
    for (const m of mats) {
      // Skip unnamed materials (empty name); dedupe by name.
      if (m.name && !matNames.includes(m.name)) {
        matNames.push(m.name);
      }
    }
  });

  // Resolve which material names are flesh targets (Skin; Face is excluded).
  const skinNames = pickSkinMaterialNames(matNames);
  if (skinNames.length === 0) return;

  const skinNameSet = new Set(skinNames);
  const color = new THREE.Color(baseColor);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual meshes have isMesh===true
    if (!mesh.isMesh) return;
    const material: THREE.Material | THREE.Material[] = mesh.material;
    const mats: THREE.Material[] = Array.isArray(material) ? material : [material];
    for (const m of mats) {
      if (skinNameSet.has(m.name)) {
        (m as THREE.MeshStandardMaterial).color.set(color);
      }
    }
  });
}

interface CharacterTokenProps {
  url: string;
  /**
   * @deprecated No-op. Characters render with their NATIVE colors; player
   * identity is shown by the colored base ring under the token, not by
   * recoloring the character. Kept only for API/back-compat.
   */
  tint?: string;
  /**
   * Optional hex color for the character's SKIN TONE. When set, the flesh
   * material (name contains "skin", case-insensitive) is recolored to this
   * value — its geometry spans the whole body, so the face flesh, arms, and
   * hands all match. Outfit materials (Shirt, Clothes, Jacket, Armor, Hat, Belt,
   * Pants, etc.), hair, and the "Face" eyes/eyebrows/mouth decal are NEVER
   * touched; they keep their native authored colors (so the drawn eyes / brows
   * stay their original color). When undefined or null the native skin tone is
   * kept unchanged. Recomputed when `baseColor` or the source scene changes.
   */
  baseColor?: string;
  scale?: number;
  /** First clip played on mount (looped). Defaults to 'Idle'. */
  initialClip?: CharacterClip;
  /**
   * Reactive looping clip. When this prop changes the token crossfades to the
   * new clip (e.g. 'Idle' ↔ 'Walk' as a player starts/stops a hop). Optional —
   * omit it and drive clips purely via the imperative `play()` handle instead.
   * A change to `clip` never re-mounts the instance (same skeleton/mixer), so
   * PlayerTokens can flip Idle↔Walk per player without disturbing the useFrame
   * position lockstep.
   */
  clip?: CharacterClip;
  /**
   * When true, suppresses the reactive `clip` effect so an in-flight one-shot
   * celebration (Victory) is not stomped by a concurrent clip-prop change (e.g.
   * the Run→Idle flip that fires when the walk completes on the same render that
   * started the Victory). The `onFinished` callback on the one-shot is
   * responsible for returning to the correct looping clip imperatively once the
   * celebration ends. Default false.
   */
  isCelebrating?: boolean;
  /** Local vertical offset for the whole rig, e.g. to seat feet on the tile. */
  y?: number;
}

/**
 * Renders one animated character. Feet sit at local y=0 (source models already
 * have feet at y≈0), scaled to ~board token height. Plays `initialClip` (Idle)
 * on loop; pass a reactive `clip` prop and/or call the imperative
 * `play('Walk')` / `play('Idle')` to switch.
 */
export const CharacterToken = forwardRef<CharacterTokenHandle, CharacterTokenProps>(
  function CharacterToken({ url, scale = 0.2, initialClip = 'Idle', clip, isCelebrating = false, y = 0, baseColor }, apiRef) {
    const gltf = useGLTF(url);

    // Per-instance clone (independent skeleton). Materials are cloned so each
    // instance owns/disposes its own. Outfit/accessory colors are always NATIVE.
    // When `baseColor` is provided, only the flesh "Skin" material is recolored
    // so the player's skin tone is applied (face flesh + arms + hands match;
    // outfit, hair, and the eyes/eyebrows "Face" decal untouched).
    // Recompute when the source scene OR baseColor changes.
    const scene = useMemo(() => {
      const cloned = cloneSkeleton(gltf.scene) as THREE.Group;
      cloned.traverse((o) => {
        const mesh = o as THREE.Mesh;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual meshes have isMesh===true
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mm) => cloneMaterial(mm));
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: a mesh could carry a null/undefined material slot at runtime
        } else if (mesh.material) {
          mesh.material = cloneMaterial(mesh.material);
        }
      });
      // Apply skin-tone recolor after all materials are cloned (safe — per-instance).
      if (baseColor) {
        applyBaseColor(cloned, baseColor);
      }
      return cloned;
     
    }, [gltf.scene, baseColor]);

    // Dispose the per-instance cloned materials on unmount / re-clone. Geometry
    // is shared with the cached gltf (SkeletonUtils clones nodes but reuses
    // geometry buffers), so we only dispose the materials we cloned above.
    useEffect(() => {
      return () => {
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime narrowing: o is Object3D; only actual meshes have isMesh===true
          if (!mesh.isMesh) return;
          const material: THREE.Material | THREE.Material[] = mesh.material;
          const mats: THREE.Material[] = Array.isArray(material) ? material : [material];
          for (const m of mats) m.dispose();
        });
      };
    }, [scene]);

    // Ref the mixer to the cloned scene → its OWN AnimationMixer.
    const rootRef = useRef<THREE.Group>(null);
    const { actions, mixer } = useAnimations(gltf.animations, rootRef);
    const current = useRef<CharacterClip | null>(null);

    const play = useMemo(
      () =>
        (clip: CharacterClip, opts?: { loop?: boolean; fade?: number; onFinished?: () => void }) => {
          const next = actions[clip];
          if (!next) return;
          if (current.current === clip) return;
          const fade = opts?.fade ?? 0.18;
          const prev = current.current ? actions[current.current] : null;
          next.reset();
          next.setLoop(opts?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
          next.clampWhenFinished = opts?.loop === false;
          next.enabled = true;
          next.setEffectiveWeight(1);
          if (prev && prev !== next) {
            next.crossFadeFrom(prev, fade, false).play();
          } else {
            next.fadeIn(fade).play();
          }
          current.current = clip;

          // Wire up the onFinished callback for LoopOnce clips only. Subscribe to
          // the mixer's 'finished' event, verify this is the right action (guards
          // against stale callbacks from a rapid sequence of one-shots), then
          // remove the listener so it fires exactly once and never leaks.
          if (opts?.loop === false && opts.onFinished) {
            const cb = opts.onFinished;
            const onMixerFinished = (e: THREE.Event) => {
              const ev = e as THREE.Event & { action: THREE.AnimationAction };
              if (ev.action !== next) return; // not our action — ignore
              mixer.removeEventListener('finished', onMixerFinished);
              cb();
            };
            mixer.addEventListener('finished', onMixerFinished);
          }
        },
      [actions, mixer],
    );

    // Start on the initial clip once actions are ready.
    useEffect(() => {
      if (actions[initialClip]) play(initialClip);
    }, [actions, initialClip, play]);

    // Reactive clip prop: crossfade whenever it changes (Idle↔Walk driving).
    // `play` early-returns if the clip is already current, so redundant renders
    // are cheap and never re-trigger the animation.
    //
    // CELEBRATION GUARD: if a one-shot Victory (or similar) is currently in
    // flight (`isCelebrating` prop is true), do NOT re-issue the clip — the
    // prop change (e.g. Run→Idle on walk completion) would stomp the just-
    // started imperative one-shot and crossfade it to weight 0.  The
    // `onFinished` callback on the one-shot imperatively restores the correct
    // looping clip once the celebration ends. isCelebrating is intentionally
    // NOT in the dependency array — adding it would cause the effect to re-run
    // when the flag clears (after Victory), which could play the stale clip
    // value at the wrong time. We only care about the clip change; at that
    // moment we check the latest isCelebrating value via closure capture.
    useEffect(() => {
      if (isCelebrating) return;
      if (clip && actions[clip]) play(clip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clip]);

    useImperativeHandle(apiRef, () => ({ play }), [play]);

    // Under frameloop="always" drei's useAnimations registers its own internal
    // useFrame that ticks the mixer every frame, so all clips (Idle breathing,
    // Run, one-shot Victory/Defeat) advance automatically — no render poking here.

    return (
      <group ref={rootRef} scale={scale} position-y={y}>
        <primitive object={scene} />
      </group>
    );
  },
) as React.ForwardRefExoticComponent<
  CharacterTokenProps & React.RefAttributes<CharacterTokenHandle>
> & {
  /** Warm drei's GLTF cache for a character url ahead of first render. */
  preload: (url: string) => void;
};

/**
 * Preload a character `.glb` into drei's cache (same pattern as
 * `ModelMesh.preload`). Call only for characters that
 * are actually in the current game, not all 52 upfront.
 */
// Forward through an arrow (rather than aliasing the bare method) so `this`
// stays bound to `useGLTF` — avoids the unbound-method footgun.
CharacterToken.preload = (url: string): void => { useGLTF.preload(url); };
