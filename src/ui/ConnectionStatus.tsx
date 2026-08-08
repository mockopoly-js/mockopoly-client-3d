import { useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { KIT, Toast } from './kit';
import type { KitStyle } from './kit';

/**
 * THE RECONNECT WINDOW, made visible.
 *
 * The server holds a disconnected player's seat for 60 seconds and then drops
 * them. That window was previously invisible: this component rendered a
 * permanent top-left pill reading "Connected · <socket id>" — a debug readout,
 * shipped, in the exact spot the migrated HUD puts the turn strip — and said
 * nothing at all about how long a dropped player had left.
 *
 * It now says nothing while everything is fine, and counts down when it is not:
 *   · connected            → renders nothing.
 *   · disconnected, no room → "Connecting to the server…". There is no seat to
 *                             lose yet, so there is no clock to run.
 *   · disconnected, in room → "Reconnecting… 47s" against the real window, then
 *                             "Seat lost" when it runs out.
 *
 * PLACEMENT. Top centre, at the toast layer, `pointer-events: none`. Read-only
 * information may never eat a tap, and during a disconnect this is the most
 * important thing on the screen, so it takes the one band nothing else owns
 * outright (the turn strip runs from the left, toasts stack on the right).
 */

/** Mirrors the server's RECONNECT_WINDOW. */
const RECONNECT_WINDOW_S = 60;

interface Props {
  connected: boolean;
  /**
   * The connect-ack id. NOT displayed: it is `socket.id`, a transport handle
   * that changes on every reconnect and is not the player's identity. It stays
   * in the contract because App.tsx passes it.
   */
  playerId: string | null;
}

export function ConnectionStatus({ connected }: Props) {
  const inRoom = useGameStore((s) => s.roomCode !== null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (connected) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    // Wall-clock, not a tick counter: a backgrounded tab throttles setInterval
    // to once a minute, and a counter would report 3s left after a real 60.
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => { clearInterval(id); };
  }, [connected]);

  if (connected) return null;

  const left = Math.max(0, RECONNECT_WINDOW_S - elapsed);
  const expired = inRoom && left === 0;

  return (
    <div style={stage}>
      <div style={slot}>
        <Toast open tone={expired ? 'bad' : 'warn'} style={cap}>
          <span role="alert" style={line}>
            {!inRoom
              ? 'Connecting to the server…'
              : expired
                ? 'Seat lost — please rejoin'
                : `Reconnecting… ${left}s left`}
          </span>
        </Toast>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

/**
 * Its own fixed stage: App mounts this as a bare sibling, and the kit's
 * surfaces are `position:absolute`. Two fixed stages cannot be ordered by an
 * inner z-index, so the STAGE carries the toast layer.
 */
const stage: KitStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: KIT.zToast,
  pointerEvents: 'none',
};

const slot: KitStyle = {
  position: 'absolute',
  top: 6,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  justifyContent: 'center',
};

/**
 * 240, not the toast's own 300. Centred on the viewport, a 300px pill reaches
 * x 572 and lands on the right interactive column, which starts at 547. At 240
 * it stops at 542 and clears it.
 *
 * IN GAME IT STILL CROSSES THE TURN STRIP, and that is the right trade: the top
 * band has no free centre (the strip runs from the left, the toast stack from
 * x 539), and a stale turn readout matters less than a closing reconnect
 * window. The pill is `pointer-events: none`, so the overlap can never cost a tap.
 */
const cap: KitStyle = { maxWidth: 240 };

const line: KitStyle = { fontVariantNumeric: 'tabular-nums' };
