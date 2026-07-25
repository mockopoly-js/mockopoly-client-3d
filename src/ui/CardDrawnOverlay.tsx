import React, { useEffect, useState } from 'react';
import { useGameBusEvent } from '../state/useGameBus';
import { FONT_FAMILY } from '../constants/fonts';
import type { S_CardDrawn } from '../types/SocketEvents';

// ─── CardDrawnOverlay ────────────────────────────────────────────────────────
// Chance / Community-Chest reveal, mirroring the 2D `CardDisplay` object:
// full-screen 50%-dim backdrop + a centered cream card with a colored header
// strip (ORANGE for Chance, BLUE for Community Chest), the card `description`
// in the body, a scale/flip pop-in, then auto-dismiss after 2500 ms (matches
// the server `ANIMATION_CARD_REVEAL_MS`). Non-blocking (backdrop ignores
// pointer events); rapid consecutive draws reset the dismiss timer.

const HOLD_MS = 2500; // ANIMATION_CARD_REVEAL_MS

const CHANCE = '#f39c12';
const COMMUNITY = '#3498db';

interface Draw {
  deck: 'chance' | 'community-chest';
  title: string;
  description: string;
  header: string;
  id: number;
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
    }));
  });

  // Auto-dismiss; re-armed whenever a new draw arrives. `draw` is only ever
  // replaced with a fresh object carrying an incremented id, so depending on the
  // whole `draw` re-arms the timer exactly once per draw (same as keying on id).
  useEffect(() => {
    if (!draw) return;
    if (typeof window === 'undefined') return;
    const t = window.setTimeout(() => setDraw(null), HOLD_MS);
    return () => window.clearTimeout(t);
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

const KEYFRAMES = `
@keyframes cardDrawnPop {
  0%   { transform: scale(0.2) rotateY(90deg); opacity: 0; }
  60%  { transform: scale(1.04) rotateY(0deg); opacity: 1; }
  100% { transform: scale(1) rotateY(0deg); opacity: 1; }
}`;

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 55, display: 'grid', placeItems: 'center',
  background: 'rgba(0,0,0,.5)', pointerEvents: 'none', fontFamily: FONT_FAMILY,
};

const card: React.CSSProperties = {
  width: 300, minHeight: 200, background: '#f5f0e1', color: '#1a1a2e',
  borderRadius: 14, overflow: 'hidden', boxShadow: '0 28px 70px -20px rgba(0,0,0,.75)',
  animation: 'cardDrawnPop 380ms cubic-bezier(.2,.9,.3,1.2) both',
  transformOrigin: 'center', display: 'flex', flexDirection: 'column',
};

const header: React.CSSProperties = {
  color: '#fff', fontWeight: 800, fontSize: 18, letterSpacing: '.04em',
  textAlign: 'center', padding: '12px 16px',
};

const body: React.CSSProperties = {
  flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center',
  padding: '20px 22px', fontSize: 16, fontWeight: 600, lineHeight: 1.35,
};
