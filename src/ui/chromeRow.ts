/**
 * THE TOP-RIGHT CHROME ROW — one definition, four consumers.
 *
 * <MuteButton>, <CameraViewButton> and <FullscreenButton> are a single visual
 * row of 44px chips in the top-right corner, and <ToastLayer> has to start
 * below it. That is four files that must agree about one Y, and the last time
 * they disagreed the toast stack landed on top of the row (the reason the row
 * was pushed down to y96 in the first place). So the row's geometry lives here
 * and every consumer derives from it.
 *
 * NOT IN THE KIT. These are not design tokens — `--tap-min` and `--sa-*` are,
 * and both are used below. This is one app surface's placement, expressed in
 * the kit's own numbers, which is exactly what a call site is supposed to do.
 *
 * WHY THE ROW IS IN THE CORNER AT ALL. Persistent window chrome (sound, camera,
 * fullscreen) reads as chrome when it is ON the frame; parked at y96 it read as
 * three loose buttons hovering over the board. Transient notices can move,
 * chrome cannot, so the toast stack is the surface that yields.
 */
import { TAP_MIN, sa } from './kit';

/**
 * Top of the chip row, in VIEWPORT coordinates.
 *
 * `max(var(--sa-t), 8px)`, never `calc(env(safe-area-inset-top) + 8px)`: the
 * inset and the design pad do not stack (see kit.css §2.16). --sa-t is 0 in a
 * landscape Safari tab and ~20 in an installed PWA — this client ships
 * vite-plugin-pwa, so that second case really happens — and `max()` is what
 * makes one expression give an 8px gutter on desktop and true notch clearance
 * on device, with no branch.
 */
export const CHROME_ROW_TOP = sa('t', 8);

/** Chip edge. Square, at the Apple HIG 44x44pt tap floor. */
export const CHROME_ROW_H = TAP_MIN;

/** Right offset of the outermost (rightmost) chip. Every other chip adds its
 *  pitch ON TOP of this same expression — see CHROME_PITCH. */
export const CHROME_ROW_RIGHT = sa('r', 8);

/**
 * Centre-to-centre spacing between chips: 44px chip + 8px of dead space.
 *
 * Consumers must write `calc(${CHROME_ROW_RIGHT} + ${CHROME_PITCH * n}px)`, NOT
 * `sa('r', 8 + 52 * n)`. Those look equivalent and are not: at --sa-r 47,
 * `max(47, 8)` is 47 but `max(47, 60)` is 60, so the second chip would sit 13px
 * from the first instead of 52 — a 31px overlap. This shipped once and was
 * caught by a screenshot, not by a review.
 */
export const CHROME_PITCH = 52;

/**
 * Where a surface anchored to the SAFE BOX must start to clear this row.
 *
 * The row is positioned against the VIEWPORT (`position: fixed`), while
 * `.kit-safe` starts at `var(--sa-t)`. The difference —
 * `max(var(--sa-t), 8px) - var(--sa-t)`, i.e. `max(0, 8 - sa-t)` — is real and
 * flips with the device: 8px in a Safari tab (sa-t 0), 0 in a PWA (sa-t 20).
 * Subtracting it here is what makes the clearance below the row constant at
 * CHROME_GAP on both, instead of 8px on one and 0 on the other.
 */
const CHROME_GAP = 8;
export const BELOW_CHROME_ROW =
  `calc(${CHROME_ROW_TOP} - var(--sa-t) + ${CHROME_ROW_H + CHROME_GAP}px)`;
