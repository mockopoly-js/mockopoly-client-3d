// WebAudio synthesized SFX — no audio asset files.
// ALL public functions are jsdom/SSR-safe: they guard every AudioContext access
// and never throw when AudioContext is absent.

export type SfxName = 'roll' | 'hop' | 'buy' | 'rent' | 'jail' | 'bankrupt' | 'win';

const MUTE_KEY = 'mockopoly_muted';

// ─── Singleton state ──────────────────────────────────────────────────────────
let ctx: AudioContext | null = null;
let _muted: boolean = false;

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

function masterGain(gain: number): GainNode {
  const g = ctx!.createGain();
  g.gain.value = gain;
  g.connect(ctx!.destination);
  return g;
}

function osc(
  type: OscillatorType,
  freq: number,
  startTime: number,
  duration: number,
  peakGain: number,
  attack = 0.005,
  release?: number,
): void {
  const rel = release ?? duration * 0.7;
  const g = ctx!.createGain();
  g.connect(ctx!.destination);
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(peakGain, startTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, startTime);
  o.connect(g);
  o.start(startTime);
  o.stop(startTime + duration + rel + 0.02);
}

function freqRamp(
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  startTime: number,
  duration: number,
  peakGain: number,
): void {
  const g = ctx!.createGain();
  g.connect(ctx!.destination);
  g.gain.setValueAtTime(peakGain, startTime);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freqStart, startTime);
  o.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);
  o.connect(g);
  o.start(startTime);
  o.stop(startTime + duration + 0.02);
}

/** Short burst of filtered white noise (for dice rattle). */
function noiseRattle(startTime: number, duration: number, gain: number): void {
  const sampleRate = ctx!.sampleRate;
  const bufLen = Math.ceil(sampleRate * duration);
  const buffer = ctx!.createBuffer(1, bufLen, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx!.createBufferSource();
  source.buffer = buffer;

  // Band-pass filter around 2–4 kHz for a "rolling dice" timbre
  const bpf = ctx!.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 3000;
  bpf.Q.value = 1.5;

  const g = ctx!.createGain();
  g.gain.setValueAtTime(gain, startTime);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  source.connect(bpf);
  bpf.connect(g);
  g.connect(ctx!.destination);

  source.start(startTime);
  source.stop(startTime + duration + 0.02);
}

// ─── Sound designs ────────────────────────────────────────────────────────────
const SYNTHS: Record<SfxName, () => void> = {
  /** Dice rattle: filtered white-noise burst ~250ms */
  roll() {
    const t = now();
    noiseRattle(t, 0.25, 0.4);
    // Add a few quick percussive clicks for "clatter"
    for (let i = 0; i < 4; i++) {
      osc('square', 180 + Math.random() * 80, t + i * 0.05, 0.04, 0.15);
    }
  },

  /** Token hop: soft sine pluck ~80ms */
  hop() {
    const t = now();
    osc('sine', 660, t, 0.08, 0.18, 0.003);
    osc('sine', 880, t, 0.06, 0.08, 0.003);
  },

  /** Property buy: two-tone rising coin ding ~300ms */
  buy() {
    const t = now();
    osc('triangle', 880, t, 0.15, 0.3, 0.005);
    osc('triangle', 1320, t + 0.1, 0.2, 0.25, 0.005);
  },

  /** Rent collected: short descending tone ~250ms */
  rent() {
    const t = now();
    freqRamp('sine', 660, 330, t, 0.25, 0.2);
  },

  /** Sent to jail: low short clang ~300ms */
  jail() {
    const t = now();
    osc('square', 120, t, 0.3, 0.25, 0.01);
    osc('triangle', 80, t, 0.35, 0.2, 0.01);
    // add a short metallic tone
    osc('sawtooth', 240, t, 0.18, 0.1, 0.005);
  },

  /** Bankrupt: downward pitch sweep ~400ms */
  bankrupt() {
    const t = now();
    freqRamp('sawtooth', 440, 55, t, 0.4, 0.2);
    freqRamp('sine', 330, 44, t + 0.05, 0.38, 0.1);
  },

  /** Win: rising 3-note arpeggio ~400ms */
  win() {
    const t = now();
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
      osc('triangle', freq, t + i * 0.12, 0.22, 0.25, 0.005);
      // octave doubling for richness
      osc('sine', freq * 2, t + i * 0.12, 0.18, 0.1, 0.005);
    });
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
