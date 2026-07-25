import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { CameraRig, INITIAL_CAM_OFFSET, INITIAL_CAM_TARGET } from './CameraRig';
import { useGameStore } from '../state/gameStore';
import type { GameState } from '../types/GameState';

// ── R3F / drei stubs ─────────────────────────────────────────────────────────
// We render CameraRig outside a real <Canvas>, so useFrame must be captured (we
// drive it manually to exercise the debug readout loop) and OrbitControls must be
// a forwardRef fake that (a) records the props CameraRig passes and (b) exposes a
// controllable fake controls instance through the forwarded ref — exactly how the
// real drei <OrbitControls> hands back its imperative controls object (NOT a DOM
// node). CameraRig passes a callback ref, so useImperativeHandle drives it.

// useFrame receives (state, delta). Our tests drive it manually.
let frameCallback: ((state?: unknown, delta?: number) => void) | null = null;

// Fake camera for the useThree(s => s.camera) call in the initial-snap effect.
const fakeCamera = { position: new THREE.Vector3(0, 0, 0) };

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state?: unknown, delta?: number) => void) => { frameCallback = cb; },
  useThree: (selector: (state: { camera: typeof fakeCamera }) => unknown) =>
    selector({ camera: fakeCamera }),
}));

// The fake OrbitControls instance. Fresh per render via beforeEach reset.
interface FakeControls {
  target: THREE.Vector3;
  mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
  update: ReturnType<typeof vi.fn>;
}
let lastControls: FakeControls | null = null;
let lastProps: Record<string, unknown> | null = null;

// Assert-and-return accessors: they throw (failing the test loudly) if the
// captured value was never populated, which is exactly what a bare `!` would do
// at runtime — but without the forbidden non-null assertion and with a clearer
// failure message.
function props(): Record<string, unknown> {
  if (!lastProps) throw new Error('OrbitControls props were never captured');
  return lastProps;
}
function controls(): FakeControls {
  if (!lastControls) throw new Error('OrbitControls instance was never captured');
  return lastControls;
}
function frame(): (state?: unknown, delta?: number) => void {
  if (!frameCallback) throw new Error('useFrame callback was never captured');
  return frameCallback;
}

vi.mock('@react-three/drei', () => {
  const FakeOrbitControls = forwardRef<FakeControls, Record<string, unknown>>((props, ref) => {
    lastProps = props;
    // Build the fake controls instance and expose it through the forwarded ref,
    // mirroring drei: the ref receives the controls object, not a DOM element.
    // Start mouseButtons at sentinel values to prove CameraRig sets them on mount.
    useImperativeHandle(ref, (): FakeControls => {
      const c: FakeControls = {
        target: new THREE.Vector3(0, 0, 0),
        mouseButtons: { LEFT: -1, MIDDLE: -1, RIGHT: -1 },
        update: vi.fn(),
      };
      lastControls = c;
      return c;
    }, []);
    return null;
  });
  FakeOrbitControls.displayName = 'FakeOrbitControls';
  return { OrbitControls: FakeOrbitControls };
});

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
    fakeCamera.position.set(0, 0, 0);
    useGameStore.getState().reset();
    useGameStore.getState().update(fakeState(0));
  });

  it('configures OrbitControls for free Blender-style navigation', () => {
    render(<CameraRig />);
    expect(lastProps).toBeTruthy();
    // Pan enabled + screen-space panning (Blender shift-pan feel).
    expect(props().enablePan).toBe(true);
    expect(props().screenSpacePanning).toBe(true);
    expect(props().enableDamping).toBe(true);
    // Relaxed zoom clamps — close to a token, far over the whole diorama.
    expect(props().minDistance as number).toBeLessThanOrEqual(3);
    expect(props().maxDistance as number).toBeGreaterThanOrEqual(60);
    // Relaxed orbit clamps — near top-down to near-horizon, never under the floor.
    expect(props().minPolarAngle as number).toBeLessThanOrEqual(0.1);
    const maxPolar = props().maxPolarAngle as number;
    expect(maxPolar).toBeGreaterThan(1.4);
    expect(maxPolar).toBeLessThan(Math.PI / 2); // stays above the horizon
  });

  it('sets default mouse buttons: LEFT=ROTATE, RIGHT=disabled, MIDDLE=disabled', () => {
    render(<CameraRig />);
    expect(controls().mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(controls().mouseButtons.RIGHT).toBe(undefined);
    expect(controls().mouseButtons.MIDDLE).toBe(undefined);
  });

  it('swaps LEFT mouse button to PAN while Shift is held, back to ROTATE on release', () => {
    render(<CameraRig />);
    expect(controls().mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); });
    expect(controls().mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);

    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })); });
    expect(controls().mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('ignores non-Shift keys for the LEFT button swap', () => {
    render(<CameraRig />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); });
    expect(controls().mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('removes the Shift key listeners on unmount', () => {
    const { unmount } = render(<CameraRig />);
    unmount();
    // With listeners gone, dispatching Shift must NOT mutate the (still-referenced)
    // controls instance.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); });
    expect(controls().mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('snaps the OrbitControls target to INITIAL_CAM_TARGET (fixed world point) on initial mount', () => {
    // Player on GO (tile 0) — the initial game state. Store hydration is the guard.
    useGameStore.getState().update(fakeState(0));
    render(<CameraRig />);

    // Target must equal INITIAL_CAM_TARGET exactly — NOT a player tile position.
    expect(controls().target.x).toBeCloseTo(INITIAL_CAM_TARGET[0], 4);
    expect(controls().target.y).toBeCloseTo(INITIAL_CAM_TARGET[1], 4);
    expect(controls().target.z).toBeCloseTo(INITIAL_CAM_TARGET[2], 4);
  });

  it('snaps the camera position to INITIAL_CAM_TARGET + INITIAL_CAM_OFFSET on initial mount', () => {
    useGameStore.getState().update(fakeState(0));
    render(<CameraRig />);

    // camera.position = [-3.77 + -7.27, 0.61 + 7.04, 0.67 + 0.24] = [-11.04, 7.64, 0.91]
    expect(fakeCamera.position.x).toBeCloseTo(INITIAL_CAM_TARGET[0] + INITIAL_CAM_OFFSET[0], 4);
    expect(fakeCamera.position.y).toBeCloseTo(INITIAL_CAM_TARGET[1] + INITIAL_CAM_OFFSET[1], 4);
    expect(fakeCamera.position.z).toBeCloseTo(INITIAL_CAM_TARGET[2] + INITIAL_CAM_OFFSET[2], 4);
  });

  it('does NOT drift the camera target after load — no auto-focus lerp runs', () => {
    useGameStore.getState().update(fakeState(0));
    render(<CameraRig />);
    expect(frameCallback).toBeTruthy();

    const targetBefore = controls().target.clone();
    controls().update.mockClear();

    // Change the active player's position — this must NOT move the camera target.
    act(() => { useGameStore.getState().update(fakeState(10)); });
    act(() => { frame()(); });

    // Target must remain exactly where it snapped — no drift allowed.
    expect(controls().target.distanceTo(targetBefore)).toBe(0);
    // update() must NOT have been called from auto-focus logic in useFrame.
    expect(controls().update).not.toHaveBeenCalled();
  });
});
