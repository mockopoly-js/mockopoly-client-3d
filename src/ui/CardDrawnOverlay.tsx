import { useEffect, useState } from 'react';
import { useGameBusEvent } from '../state/useGameBus';
import { KIT } from './kit';
import type { KitStyle } from './kit';
import type { S_CardDrawn } from '../types/SocketEvents';

/**
 * Chance / Community-Chest reveal: a dimmed backdrop and a centred cream card
 * with a coloured header, held for the server's ANIMATION_CARD_REVEAL_MS.
 *
 * DELIBERATELY NOT A KIT SURFACE. Every other overlay in this HUD is dark glass
 * because it is chrome sitting on the world; this one is a physical object being
 * shown to the table, and reading as a real card is the whole point. What it
 * does take from the kit is the geometry and the type scale (17px header, 15px
 * body, --r-lg, --shadow-4, --z-takeover) so it is sized like everything else,
 * and the deck colours stay hard-coded because they are DATA — the same class of
 * value as TOKEN_HEX, not a design decision.
 *
 * ENTRANCE IS TRANSFORM-ONLY. The previous version animated opacity with
 * `both`, so a throttled frame could freeze the card half-visible over the
 * board; the fade is now a transition to a declared end state, which cannot.
 *
 * GUARANTEED TEARDOWN by two independent mechanisms: a per-draw timer AND a
 * 200ms watchdog that clears by measured age.
 */

const HOLD_MS = 2500; // ANIMATION_CARD_REVEAL_MS
const SWEEP_MS = 200;
const GRACE_MS = 400;

const CHANCE = '#f39c12';
const COMMUNITY = '#3498db';

interface Draw {
  deck: 'chance' | 'community-chest';
  title: string;
  description: string;
  header: string;
  id: number;
  bornAt: number;
}

export function CardDrawnOverlay() {
  const [draw, setDraw] = useState<Draw | null>(null);

  useGameBusEvent('card-drawn', (d: S_CardDrawn) => {
    // gameBus is untyped at the emit site, so guard the payload defensively even
    // though the S_CardDrawn contract types these fields as required.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- payload arrives over an untyped bus; guard against a missing deck
    if (!d.deck) return;
    const isChance = d.deck === 'chance';
    setDraw((prev) => ({
      deck: d.deck,
      title: isChance ? 'CHANCE' : 'COMMUNITY CHEST',
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- untyped bus payload: card/description may be absent
      description: d.card?.description ?? '',
      header: isChance ? CHANCE : COMMUNITY,
      id: (prev?.id ?? 0) + 1,
      bornAt: Date.now(),
    }));
  });

  useEffect(() => {
    if (!draw) return;
    const id = draw.id;
    const clear = () => { setDraw((cur) => (cur?.id === id ? null : cur)); };
    const timer = setTimeout(clear, HOLD_MS);
    const sweep = setInterval(() => {
      if (Date.now() - draw.bornAt > HOLD_MS + GRACE_MS) clear();
    }, SWEEP_MS);
    return () => { clearTimeout(timer); clearInterval(sweep); };
  }, [draw]);

  if (!draw) return null;

  return (
    <div style={backdrop} aria-live="polite">
      <style>{KEYFRAMES}</style>
      <div key={draw.id} style={card}>
        <div style={{ ...header, background: draw.header }}>{draw.title}</div>
        <div style={body}>{draw.description}</div>
      </div>
    </div>
  );
}

/** Transform only — no opacity, so a frozen frame can never strand it. */
const KEYFRAMES = `
@keyframes cardDrawnPop {
  0%   { transform: scale(0.86) rotateY(48deg); }
  62%  { transform: scale(1.03) rotateY(0deg); }
  100% { transform: scale(1) rotateY(0deg); }
}`;

const backdrop: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zTakeover,
  display: 'grid', placeItems: 'center',
  background: KIT.surfaceScrim, pointerEvents: 'none', fontFamily: KIT.font,
};

const card: KitStyle = {
  width: 'min(300px, 60vw)', minHeight: 168, maxHeight: '80dvh',
  background: '#f5f0e1', color: '#12121e',
  borderRadius: KIT.rLg, overflow: 'hidden', boxShadow: KIT.shadow4,
  animation: `cardDrawnPop var(--dur-scene) var(--ease-celebrate)`,
  transformOrigin: 'center', display: 'flex', flexDirection: 'column',
};

const header: KitStyle = {
  color: '#fff', fontWeight: 800, fontSize: 17, lineHeight: 1.08,
  letterSpacing: KIT.lsWider, textTransform: 'uppercase',
  textAlign: 'center', padding: `${KIT.sp3} ${KIT.sp4}`,
};

const body: KitStyle = {
  flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center',
  padding: `${KIT.sp4} ${KIT.sp5}`,
  fontSize: 15, fontWeight: 600, lineHeight: 1.38,
};
