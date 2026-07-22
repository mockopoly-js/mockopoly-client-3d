import { useState } from 'react';
import { useGameBusEvent } from '../state/useGameBus';

// pip layout per die value (3x3 grid cells that are filled)
const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die({ value }: { value: number }) {
  const on = new Set(PIPS[value] ?? []);
  return (
    <div data-die role="img" aria-label={`die showing ${value}`} style={dieStyle}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} style={{ ...pipStyle, opacity: on.has(i) ? 1 : 0 }} />
      ))}
    </div>
  );
}

export function DiceDisplay() {
  const [dice, setDice] = useState<[number, number] | null>(null);
  useGameBusEvent('dice-rolled', (d: { dice: [number, number] }) => setDice(d.dice));
  if (!dice) return null;
  return (
    <div style={wrap}>
      <Die value={dice[0]} />
      <Die value={dice[1]} />
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)',
  display: 'flex', gap: 12, pointerEvents: 'none', zIndex: 20,
};
const dieStyle: React.CSSProperties = {
  width: 46, height: 46, background: '#fffdf8', borderRadius: 10,
  display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3, padding: 7,
  boxShadow: '0 8px 20px -6px rgba(0,0,0,.5)',
};
const pipStyle: React.CSSProperties = {
  width: 8, height: 8, borderRadius: '50%', background: '#3b3224', alignSelf: 'center', justifySelf: 'center',
};
