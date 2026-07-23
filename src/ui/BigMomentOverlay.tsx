import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { formatMoney } from '../utils/format';
import type { Player } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';

interface Moment { text: string; tone: 'rent' | 'jail' | 'bankrupt' | 'parking'; id: number }
const TONE: Record<Moment['tone'], string> = { rent: '#e5533d', jail: '#e0a30a', bankrupt: '#c53a26', parking: '#46b16a' };

export function BigMomentOverlay() {
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const [moment, setMoment] = useState<Moment | null>(null);
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'A player';

  // stable id so repeated identical texts still re-key the animation
  const show = (text: string, tone: Moment['tone']) => setMoment({ text, tone, id: (moment?.id ?? 0) + 1 });

  useGameBusEvent('rent-collected', (d: { fromId: string; toId: string; amount: number }) =>
    show(`${name(d.fromId)} paid ${formatMoney(d.amount)} rent to ${name(d.toId)}`, 'rent'));
  useGameBusEvent('jail-sent', (d: { playerId: string }) => show(`${name(d.playerId)} → Jail!`, 'jail'));
  useGameBusEvent('player-bankrupt', (d: { playerId: string }) => show(`${name(d.playerId)} went bankrupt!`, 'bankrupt'));
  useGameBusEvent('free-parking-collected', (d: { playerId: string; amount: number }) =>
    show(`${name(d.playerId)} scooped ${formatMoney(d.amount)} from Free Parking!`, 'parking'));

  // auto-dismiss whenever a new moment arrives
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), 2600);
    return () => clearTimeout(t);
  }, [moment?.id]);

  if (!moment) return null;
  return (
    <div key={moment.id} style={{ ...wrap }}>
      <div style={{ ...banner, borderColor: TONE[moment.tone], color: TONE[moment.tone] }}>{moment.text}</div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: '32%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, pointerEvents: 'none',
  fontFamily: FONT_FAMILY,
};
const banner: React.CSSProperties = {
  background: '#12121e', border: '2px solid', borderRadius: 14, padding: '14px 26px',
  fontWeight: 800, fontSize: 20, textAlign: 'center', boxShadow: '0 20px 50px -16px rgba(0,0,0,.7)',
  fontVariantNumeric: 'tabular-nums', maxWidth: '80vw',
};
