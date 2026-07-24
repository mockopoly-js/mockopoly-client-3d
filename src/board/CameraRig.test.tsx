import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { CameraRig } from './CameraRig';
import { useGameStore } from '../state/gameStore';
import type { GameState } from '../types/GameState';

// ── R3F / drei stubs ─────────────────────────────────────────────────────────
// We render CameraRig outside a real <Canvas>, so useFrame must be captured (we
// drive it manually to exercise the auto-focus loop) and OrbitControls must be a
// forwardRef fake that (a) records the props CameraRig passes and (b) exposes a
// controllable fake controls instance through the forwarded ref — exactly how the
// real drei <OrbitControls> hands back its imperative controls object (NOT a DOM
// node). CameraRig passes a callback ref, so useImperativeHandle drives it.

// useFrame receives (state, delta). Our tests drive it manually and may pass a
// delta (seconds) to advance the per-turn rotation.
let frameCallback: ((state?: unknown, delta?: number) => void) | null = null;
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state?: unknown, delta?: number) => void) => { frameCallback = cb; },
}));

// Minimal fake camera mirroring OrbitControls.object: a position we can inspect
// and a lookAt spy. CameraRig reads controls.object to drive the azimuth sweep.
type FakeCamera = {
  position: THREE.Vector3;
  lookAt: ReturnType<typeof vi.fn>;
};

// The fake OrbitControls instance. Fresh per render via beforeEach reset.
type FakeControls = {
  object: FakeCamera;
  target: THREE.Vector3;
  mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
  update: ReturnType<typeof vi.fn>;
};
let lastControls: FakeControls | null = null;
let lastProps: Record<string, unknown> | null = null;

vi.mock('@react-three/drei', () => ({
  OrbitControls: forwardRef<FakeControls, Record<string, unknown>>((props, ref) => {
    lastProps = props;
    // Build the fake controls instance and expose it through the forwarded ref,
    // mirroring drei: the ref receives the controls object, not a DOM element.
    // Start mouseButtons at sentinel values to prove CameraRig sets them on mount.
    useImperativeHandle(ref, (): FakeControls => {
      const controls: FakeControls = {
        // Camera starts offset from the target so it has a defined radius/theta
        // for the spherical azimuth sweep to rotate around.
        object: { position: new THREE.Vector3(10, 8, 10), lookAt: vi.fn() },
        target: new THREE.Vector3(0, 0, 0),
        mouseButtons: { LEFT: -1, MIDDLE: -1, RIGHT: -1 },
        update: vi.fn(),
      };
      lastControls = controls;
      return controls;
    }, []);
    return null;
  }),
}));

// Minimal store fixture: one player whose turn it is, sitting on a known tile.
// Only the fields CameraRig reads (id, position, turn.currentPlayerId) matter;
// the cast covers the rest (mirrors gameStore.test.ts's fakeState helper).
function fakeState(position = 0, currentPlayerId = 'p1'): GameState {
  return {
    players: [
      { id: 'p1', name: 'Alice', position },
      { id: 'p2', name: 'Bob', position },
    ],
    turn: { currentPlayerId },
  } as unknown as GameState;
}

describe('CameraRig', () => {
  beforeEach(() => {
    frameCallback = null;
    lastControls = null;
    lastProps = null;
    useGameStore.getState().reset();
    useGameStore.getState().update(fakeState(0));
  });

  it('configures OrbitControls for free Blender-style navigation', () => {
    render(<CameraRig />);
    expect(lastProps).toBeTruthy();
    // Pan enabled + screen-space panning (Blender shift-pan feel).
    expect(lastProps!.enablePan).toBe(true);
    expect(lastProps!.screenSpacePanning).toBe(true);
    expect(lastProps!.enableDamping).toBe(true);
    // Relaxed zoom clamps — close to a token, far over the whole diorama.
    expect(lastProps!.minDistance as number).toBeLessThanOrEqual(3);
    expect(lastProps!.maxDistance as number).toBeGreaterThanOrEqual(60);
    // Relaxed orbit clamps — near top-down to near-horizon, never under the floor.
    expect(lastProps!.minPolarAngle as number).toBeLessThanOrEqual(0.1);
    const maxPolar = lastProps!.maxPolarAngle as number;
    expect(maxPolar).toBeGreaterThan(1.4);
    expect(maxPolar).toBeLessThan(Math.PI / 2); // stays above the horizon
  });

  it('sets default mouse buttons: LEFT=ROTATE, RIGHT=disabled, MIDDLE=disabled', () => {
    render(<CameraRig />);
    expect(lastControls!.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(lastControls!.mouseButtons.RIGHT).toBe(undefined);
    expect(lastControls!.mouseButtons.MIDDLE).toBe(undefined);
  });

  it('swaps LEFT mouse button to PAN while Shift is held, back to ROTATE on release', () => {
    render(<CameraRig />);
    expect(lastControls!.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); });
    expect(lastControls!.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);

    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })); });
    expect(lastControls!.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('ignores non-Shift keys for the LEFT button swap', () => {
    render(<CameraRig />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); });
    expect(lastControls!.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('removes the Shift key listeners on unmount', () => {
    const { unmount } = render(<CameraRig />);
    unmount();
    // With listeners gone, dispatching Shift must NOT mutate the (still-referenced)
    // controls instance.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); });
    expect(lastControls!.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('auto-focuses the target toward the active player before manual control', () => {
    // Player on a non-origin tile so the target should move away from (0,0,0).
    useGameStore.getState().update(fakeState(5));
    render(<CameraRig />);
    expect(frameCallback).toBeTruthy();
    const before = lastControls!.target.clone();
    act(() => { frameCallback!(); });
    // Target eased toward the tile → moved from origin, and update() was called.
    expect(lastControls!.target.distanceTo(before)).toBeGreaterThan(0);
    expect(lastControls!.update).toHaveBeenCalled();
  });

  it('disables auto-focus permanently after the first manual interaction (onStart)', () => {
    useGameStore.getState().update(fakeState(5));
    render(<CameraRig />);
    // Simulate the user grabbing the camera: OrbitControls fires onStart.
    act(() => { (lastProps!.onStart as () => void)(); });
    // Even after onEnd, auto-focus must stay off for the session.
    act(() => { (lastProps!.onEnd as () => void)(); });

    lastControls!.update.mockClear();
    const before = lastControls!.target.clone();
    act(() => { frameCallback!(); });
    // Target unchanged and update() not called — the free camera is not yanked back.
    expect(lastControls!.target.distanceTo(before)).toBe(0);
    expect(lastControls!.update).not.toHaveBeenCalled();
  });

  it('does NOT rotate on the first render (no prior currentPlayerId)', () => {
    render(<CameraRig />);
    const camBefore = lastControls!.object.position.clone();
    // A frame right after mount: only auto-focus should run, no azimuth sweep.
    act(() => { frameCallback!(undefined, 0.016); });
    // Camera position is unchanged by any rotation (auto-focus only moves target).
    expect(lastControls!.object.position.distanceTo(camBefore)).toBe(0);
    expect(lastControls!.object.lookAt).not.toHaveBeenCalled();
  });

  it('arms a 90° LEFT azimuth sweep when currentPlayerId changes, preserving distance and pitch', () => {
    render(<CameraRig />); // seeds prevPlayerId = 'p1', no rotation
    // A frame before the turn change must not rotate.
    const camBefore = lastControls!.object.position.clone();
    act(() => { frameCallback!(undefined, 0.016); });
    expect(lastControls!.object.lookAt).not.toHaveBeenCalled();
    expect(lastControls!.object.position.distanceTo(camBefore)).toBe(0);

    // Capture the camera's spherical coords before the sweep.
    const target = lastControls!.target;
    const beforeOffset = lastControls!.object.position.clone().sub(target);
    const beforeSph = new THREE.Spherical().setFromVector3(beforeOffset);

    // Turn passes to p2 → arms the rotation.
    act(() => { useGameStore.getState().update(fakeState(0, 'p2')); });
    // Drive a full frame (delta ≥ TURN_ROTATE_MS/1000 completes the ease).
    act(() => { frameCallback!(undefined, 1); });

    // lookAt(target) was called and the camera moved (azimuth rotated).
    expect(lastControls!.object.lookAt).toHaveBeenCalled();
    const afterOffset = lastControls!.object.position.clone().sub(target);
    const afterSph = new THREE.Spherical().setFromVector3(afterOffset);

    // Distance (radius) and pitch (phi) are preserved.
    expect(afterSph.radius).toBeCloseTo(beforeSph.radius, 5);
    expect(afterSph.phi).toBeCloseTo(beforeSph.phi, 5);
    // Azimuth (theta) advanced by +90° (LEFT).
    expect(afterSph.theta - beforeSph.theta).toBeCloseTo(Math.PI / 2, 4);
  });

  it('pauses the eased sweep while the user is actively dragging', () => {
    render(<CameraRig />);
    // Turn change arms the sweep.
    act(() => { useGameStore.getState().update(fakeState(0, 'p2')); });
    // First frame captures the live spherical start (partial advance).
    act(() => { frameCallback!(undefined, 0.1); });
    const midOffset = lastControls!.object.position.clone().sub(lastControls!.target);
    const midTheta = new THREE.Spherical().setFromVector3(midOffset).theta;

    // User grabs the camera → sweep must freeze (elapsed frozen).
    act(() => { (lastProps!.onStart as () => void)(); });
    act(() => { frameCallback!(undefined, 1); });
    const heldOffset = lastControls!.object.position.clone().sub(lastControls!.target);
    const heldTheta = new THREE.Spherical().setFromVector3(heldOffset).theta;
    // Theta did not advance while interacting.
    expect(heldTheta).toBeCloseTo(midTheta, 5);

    // Release → sweep resumes and completes.
    act(() => { (lastProps!.onEnd as () => void)(); });
    act(() => { frameCallback!(undefined, 1); });
    const doneOffset = lastControls!.object.position.clone().sub(lastControls!.target);
    const doneTheta = new THREE.Spherical().setFromVector3(doneOffset).theta;
    // Theta advanced past where it was frozen → the sweep was not cancelled.
    expect(doneTheta).toBeGreaterThan(heldTheta);
  });
});
