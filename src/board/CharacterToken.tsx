import { useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

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
 * TINT: the source materials are flat baseColor PBR (named Skin/Shirt/Hair/…,
 * and the names differ per character). Rather than depend on a fixed name, we
 * clone every material and apply a subtle HSL "wash" toward the player color on
 * the non-skin/non-face materials (the clothing/armor bulk), keeping ~60% of
 * the original value/saturation so characters stay recognizable but read as the
 * player's color. Skin & Face keep their natural tone. An emissive rim in the
 * player color is added so the color still reads under flat lighting.
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
  play: (clip: CharacterClip, opts?: { loop?: boolean; fade?: number }) => void;
}

// Materials we never tint (keep natural skin/face); everything else is "body".
const SKIN_MATCH = /skin|face|head/i;

function tintMaterial(mat: THREE.Material, color: THREE.Color): THREE.Material {
  const m = (mat as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
  const name = m.name || '';
  if (SKIN_MATCH.test(name)) {
    // Leave skin/face mostly natural, but a faint emissive so the token still
    // groups visually with its owner.
    m.emissive = color.clone().multiplyScalar(0.06);
    return m;
  }
  // Wash the body/clothing color toward the player color while retaining some of
  // the original lightness so silhouette detail survives (not flat monochrome).
  const orig = m.color.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  orig.getHSL(hsl);
  const target = color.clone();
  const thsl = { h: 0, s: 0, l: 0 };
  target.getHSL(thsl);
  // Take hue + saturation from player color; keep a blend of the original
  // lightness so dark/light garment contrast is preserved.
  const l = THREE.MathUtils.clamp(hsl.l * 0.45 + thsl.l * 0.55, 0.12, 0.85);
  m.color = new THREE.Color().setHSL(thsl.h, Math.max(0.35, thsl.s), l);
  m.emissive = color.clone().multiplyScalar(0.12);
  return m;
}

interface CharacterTokenProps {
  url: string;
  tint: string; // player color hex, e.g. '#e74c3c'
  scale?: number;
  initialClip?: CharacterClip;
}

/**
 * Renders one animated character. Feet sit at local y=0 (source models already
 * have feet at y≈0), scaled to ~board token height. Plays `initialClip` (Idle)
 * on loop; call the imperative `play('Walk')` / `play('Idle')` to switch.
 */
export const CharacterToken = forwardRef<CharacterTokenHandle, CharacterTokenProps>(
  function CharacterToken({ url, tint, scale = 0.2, initialClip = 'Idle' }, apiRef) {
    const gltf = useGLTF(url);

    // Per-instance clone (independent skeleton). Recompute only if url/tint change.
    const scene = useMemo(() => {
      const cloned = cloneSkeleton(gltf.scene) as THREE.Group;
      const color = new THREE.Color(tint);
      cloned.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mm) => tintMaterial(mm, color));
        } else if (mesh.material) {
          mesh.material = tintMaterial(mesh.material, color);
        }
      });
      return cloned;
    }, [gltf.scene, tint]);

    // Dispose the per-instance cloned materials on unmount / re-clone. Geometry
    // is shared with the cached gltf (SkeletonUtils clones nodes but reuses
    // geometry buffers), so we only dispose the materials we cloned above.
    useEffect(() => {
      return () => {
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) =>
            m?.dispose(),
          );
        });
      };
    }, [scene]);

    // Ref the mixer to the cloned scene → its OWN AnimationMixer.
    const rootRef = useRef<THREE.Group>(null);
    const { actions, mixer } = useAnimations(gltf.animations, rootRef);
    const current = useRef<CharacterClip | null>(null);

    const play = useMemo(
      () =>
        (clip: CharacterClip, opts?: { loop?: boolean; fade?: number }) => {
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
        },
      [actions],
    );

    // Start on the initial clip once actions are ready.
    useEffect(() => {
      if (actions[initialClip]) play(initialClip);
    }, [actions, initialClip, play]);

    useImperativeHandle(apiRef, () => ({ play }), [play]);

    // Keep the mixer reference from being GC-surprised (drei ticks it in useFrame).
    void mixer;

    return (
      <group ref={rootRef} scale={scale}>
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
 * `ModelMesh.preload` / `constants/models.ts`). Call only for characters that
 * are actually in the current game, not all 52 upfront.
 */
CharacterToken.preload = useGLTF.preload;
