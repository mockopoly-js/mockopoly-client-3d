// WebAudio synthesized SFX — no audio asset files.
// ALL public functions are jsdom/SSR-safe: they guard every AudioContext access
// and never throw when AudioContext is absent.

export type SfxName = 'roll' | 'hop' | 'buy' | 'rent' | 'jail' | 'bankrupt' | 'win';

const MUTE_KEY = 'mockopoly_muted';

// ─── Singleton state ──────────────────────────────────────────────────────────
let ctx: AudioContext | null = null;
let _muted: boolean = false;
let _master: GainNode | null = null;

// Read persisted mute on module load (safe — localStorage is always available or shimmed).
try {
  _muted = localStorage.getItem(MUTE_KEY) === 'true';
} catch { /* ignore */ }

// ─── AudioContext factory ─────────────────────────────────────────────────────
function getCtx(): AudioContext | null {
  return ctx;
}

/**
 * Call once from a user gesture (click / keydown).  Creates the AudioContext
 * (or resumes it if suspended by the browser's autoplay policy).
 * Safe to call multiple times — subsequent calls are no-ops once ctx is running.
 */
export function initAudioOnGesture(): void {
  try {
    const Ctor =
      (typeof window !== 'undefined' &&
        ((window as any).AudioContext ?? (window as any).webkitAudioContext)) ||
      null;
    if (!Ctor) return; // jsdom / SSR — no-op
    if (!ctx) {
      ctx = new Ctor() as AudioContext;
      // Master gain at 0.7 — comfortable level, headroom for overlapping SFX
      _master = ctx.createGain();
      _master.gain.value = 0.7;
      _master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }
}

// ─── Mute controls ───────────────────────────────────────────────────────────
export function setMuted(value: boolean): void {
  _muted = value;
  try {
    localStorage.setItem(MUTE_KEY, String(value));
  } catch { /* ignore */ }
}

export function isMuted(): boolean {
  return _muted;
}

// ─── Synth helpers ────────────────────────────────────────────────────────────
function now(): number {
  return ctx!.currentTime;
}

/** Returns master gain node (always routes through it for level safety). */
function getMaster(): GainNode {
  // Fallback: if somehow _master is null, wire directly to destination at unity
  if (_master) return _master;
  const g = ctx!.createGain();
  g.gain.value = 1;
  g.connect(ctx!.destination);
  return g;
}

/**
 * Single oscillator note with ADSR-style envelope routed through master gain.
 * All nodes are scheduled to stop at a finite time — no leaks.
 */
function osc(
  type: OscillatorType,
  freq: number,
  startTime: number,
  duration: number,
  peakGain: number,
  attack = 0.005,
  decay = 0.05,
  sustain = 0.6,
  release?: number,
): void {
  const rel = release ?? duration * 0.5;
  const sustainLevel = peakGain * sustain;
  const decayEnd = startTime + attack + decay;
  const sustainEnd = startTime + duration - rel;
  const end = startTime + duration + 0.02;

  const g = ctx!.createGain();
  g.connect(getMaster());
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(peakGain, startTime + attack);
  g.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
  // Only schedule sustain/release if there's room
  if (sustainEnd > decayEnd) {
    g.gain.setValueAtTime(sustainLevel, sustainEnd);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, startTime);
  o.connect(g);
  o.start(startTime);
  o.stop(end);
}

/**
 * Oscillator with linear frequency sweep, routed through master gain.
 */
function freqRamp(
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  startTime: number,
  duration: number,
  peakGain: number,
  attack = 0.01,
): void {
  const end = startTime + duration + 0.02;

  const g = ctx!.createGain();
  g.connect(getMaster());
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(peakGain, startTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freqStart, startTime);
  o.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);
  o.connect(g);
  o.start(startTime);
  o.stop(end);
}

/**
 * Short burst of filtered white noise — for dice rattle, impacts, etc.
 * All nodes stopped at a finite time.
 */
function noiseBurst(
  startTime: number,
  duration: number,
  gain: number,
  filterFreq = 3000,
  filterQ = 1.5,
  filterType: BiquadFilterType = 'bandpass',
): void {
  const sampleRate = ctx!.sampleRate;
  const bufLen = Math.ceil(sampleRate * duration);
  const buffer = ctx!.createBuffer(1, bufLen, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx!.createBufferSource();
  source.buffer = buffer;

  const bpf = ctx!.createBiquadFilter();
  bpf.type = filterType;
  bpf.frequency.value = filterFreq;
  bpf.Q.value = filterQ;

  const g = ctx!.createGain();
  g.gain.setValueAtTime(gain, startTime);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  g.connect(getMaster());

  source.connect(bpf);
  bpf.connect(g);

  source.start(startTime);
  source.stop(startTime + duration + 0.02);
}

/**
 * Short percussive "knock" transient: a pitched sine with very fast decay.
 * Good for dice-clatter hits.
 */
function knock(freq: number, startTime: number, gain: number): void {
  const duration = 0.05;
  const g = ctx!.createGain();
  g.connect(getMaster());
  g.gain.setValueAtTime(gain, startTime);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  const o = ctx!.createOscillator();
  o.type = 'sine';
  // Quick pitch drop: sounds like a hard surface impact
  o.frequency.setValueAtTime(freq * 1.8, startTime);
  o.frequency.exponentialRampToValueAtTime(freq, startTime + 0.015);
  o.connect(g);
  o.start(startTime);
  o.stop(startTime + duration + 0.02);
}

// ─── Sound designs ────────────────────────────────────────────────────────────
const SYNTHS: Record<SfxName, () => void> = {
  /**
   * Dice rattle + tumble (~300ms).
   * Layered: filtered-noise shake burst + high-freq noise tail + 4 knock
   * transients at slightly random offsets (simulates dice bouncing on a surface).
   */
  roll() {
    const t = now();
    // Main rattle noise: band-pass ~2.5kHz for "papery" dice shake
    noiseBurst(t, 0.22, 0.35, 2500, 1.8, 'bandpass');
    // Brighter high fizz fading out behind it
    noiseBurst(t + 0.04, 0.18, 0.15, 6000, 0.8, 'highpass');
    // 4 knock transients: dice tumbling/bouncing, staggered + randomised pitch
    const knockFreqs = [220, 180, 260, 200];
    const knockTimes = [0.0, 0.07, 0.14, 0.21];
    for (let i = 0; i < 4; i++) {
      knock(knockFreqs[i] + Math.random() * 40, t + knockTimes[i], 0.18);
    }
    // Final "settle" thud: low-frequency plop as dice land
    noiseBurst(t + 0.24, 0.06, 0.25, 300, 2.0, 'lowpass');
  },

  /**
   * Token hop: soft rounded pluck (~90ms).
   * Triangle + sine blend for a warm, gentle "blip" — not harsh.
   * Fast attack, medium decay, zero sustain = pluck feel.
   */
  hop() {
    const t = now();
    // Warm body: triangle at E5
    osc('triangle', 659, t, 0.09, 0.22, 0.003, 0.02, 0.0);
    // Soft overtone: sine octave up, quieter
    osc('sine', 1318, t, 0.06, 0.12, 0.003, 0.01, 0.0);
    // Subtle low thud for the landing feel
    osc('sine', 180, t, 0.05, 0.14, 0.01, 0.01, 0.0);
  },

  /**
   * Property buy: 3-note rising coin shimmer (~350ms).
   * Triangle/sine with slight detune between pairs — warm bright shimmer.
   * Notes: C5 → E5 → G5, stepping up with a brief tail.
   */
  buy() {
    const t = now();
    const notes = [523, 659, 784]; // C5, E5, G5
    const delays = [0.0, 0.1, 0.2];
    const detunes = [0, 3, -2]; // slight detune in Hz per note for shimmer
    notes.forEach((freq, i) => {
      const d = delays[i];
      // Primary triangle: warm body
      osc('triangle', freq + detunes[i], t + d, 0.18, 0.3, 0.005, 0.04, 0.5);
      // Sine slight detune: adds shimmer without harshness
      osc('sine', freq - detunes[i] + 1, t + d, 0.14, 0.22, 0.003, 0.01, 0.3);
    });
    // Bright coin-ring tail on the final note
    osc('sine', 1568, t + 0.22, 0.14, 0.12, 0.003, 0.01, 0.0);
  },

  /**
   * Rent collected: soft descending two-tone (~280ms).
   * Money leaving — gentle, not alarming. Two overlapping downward sweeps.
   */
  rent() {
    const t = now();
    // Primary: sine sweep down, warm
    freqRamp('sine', 600, 320, t, 0.27, 0.2, 0.008);
    // Secondary: triangle sweep, slightly delayed and quieter
    freqRamp('triangle', 480, 260, t + 0.04, 0.22, 0.1, 0.005);
    // Soft low thud at the end — "coin drops"
    osc('sine', 140, t + 0.18, 0.08, 0.12, 0.005, 0.01, 0.0);
  },

  /**
   * Sent to jail: low muted clang (~280ms).
   * Short, not jarring. Two low tones + very brief noise burst (metallic hit).
   */
  jail() {
    const t = now();
    // Low muted clang body
    osc('square', 110, t, 0.25, 0.2, 0.003, 0.08, 0.0);
    // Softer sub-tone underneath
    osc('triangle', 82, t, 0.28, 0.15, 0.003, 0.05, 0.0);
    // Short metallic noise burst — bars clanging
    noiseBurst(t, 0.06, 0.2, 1800, 3.0, 'bandpass');
    // Quick high ring that decays fast (like metal resonance)
    osc('sine', 880, t, 0.12, 0.08, 0.003, 0.01, 0.0);
  },

  /**
   * Bankrupt: gentle downward pitch sweep (~420ms).
   * Rounded, not harsh. Two sweeping tones — dejected but soft.
   */
  bankrupt() {
    const t = now();
    // Main sine sweep: smooth, melancholy
    freqRamp('sine', 420, 80, t, 0.40, 0.18, 0.01);
    // Triangle below: adds warmth to the descent
    freqRamp('triangle', 320, 65, t + 0.04, 0.36, 0.1, 0.01);
    // Brief low noise thud at start — emphasis
    noiseBurst(t, 0.05, 0.15, 250, 1.5, 'lowpass');
  },

  /**
   * Win: bright rising arpeggio, 4 notes + chime tail (~450ms).
   * Celebratory but concise. C5 → E5 → G5 → C6 with octave shimmer.
   */
  win() {
    const t = now();
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
    const delays = [0.0, 0.1, 0.2, 0.3];
    notes.forEach((freq, i) => {
      const d = delays[i];
      // Warm triangle body
      osc('triangle', freq, t + d, 0.20, 0.28, 0.004, 0.03, 0.5);
      // Sine octave doubling for sparkle
      osc('sine', freq * 2, t + d, 0.14, 0.18, 0.003, 0.01, 0.2);
    });
    // Final bright chime ring: two close sine frequencies (beating shimmer)
    osc('sine', 2093, t + 0.32, 0.15, 0.1, 0.003, 0.01, 0.0);
    osc('sine', 2101, t + 0.32, 0.15, 0.1, 0.003, 0.01, 0.0);
  },
};

// ─── Public play API ──────────────────────────────────────────────────────────
/**
 * Synthesize and play a sound effect.
 * Safe no-op when: AudioContext absent (jsdom/SSR), muted, or unknown name.
 */
export function playSfx(name: SfxName): void {
  try {
    if (_muted) return;
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === 'suspended') return; // not yet unlocked
    const synth = SYNTHS[name];
    if (!synth) return; // unknown name — safe no-op
    synth();
  } catch { /* never throw in call sites */ }
}
