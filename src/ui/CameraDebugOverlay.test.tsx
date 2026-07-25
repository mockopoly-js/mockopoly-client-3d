import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CameraDebugOverlay } from './CameraDebugOverlay';
import { useGameStore } from '../state/gameStore';
import type { CameraReadout } from '../state/gameStore';

describe('CameraDebugOverlay', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('renders nothing when cameraReadout is null', () => {
    const { container } = render(<CameraDebugOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all four labelled lines with 2-decimal values when readout is set', () => {
    const readout: CameraReadout = {
      pos: [-8.123456, 12.987654, 8.5],
      target: [0, 0, 0],
      offset: [-8.123456, 12.987654, 8.5],
      dist: 17.246798,
    };
    useGameStore.getState().setCameraReadout(readout);
    render(<CameraDebugOverlay />);

    const el = screen.getByTestId('camera-debug-overlay');
    expect(el).toBeTruthy();
    const text = el.textContent;
    // pos values rounded to 2 decimals
    expect(text).toContain('-8.12');
    expect(text).toContain('12.99');
    expect(text).toContain('8.50');
    // target all zeros
    expect(text).toContain('[0.00, 0.00, 0.00]');
    // offset same as pos (target is [0,0,0])
    expect(text).toContain('offset');
    // dist rounded to 2 decimals
    expect(text).toContain('17.25');
  });

  it('setCameraReadout action updates the store field', () => {
    const readout: CameraReadout = {
      pos: [1, 2, 3],
      target: [4, 5, 6],
      offset: [-3, -3, -3],
      dist: 5.196,
    };
    expect(useGameStore.getState().cameraReadout).toBeNull();
    useGameStore.getState().setCameraReadout(readout);
    expect(useGameStore.getState().cameraReadout).toEqual(readout);
  });
});
