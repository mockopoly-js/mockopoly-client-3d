import { describe, it, expect, vi } from 'vitest';
import {
  COOLDOWN_MS,
  DWELL_MS,
  MAX_DEFER_MS,
  MAX_PLAUSIBLE_DELTA_MS,
  MAX_THERMAL_TIER,
  MIN_SAMPLES,
  SLOW_FRAME_MS,
  THERMAL_TIERS,
  WARMUP_MS,
  WINDOW_MS,
  createThermalRatchet,
  createThermalSampler,
  type ThermalRatchet,
} from './thermalDpr';

/** iOS quantises frames to whole refresh intervals: 60 fps and 30 fps, nothing between. */
const FAST = 1000 / 60; // 16.67 ms
const SLOW = 1000 / 30; // 33.33 ms

/** Feed `durationMs` of frames of length `frameMs`, returning the new clock. */
function feed(
  sink: { sample: (t: number) => void },
  fromMs: number,
  durationMs: number,
  frameMs: number,
): number {
  let t = fromMs;
  const end = fromMs + durationMs;
  while (t < end) {
    t += frameMs;
    sink.sample(t);
  }
  return t;
}

/**
 * Drive a ratchet for `durationMs` of `frameMs` frames, ticking every frame
 * exactly as the real rAF loop does. Returns the new clock.
 */
function run(r: ThermalRatchet, fromMs: number, durationMs: number, frameMs: number): number {
  let t = fromMs;
  const end = fromMs + durationMs;
  while (t < end) {
    t += frameMs;
    r.tick(t);
  }
  return t;
}

function makeRatchet(overrides: Partial<Parameters<typeof createThermalRatchet>[0]> = {}) {
  const onTierChange = vi.fn();
  const ratchet = createThermalRatchet({ startedAtMs: 0, onTierChange, ...overrides });
  return { ratchet, onTierChange };
}

describe('THERMAL_TIERS table', () => {
  it('tier 0 is a pure identity — first load and desktop must be untouched', () => {
    // This is the load-bearing property of the whole feature: with the ratchet at
    // 0, min(base, cap) has to return `base` for every possible base.
    expect(THERMAL_TIERS[0].stillDpr).toBe(Infinity);
    expect(THERMAL_TIERS[0].sceneDpr).toBe(Infinity);
    for (const base of [1, 1.25, 1.5, 2, 3]) {
      expect(Math.min(base, THERMAL_TIERS[0].stillDpr)).toBe(base);
      expect(Math.min(base, THERMAL_TIERS[0].sceneDpr)).toBe(base);
    }
  });

  it('is monotonically non-increasing in both caps — every rung is cheaper', () => {
    for (let i = 1; i < THERMAL_TIERS.length; i++) {
      expect(THERMAL_TIERS[i].stillDpr).toBeLessThanOrEqual(THERMAL_TIERS[i - 1].stillDpr);
      expect(THERMAL_TIERS[i].sceneDpr).toBeLessThanOrEqual(THERMAL_TIERS[i - 1].sceneDpr);
    }
  });

  it('is strictly cheaper at every step (no rung that costs a transition for nothing)', () => {
    for (let i = 1; i < THERMAL_TIERS.length; i++) {
      const prev = THERMAL_TIERS[i - 1];
      const cur = THERMAL_TIERS[i];
      expect(cur.stillDpr < prev.stillDpr || cur.sceneDpr < prev.sceneDpr).toBe(true);
    }
  });

  it('never caps the scene above the still dpr (the scene is the cheap tier)', () => {
    for (const t of THERMAL_TIERS) expect(t.sceneDpr).toBeLessThanOrEqual(t.stillDpr);
  });

  it('has 3 tiers, as scoped', () => {
    expect(THERMAL_TIERS).toHaveLength(3);
    expect(MAX_THERMAL_TIER).toBe(2);
  });
});

describe('sampler — the statistic', () => {
  it('lower median is a strict majority vote, which is what makes the threshold value moot on iOS', () => {
    // Exactly half the frames late must NOT read as slow; one more than half must.
    // (The first sample after construction has no predecessor and yields no
    // delta, so prime the clock before counting.)
    const half = createThermalSampler({ startedAtMs: 0 });
    let t = WARMUP_MS + 1;
    half.sample(t);
    for (let i = 0; i < 30; i++) {
      t += FAST;
      half.sample(t);
      t += SLOW;
      half.sample(t);
    }
    expect(half.medianDeltaMs()).toBeLessThan(SLOW_FRAME_MS);

    // ...and one extra late frame flips it.
    t += SLOW;
    half.sample(t);
    expect(half.medianDeltaMs()).toBeGreaterThan(SLOW_FRAME_MS);
  });

  it('a single enormous stall cannot move the median (mean would break here)', () => {
    const s = createThermalSampler({ startedAtMs: 0 });
    let t = feed(s, WARMUP_MS + 1, WINDOW_MS, FAST);
    // 900ms hitch — under MAX_PLAUSIBLE so it IS recorded, not filtered.
    t += 900;
    s.sample(t);
    feed(s, t, 200, FAST);
    expect(s.medianDeltaMs()).toBeCloseTo(FAST, 1);
    expect(s.shouldDemote(t + 200)).toBe(false);
  });

  it('drops discontinuities (tab resume) rather than recording them', () => {
    const s = createThermalSampler({ startedAtMs: 0 });
    const t = feed(s, WARMUP_MS + 1, WINDOW_MS, FAST);
    const before = s.medianDeltaMs();
    s.sample(t + MAX_PLAUSIBLE_DELTA_MS + 1);
    expect(s.medianDeltaMs()).toBe(before);
  });

  it('refuses an opinion until the window is populated', () => {
    const s = createThermalSampler({ startedAtMs: 0 });
    let t = WARMUP_MS + 1;
    for (let i = 0; i < MIN_SAMPLES - 2; i++) {
      t += SLOW;
      s.sample(t);
    }
    expect(s.medianDeltaMs()).toBeNaN();
    expect(s.shouldDemote(t)).toBe(false);
  });

  it('trims the window by wall clock, not sample count', () => {
    const s = createThermalSampler({ startedAtMs: 0 });
    // Fill with slow frames, then run fast for longer than the window. The slow
    // history must age out entirely rather than linger as half a fixed-size ring.
    const t = feed(s, WARMUP_MS + 1, WINDOW_MS, SLOW);
    expect(s.medianDeltaMs()).toBeGreaterThan(SLOW_FRAME_MS);
    feed(s, t, WINDOW_MS + 100, FAST);
    expect(s.medianDeltaMs()).toBeCloseTo(FAST, 1);
  });
});

describe('failure mode 3 — warm-up suppression', () => {
  it('ignores an entirely throttled warm-up period', () => {
    const s = createThermalSampler({ startedAtMs: 0 });
    const t = feed(s, 0, WARMUP_MS, SLOW);
    expect(s.medianDeltaMs()).toBeNaN();
    expect(s.shouldDemote(t)).toBe(false);
  });

  it('a ratchet cannot demote inside warm-up + dwell no matter how bad load is', () => {
    const { ratchet, onTierChange } = makeRatchet();
    // Hammer it with 30fps from frame one — the worst possible load.
    const t = run(ratchet, 0, WARMUP_MS + DWELL_MS, SLOW);
    expect(ratchet.tier()).toBe(0);
    expect(ratchet.pendingTier()).toBe(0);
    expect(onTierChange).not.toHaveBeenCalled();
    // ...and it still needs the window to fill on top of that.
    run(ratchet, t, WINDOW_MS + 500, SLOW);
    expect(ratchet.pendingTier()).toBe(1);
  });

  it('a background/resume cycle cannot buy its way out of warm-up', () => {
    const s = createThermalSampler({ startedAtMs: 0 });
    s.clear(WARMUP_MS / 2);
    const t = feed(s, WARMUP_MS / 2, WARMUP_MS / 2 - 100, SLOW);
    expect(s.shouldDemote(t)).toBe(false);
  });
});

describe('failure mode 2 — a legitimate hitch must not demote the session', () => {
  // Every one of these is a real event from the scope's capture. The numbers are
  // the measured/observed durations, not invented ones.
  const hitches: [string, number][] = [
    ['shadow bake (one frame)', 100],
    ['takeover panel opening', 900],
    ['forest chunk streaming in', 2000],
    ['dice roll + token walk (longest measured burst)', 4200],
    ['a pathological 9s stall, still under the dwell', 9000],
  ];

  for (const [label, durationMs] of hitches) {
    it(`survives: ${label}`, () => {
      const { ratchet, onTierChange } = makeRatchet();
      let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
      t = run(ratchet, t, durationMs, SLOW);
      run(ratchet, t, WINDOW_MS + 1000, FAST);
      expect(ratchet.tier()).toBe(0);
      expect(ratchet.pendingTier()).toBe(0);
      expect(onTierChange).not.toHaveBeenCalled();
    });
  }

  it('a string of separate hitches does not accumulate into a demotion', () => {
    // The dwell resets to zero on recovery; it must not integrate. Ten 4s bursts
    // = 40s of slow frames total, comfortably past DWELL_MS if it accumulated.
    const { ratchet } = makeRatchet();
    let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    for (let i = 0; i < 10; i++) {
      t = run(ratchet, t, 4000, SLOW);
      t = run(ratchet, t, WINDOW_MS + 500, FAST);
    }
    expect(ratchet.tier()).toBe(0);
    expect(ratchet.pendingTier()).toBe(0);
  });

  it('but a genuinely sustained throttle DOES arm a tier', () => {
    const { ratchet } = makeRatchet();
    const t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    run(ratchet, t, DWELL_MS + WINDOW_MS + 1000, SLOW);
    expect(ratchet.pendingTier()).toBe(1);
  });

  it('the trigger threshold is a majority of late frames, not a mean', () => {
    // 49% late frames sustained for 60s — twice the dwell — must NOT trigger.
    const { ratchet } = makeRatchet();
    let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    for (let i = 0; i < 1200; i++) {
      // 51 fast : 49 slow, interleaved so any 2s window holds the same ratio.
      for (let k = 0; k < 51; k++) {
        t += FAST;
        ratchet.tick(t);
      }
      for (let k = 0; k < 49; k++) {
        t += SLOW;
        ratchet.tick(t);
      }
      if (ratchet.pendingTier() !== 0) break;
    }
    expect(ratchet.pendingTier()).toBe(0);
  });
});

describe('failure mode 1 — the ratchet never steps up', () => {
  it('stays down forever once dropped, however good frames get', () => {
    const { ratchet } = makeRatchet();
    let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    t = run(ratchet, t, DWELL_MS + WINDOW_MS + 1000, SLOW);
    ratchet.commitOnCameraMotion(t);
    expect(ratchet.tier()).toBe(1);

    // Ten minutes of perfect 60fps — every possible step-up condition satisfied.
    for (let i = 0; i < 60; i++) {
      t = run(ratchet, t, 10000, FAST);
      expect(ratchet.tier()).toBe(1);
    }
    expect(ratchet.tier()).toBe(1);
  });

  it('force() cannot lower a tier either — the DEV override is one-way too', () => {
    const { ratchet, onTierChange } = makeRatchet();
    ratchet.force(2, 0);
    expect(ratchet.tier()).toBe(2);
    ratchet.force(0, 100);
    ratchet.force(1, 200);
    ratchet.force(-5, 300);
    expect(ratchet.tier()).toBe(2);
    expect(onTierChange).toHaveBeenCalledTimes(1);
  });

  it('clamps above the top rung rather than indexing off the table', () => {
    const { ratchet } = makeRatchet();
    ratchet.force(99, 0);
    expect(ratchet.tier()).toBe(MAX_THERMAL_TIER);
    expect(THERMAL_TIERS[ratchet.tier()]).toBeDefined();
  });

  it('onTierChange fires exactly once per rung, never for a no-op', () => {
    const { ratchet, onTierChange } = makeRatchet();
    ratchet.force(1, 0);
    ratchet.force(1, 1);
    ratchet.force(1, 2);
    expect(onTierChange.mock.calls).toEqual([[1]]);
  });

  it('cannot be driven past the top rung by more throttling', () => {
    const { ratchet, onTierChange } = makeRatchet();
    let t = 0;
    for (let i = 0; i < 8; i++) {
      t = run(ratchet, t, WARMUP_MS + COOLDOWN_MS + DWELL_MS + WINDOW_MS + 2000, SLOW);
      ratchet.commitOnCameraMotion(t);
    }
    expect(ratchet.tier()).toBe(MAX_THERMAL_TIER);
    expect(onTierChange.mock.calls).toEqual([[1], [2]]);
  });
});

describe('failure mode 4 — motion gating', () => {
  it('arms but does not commit until a camera gesture starts', () => {
    const { ratchet, onTierChange } = makeRatchet();
    let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    t = run(ratchet, t, DWELL_MS + WINDOW_MS + 1000, SLOW);

    expect(ratchet.pendingTier()).toBe(1);
    expect(ratchet.tier()).toBe(0);
    expect(onTierChange).not.toHaveBeenCalled();

    ratchet.commitOnCameraMotion(t);
    expect(ratchet.tier()).toBe(1);
    expect(onTierChange).toHaveBeenCalledWith(1);
  });

  it('commitOnCameraMotion is a no-op when nothing is armed', () => {
    const { ratchet, onTierChange } = makeRatchet();
    const t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 5000, FAST);
    ratchet.commitOnCameraMotion(t);
    ratchet.commitOnCameraMotion(t + 1);
    expect(ratchet.tier()).toBe(0);
    expect(onTierChange).not.toHaveBeenCalled();
  });

  it('arms at most one rung ahead, so the first step is never skipped', () => {
    // A very long throttle with no gesture must not queue 0 -> 2; the user is
    // owed the chance to have each step hidden under a motion window.
    const { ratchet } = makeRatchet({ maxDeferMs: Number.POSITIVE_INFINITY });
    const t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    run(ratchet, t, 120000, SLOW);
    expect(ratchet.pendingTier()).toBe(1);
    expect(ratchet.tier()).toBe(0);
  });

  it('applies without a gesture once the deferral deadline passes', () => {
    const { ratchet, onTierChange } = makeRatchet();
    let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    t = run(ratchet, t, DWELL_MS + WINDOW_MS + 1000, SLOW);
    expect(ratchet.tier()).toBe(0);
    run(ratchet, t, MAX_DEFER_MS + 1000, SLOW);
    expect(ratchet.tier()).toBe(1);
    expect(onTierChange).toHaveBeenCalledWith(1);
  });
});

describe('cooldown after a tier lands', () => {
  it('does not cascade 0 -> 1 -> 2 off the reallocation frames', () => {
    const { ratchet } = makeRatchet();
    let t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    t = run(ratchet, t, DWELL_MS + WINDOW_MS + 1000, SLOW);
    ratchet.commitOnCameraMotion(t);
    expect(ratchet.tier()).toBe(1);

    // Keep it pinned slow for the whole cooldown: still must not arm tier 2.
    t = run(ratchet, t, COOLDOWN_MS - 1000, SLOW);
    expect(ratchet.pendingTier()).toBe(1);

    // Past the cooldown, with a fresh window + dwell, tier 2 arms as designed.
    t = run(ratchet, t, WINDOW_MS + DWELL_MS + 2000, SLOW);
    expect(ratchet.pendingTier()).toBe(2);
  });

  it('a single sustained episode yields exactly one demotion, not one per eval tick', () => {
    const { ratchet } = makeRatchet();
    const t = run(ratchet, 0, WARMUP_MS + WINDOW_MS + 1000, FAST);
    // Long enough that a 4Hz poll would fire ~40 times if the episode were not
    // consumed; the demote is consumed, so it arms once.
    run(ratchet, t, DWELL_MS + 10000, SLOW);
    expect(ratchet.pendingTier()).toBe(1);
    expect(ratchet.tier()).toBe(0);
  });
});
