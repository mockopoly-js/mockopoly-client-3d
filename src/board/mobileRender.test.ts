import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { THERMAL_TIERS } from './thermalDpr';

/**
 * Integration tests for the dpr BUS side of the thermal step-down: the parts that
 * need a renderer and therefore cannot live in thermalDpr.test.ts. The decision
 * logic (window, thresholds, warm-up, spike rejection, no-step-up) is tested
 * there against an injected clock; what is under test HERE is that a tier change
 * reaches the renderer correctly, and — mostly — that none of the several ways
 * this codebase can hand the pixels back actually do.
 *
 * The module is a page-lifetime singleton with a deliberately non-resettable
 * ratchet, so every test re-imports it fresh via `vi.resetModules()`.
 */
type Bus = typeof import('./mobileRender');

const BASE = { dprMoving: 1.3, dprStill: 2, settleMs: 120 };

interface Harness {
  bus: Bus;
  applyDpr: ReturnType<typeof vi.fn>;
  /** The live dpr the fake renderer reports, mutated by applyDpr. */
  live: () => number;
  unregister: () => void;
}

async function mount(cfg = BASE): Promise<Harness> {
  vi.resetModules();
  const bus: Bus = await import('./mobileRender');
  let live = 0;
  const applyDpr = vi.fn((dpr: number) => {
    live = dpr;
  });
  const unregister = bus.registerMobileRender(applyDpr, () => live, { ...cfg });
  return { bus, applyDpr, live: () => live, unregister };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'Date',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tier 0 is today, exactly', () => {
  it('registers at the un-throttled still dpr', async () => {
    const h = await mount();
    expect(h.applyDpr).toHaveBeenCalledWith(2);
    expect(h.bus.getThermalTier()).toBe(0);
    h.unregister();
  });

  it('thermalSceneDprCap is the identity function', async () => {
    const h = await mount();
    for (const base of [1, 1.25, 1.5, 2, 3]) {
      expect(h.bus.thermalSceneDprCap(base)).toBe(base);
    }
    h.unregister();
  });

  it('the camera-motion knob behaves exactly as before', async () => {
    const h = await mount();
    h.bus.beginCameraMotion();
    expect(h.live()).toBe(1.3);
    h.bus.endCameraMotion();
    vi.advanceTimersByTime(200);
    expect(h.live()).toBe(2);
    h.unregister();
  });

  it('is a hard no-op before registration and after unregister (desktop path)', async () => {
    vi.resetModules();
    const bus: Bus = await import('./mobileRender');
    // Never registered — desktop never mounts <MobileRenderController>.
    expect(() => {
      bus.beginCameraMotion();
      bus.endCameraMotion();
    }).not.toThrow();
    expect(bus.getThermalTier()).toBe(0);
    expect(bus.thermalSceneDprCap(1.5)).toBe(1.5);
  });
});

describe('a landed tier reaches the renderer', () => {
  it('lowers the still dpr and the scene cap together', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(1);
    expect(h.live()).toBe(THERMAL_TIERS[1].stillDpr);
    expect(h.bus.thermalSceneDprCap(1.5)).toBe(THERMAL_TIERS[1].sceneDpr);
    h.unregister();
  });

  it('caps the scene but NOT the board at the top tier', async () => {
    // Tier 2 is deliberately still-dpr-neutral: the board pass keeps tier 1's
    // resolution and only the scene gets cheaper. If someone re-tunes the table
    // so tier 2 drops the board too, this is where they have to argue for it.
    const h = await mount();
    h.bus.devForceThermalTier(2);
    expect(h.bus.thermalSceneDprCap(1.5)).toBe(1);
    expect(h.live()).toBe(1.5);
    h.unregister();
  });

  it('never caps a prop the tier does not actually beat', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(1);
    // A pass already cheaper than the tier keeps its own value.
    expect(h.bus.thermalSceneDprCap(1)).toBe(1);
    h.unregister();
  });
});

describe('failure mode 4 — the tier lands inside the motion window', () => {
  it('does not touch the live dpr while a gesture is in flight', async () => {
    const h = await mount();
    h.bus.beginCameraMotion();
    expect(h.live()).toBe(1.3);
    h.applyDpr.mockClear();

    // A tier arriving mid-gesture must rewrite config only. The user is already
    // looking at the cheap moving dpr; poking setDpr here would be a second,
    // pointless resolution change inside one gesture.
    h.bus.devForceThermalTier(1);
    expect(h.applyDpr).not.toHaveBeenCalled();
    expect(h.live()).toBe(1.3);

    // The restore at the end of the gesture is where the step becomes visible —
    // and it is the SAME restore the user already expected, just to a lower value.
    h.bus.endCameraMotion();
    vi.advanceTimersByTime(200);
    expect(h.applyDpr.mock.calls).toEqual([[1.5]]);
    h.unregister();
  });

  it('applies immediately when no gesture is in flight (the deferral path)', async () => {
    const h = await mount();
    h.applyDpr.mockClear();
    h.bus.devForceThermalTier(1);
    expect(h.applyDpr.mock.calls).toEqual([[1.5]]);
    h.unregister();
  });
});

describe('failure mode 1 — nothing can re-raise a landed tier', () => {
  it('a GameScene remount does not seed the renderer back at the base dpr', async () => {
    // The re-raise this closes: registerMobileRender is handed the UN-throttled
    // cfg every mount, and used to applyDpr(cfg.dprStill) straight from it.
    const h = await mount();
    h.bus.devForceThermalTier(1);
    expect(h.live()).toBe(1.5);

    h.unregister();
    let live2 = 0;
    const applyDpr2 = vi.fn((dpr: number) => {
      live2 = dpr;
    });
    h.bus.registerMobileRender(applyDpr2, () => live2, { ...BASE });

    expect(h.bus.getThermalTier()).toBe(1);
    expect(applyDpr2).toHaveBeenCalledWith(1.5);
    expect(applyDpr2).not.toHaveBeenCalledWith(2);
    expect(h.bus.thermalSceneDprCap(1.5)).toBe(THERMAL_TIERS[1].sceneDpr);
  });

  it('re-clamping on remount does not compound (config is derived from the base)', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(1);
    for (let i = 0; i < 5; i++) {
      h.unregister();
      let live = 0;
      h.bus.registerMobileRender(
        (d: number) => {
          live = d;
        },
        () => live,
        { ...BASE },
      );
      expect(live).toBe(1.5);
    }
    h.unregister();
  });

  it("the R3F configure clobber is walked back down, and only down", async () => {
    // <Canvas>'s configure effect has no dep array and re-applies the dpr PROP
    // (a constant 2) on every GameScene re-render. Without the watchdog a store
    // update silently reverts a landed tier.
    const h = await mount();
    h.bus.devForceThermalTier(1);
    expect(h.live()).toBe(1.5);
    h.applyDpr.mockClear();

    // Simulate the clobber: R3F sets the live dpr straight back to the prop.
    h.applyDpr(2);
    h.applyDpr.mockClear();
    vi.advanceTimersByTime(1200);
    expect(h.live()).toBe(1.5);
    expect(h.applyDpr).toHaveBeenCalledWith(1.5);

    // And it is not a step-up path: a live dpr already at or below the tier is
    // left completely alone, however long the loop runs.
    h.applyDpr.mockClear();
    vi.advanceTimersByTime(5000);
    expect(h.applyDpr).not.toHaveBeenCalled();
    h.unregister();
  });

  it('the watchdog is dormant at tier 0 — untouched sessions get no extra setDpr', async () => {
    const h = await mount();
    h.applyDpr.mockClear();
    vi.advanceTimersByTime(5000);
    expect(h.applyDpr).not.toHaveBeenCalled();
    h.unregister();
  });

  it('the watchdog re-asserts the MOVING dpr, not the still one, mid-gesture', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(1);
    h.bus.beginCameraMotion();
    expect(h.live()).toBe(1.3);
    h.applyDpr(2); // clobber during an orbit
    h.applyDpr.mockClear();
    vi.advanceTimersByTime(1200);
    expect(h.live()).toBe(1.3);
    h.unregister();
  });
});

describe('failure mode 3 — nothing happens during warm-up', () => {
  it('a fresh mount never demotes on its own inside the warm-up window', async () => {
    const h = await mount();
    // jsdom + fake timers run rAF at a nominal 16ms, i.e. a healthy 60fps, but
    // the point stands regardless: warm-up alone forbids any decision here.
    vi.advanceTimersByTime(19000);
    expect(h.bus.getThermalTier()).toBe(0);
    expect(h.applyDpr.mock.calls).toEqual([[2]]);
    h.unregister();
  });
});

describe('lifecycle', () => {
  it('unregister stops the rAF loop', async () => {
    const h = await mount();
    h.unregister();
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    vi.advanceTimersByTime(2000);
    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('unregister does NOT reset the tier — a rematch is not a cool phone', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(2);
    h.unregister();
    expect(h.bus.getThermalTier()).toBe(2);
    expect(h.bus.thermalSceneDprCap(1.5)).toBe(1);
  });

  it('the moving dpr is never left above the still dpr', async () => {
    // A no-op for the shipped table, but the invariant a future rung below 1.3
    // would otherwise break: orbiting must never cost more than resting.
    const h = await mount({ dprMoving: 1.8, dprStill: 2, settleMs: 120 });
    h.bus.devForceThermalTier(1);
    h.bus.beginCameraMotion();
    expect(h.live()).toBeLessThanOrEqual(1.5);
    h.unregister();
  });
});

describe('devResetThermalTier — the DEV-only escape hatch', () => {
  it('drops a forced tier back to 0 and restores the live dpr immediately', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(2);
    expect(h.bus.getThermalTier()).toBe(2);
    expect(h.live()).toBe(1.5);

    h.bus.devResetThermalTier();

    expect(h.bus.getThermalTier()).toBe(0);
    expect(h.live()).toBe(2);
    expect(h.bus.thermalSceneDprCap(1.5)).toBe(1.5);
    h.unregister();
  });

  it('does not weaken the production ratchet — force() is still one-way afterwards', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(1);
    h.bus.devResetThermalTier();

    // Back up to a tier, then prove a lower force() is STILL a no-op — the
    // exact guard in thermalDpr.ts's advance(), completely unmodified by the
    // reset having run moments earlier.
    h.bus.devForceThermalTier(2);
    h.bus.devForceThermalTier(0);
    expect(h.bus.getThermalTier()).toBe(2);
    h.unregister();
  });

  it('re-arms the warm-up so the automatic sampler resumes from a cool start', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(2);
    h.bus.devResetThermalTier();

    // A fresh ratchet holds warm-up for WARMUP_MS; nothing it evaluates in that
    // window can push it back off tier 0 on its own.
    vi.advanceTimersByTime(19000);
    expect(h.bus.getThermalTier()).toBe(0);
    h.unregister();
  });

  it('is idempotent and safe to call repeatedly, including at tier 0', async () => {
    const h = await mount();
    expect(() => {
      h.bus.devResetThermalTier();
      h.bus.devResetThermalTier();
    }).not.toThrow();
    expect(h.bus.getThermalTier()).toBe(0);
    h.unregister();
  });

  it('is a hard no-op before registration', async () => {
    vi.resetModules();
    const bus: Bus = await import('./mobileRender');
    expect(() => bus.devResetThermalTier()).not.toThrow();
    expect(bus.getThermalTier()).toBe(0);
  });

  it('supports a full force -> reset -> force round trip', async () => {
    const h = await mount();
    h.bus.devForceThermalTier(1);
    expect(h.bus.getThermalTier()).toBe(1);

    h.bus.devResetThermalTier();
    expect(h.bus.getThermalTier()).toBe(0);

    h.bus.devForceThermalTier(2);
    expect(h.bus.getThermalTier()).toBe(2);
    expect(h.live()).toBe(1.5);
    h.unregister();
  });
});
