import { useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import type { ToastType } from '../types/ui';
import { KIT, SafeBox, Toast, ToastStack } from './kit';
import type { KitStyle, ToastTone } from './kit';
import { BELOW_CHROME_ROW } from './chromeRow';
import { useHudStandDown } from './takeoverStage';

const TONE: Record<ToastType, ToastTone> = {
  info: 'info',
  success: 'good',
  warning: 'warn',
  error: 'bad',
};

/** A toast's full life, measured from the store's own creation timestamp. */
const LIFE_MS = 3000;
/**
 * HARD CAP. Going past it drops the oldest immediately.
 *
 * The cap was originally a geometry argument — the stack started at y 6 and a
 * third line collided with the big-moment card at y 112. Both of those numbers
 * have since moved (this stack starts below the chrome row at y 60, and the
 * card moved out of this column entirely), so the honest justification is now
 * the other half of the original one: three chattering lines are over-
 * signalling the same beat, and the server raises a toast for very nearly every
 * event it broadcasts. MEASURED at the new position, two toasts (with the
 * second wrapping to a line and a half, which is the realistic worst case) run
 * y 60..154 against a ZoneAct that starts at 265 — so the cap is a
 * signal-to-noise decision now, not a clearance one.
 */
const MAX_LIVE = 2;
/** Watchdog tick. Reaps by MEASURED AGE, never by trusting a timer. */
const SWEEP_MS = 200;
/** Grace beyond LIFE_MS before the watchdog hard-removes. */
const GRACE_MS = 400;

/**
 * Transient notices in the right column, under the chrome row and above the
 * action cluster — never over the board centre and never over the primary
 * button, because a toast that lands on the roll button turns an information
 * event into a mis-tap.
 *
 * *** GUARANTEED TEARDOWN, BY TWO INDEPENDENT MECHANISMS. ***
 * One `setTimeout` per toast is not a guarantee: a backgrounded or throttled tab
 * can defer it indefinitely and strand a notice on screen. So there is also a
 * 200ms watchdog that reaps by MEASURED AGE — `Date.now()` against the store's
 * own creation timestamp — and hard-removes anything past LIFE + 400ms. Neither
 * mechanism depends on the other, and the cap sweep runs in the same pass, so
 * nothing here can outlive its job.
 *
 * *** TOASTS STAND DOWN UNDER A TAKEOVER, AND THE THIRD OPTION IS THE ONE THAT
 * LOSES. *** This was a real judgement call, because a toast is the one thing on
 * the HUD that may be ABOUT the takeover: EVENTS.ERROR → `addToast(message,
 * 'error')` in GameStateSync is the ONLY channel a server rejection has in this
 * client, so a bid the server refuses says so here or nowhere. Three options,
 * MEASURED at 844x390 with a live takeover:
 *
 *   LEAVE IT AT --z-toast (120).  Dominated, and not by a little. The stack is
 *     x 539..789, y 60..110 — 233 of its 250px sit under the takeover's 98.5%
 *     fill and the rest under the ramp. Screenshotted, "Not enough cash to
 *     raise that bid" came through as a grey smudge at max 20/255: not legible
 *     enough to inform anyone, not faint enough to be clean. It buys no
 *     feedback and costs the surface.
 *   RAISE IT ABOVE --z-takeover (140).  This is the tempting one and the
 *     geometry kills it. The takeover's close ✕ is x 753..797, y 12..56 and the
 *     head is y 12..56 across the full 750px content box — the stack lands on
 *     BOTH. A notice would cover 36 of the ✕'s 44px and the head-right value
 *     slot beside it, which is where <TakeoverHead> pins the live high bid and
 *     the running shortfall: the single most glance-critical number on the
 *     auction and liquidation screens. Covering the exit and the live figure to
 *     deliver a 3-second notice is a worse bug than the one being fixed.
 *   STAND DOWN.  Chosen. It is the only option that is honest about what is
 *     actually readable, and it puts toasts on the same one mechanism as every
 *     other HUD-layer surface.
 *
 * THE COST, STATED: a server error raised while a takeover is up expires unseen
 * (the watchdogs keep running behind the fade, deliberately — a queue of stale
 * notices dumped on the player at close would be worse). It still reaches
 * console.error. The real fix is an error slot INSIDE the takeover surfaces,
 * which is a change to those panels and not to this one; the takeovers already
 * validate client-side (`isLegalBid`, `blockedReason`, `<Cons>`), so a server
 * rejection while one is open is a double failure, not the common path.
 *
 * <ConnectionStatus> deliberately does NOT follow this and is left untouched.
 * It renders nothing at all while connected, so it never dirties a takeover in
 * the normal case; it is persistent rather than transient, so it cannot expire
 * unseen; its pill is x 302..542, which is the one band that falls INSIDE the
 * window's transparent plateau (312..532) and therefore still reads; and what
 * it says — "Reconnecting… 47s left" — is the explanation for why the takeover
 * the player is staring at has stopped responding.
 */
export function ToastLayer() {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);
  const standDown = useHudStandDown();

  // The store uses `Date.now()` as a toast's id and `removeToast` matches on
  // it, so two toasts raised in the same millisecond ARE one id and are removed
  // together. React still needs distinct keys, and an occurrence counter inside
  // the timestamp group is stable — the whole group always leaves at once, so a
  // surviving toast never has its key shift out from under it and re-animate.
  const seen = new Map<number, number>();
  const keyed = toasts.map((t) => {
    const n = seen.get(t.timestamp) ?? 0;
    seen.set(t.timestamp, n + 1);
    return { t, key: `${t.timestamp}#${n}` };
  });
  const live = keyed.slice(-MAX_LIVE);
  const liveKey = live.map((k) => k.key).join(',');

  // Mounted-but-not-yet-lit toasts, so the entrance transition has a frame to
  // run from. A transition to a declared end state (not a filled animation)
  // cannot freeze the text half-visible.
  const [armed, setArmed] = useState('');

  // MECHANISM 1 — one timer per toast, allowing for time already served.
  useEffect(() => {
    const timers = toasts
      .slice(-MAX_LIVE)
      .map((t) => setTimeout(
        () => { removeToast(t.timestamp); },
        Math.max(0, LIFE_MS - (Date.now() - t.timestamp)),
      ));
    return () => { timers.forEach((id) => { clearTimeout(id); }); };
  }, [toasts, removeToast]);

  // MECHANISM 2 — an age watchdog that trusts no timer, plus the cap sweep.
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      // Both rules work over DISTINCT stamps: a same-millisecond burst is one
      // removable unit, so counting raw entries would reap the whole burst the
      // instant a second one landed.
      const stamps = [...new Set(useGameStore.getState().toasts.map((t) => t.timestamp))];
      stamps.forEach((ts, i) => {
        const tooOld = now - ts > LIFE_MS + GRACE_MS;
        const overCap = stamps.length - i > MAX_LIVE;
        if (tooOld || overCap) removeToast(ts);
      });
    }, SWEEP_MS);
    return () => { clearInterval(iv); };
  }, [removeToast]);

  // Arm on the next tick so the un-lit state gets a paint first. Keyed on the
  // live id list, so `armed` is replaced rather than accumulated.
  useEffect(() => {
    const t = setTimeout(() => { setArmed(liveKey); }, 0);
    return () => { clearTimeout(t); };
  }, [liveKey]);

  if (live.length === 0) return null;
  const lit = armed === liveKey;

  return (
    <div style={{ ...stage, ...standDown.style }} aria-hidden={standDown.ariaHidden}>
      <SafeBox>
        <ToastStack style={stack}>
          {live.map(({ t, key }) => (
            <Toast key={key} tone={TONE[t.type]} open={lit}>
              {t.message}
            </Toast>
          ))}
        </ToastStack>
      </SafeBox>
    </div>
  );
}

const stage: KitStyle = {
  position: 'fixed', inset: 0, zIndex: KIT.zToast, pointerEvents: 'none',
};
/**
 * `right: --badge-reserve` mirrors <ZoneAct> exactly, so the stack's right edge
 * lines up with the action cluster below it, and it is capped at the action
 * column's width (--zone-act-w, 250) so it can never reach the board centre:
 * the safe box is 750 wide at 47px insets and the centre third ends at x 547,
 * while this stack starts at 539+... — see the measured table in the report.
 *
 * *** THE STACK STARTS BELOW THE CHROME ROW, AND IT IS THE ONE THAT YIELDED. ***
 * Both surfaces want the top-right corner. Chrome (sound / camera / fullscreen)
 * is PERSISTENT and has no other honest home — it reads as chrome only when it
 * is on the frame — while a toast is a 3-second notice that can start 52px
 * lower and lose nothing. So the chrome row took the corner and this moved.
 *
 * `top` is NOT a hardcoded number. The row is `position:fixed` against the
 * VIEWPORT at `max(var(--sa-t), 8px)`, this stack is inside `.kit-safe` which
 * starts at `var(--sa-t)`, and the two frames differ by `max(0, 8px - sa-t)` —
 * 8px in a Safari tab, 0 in an installed PWA where --sa-t is ~20. Hardcoding
 * either number puts the stack 8px into the chrome row on the other device.
 * `BELOW_CHROME_ROW` does that subtraction once, next to the row it is
 * subtracting.
 */
const stack: KitStyle = {
  position: 'absolute', right: KIT.badgeReserve, top: BELOW_CHROME_ROW, width: KIT.zoneActW,
  alignItems: 'flex-end',
};
