import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import type { GameLogEntry } from '../types/GameState';
import { EventLog, KIT, SafeBox, ZoneRead } from './kit';
import type { EventLogItem, KitStyle } from './kit';
import { HUD_TOGGLE_LOG } from './TurnHud';
import { useHudStandDown } from './takeoverStage';

/**
 * The event channel — a collapsed last-event strip that expands to the history.
 *
 * *** IT GROWS FROM A BOTTOM-PINNED ANCHOR. ***
 * `.kit-eventlog__list` is a following sibling of the peek row, so it grows
 * DOWNWARD, and a log pinned to the bottom-left grows straight through the
 * bottom safe inset. `column-reverse` puts the list ABOVE the peek and `bottom:0`
 * pins the peek's own box: the 44px tap target does not move by a pixel when the
 * log opens, the history grows up into free space, and no second tap target ever
 * appears in the worst quadrant on the device.
 *
 * OPAQUE WHEN OPEN, not glass. Expanded, the list covers the pod band and the
 * set strip; at 78% glass the pods ghost through behind 13px log copy.
 *
 * Two routes in, neither of which moves: this peek row, and the LOG button in
 * the bottom-right cluster (which arrives over the game bus, because App.tsx
 * mounts the two components as unrelated siblings).
 */
const MAX_ENTRIES = 8;

export function GameLog() {
  const log: GameLogEntry[] = useGameStore((s) => s.state?.log) ?? [];
  const [open, setOpen] = useState(false);
  // Yields to a takeover like every other HUD-layer surface — and this one
  // matters twice over when EXPANDED, because the open list is an opaque
  // 212px panel of 13px copy sitting in the bottom-left. It stays open
  // underneath and is exactly where it was when the takeover closes.
  const standDown = useHudStandDown();

  useGameBusEvent(HUD_TOGGLE_LOG, () => { setOpen((o) => !o); });

  if (log.length === 0) return null;

  // MEASURED in the mockup: the open list is capped at 212px and an item is
  // 25.4px at one line, so nine entries scroll and silently cut the tail.
  const items: EventLogItem[] = log
    .slice(-MAX_ENTRIES)
    .reverse()
    .map((e, i) => ({
      id: `${e.timestamp}-${i}`,
      time: clock(e.timestamp),
      text: e.message,
      fresh: i === 0,
    }));

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <SafeBox>
        <ZoneRead>
          <EventLog
            items={items}
            open={open}
            onOpenChange={setOpen}
            style={open ? { ...anchored, ...anchoredOpen } : anchored}
          />
        </ZoneRead>
      </SafeBox>
    </div>
  );
}

/** "21:07". Explicit 24h so the 34px time slot is stable in every locale. */
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** Sits at --z-toast, the layer the system already reserves for "toasts, event
 *  log expanded": open, it OVERLAYS the pods and set strip rather than
 *  displacing them. */
const stage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zToast, pointerEvents: 'none',
};
const anchored: KitStyle = {
  position: 'absolute', left: 0, right: 0, bottom: 0, width: 'auto',
  display: 'flex', flexDirection: 'column-reverse',
  // Applied OPEN AND CLOSED so the peek's text never shifts, and it satisfies
  // --row-pad for the full-bleed item rows.
  paddingInline: KIT.rowPad,
  borderRadius: KIT.rMd,
};
const anchoredOpen: KitStyle = {
  background: KIT.surfacePanel,
  boxShadow: `${KIT.ringHair}, ${KIT.shadow3}`,
};
