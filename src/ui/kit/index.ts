/**
 * MOCKOPOLY UI KIT — public API.
 *
 *     import { Button, Panel, Money, KIT, TYPE, sa } from '../ui/kit';
 *
 * `kit.css` is imported once from `src/main.tsx`, so the tokens and primitive
 * classes are always present at runtime; importing from here never pulls CSS
 * into a test or a lazy chunk.
 *
 * THE FIVE HARD RULES are documented in full at the top of kit.css. In short:
 *   R1  no child may overhang a clipping ancestor — that is what <FxClip> is for
 *   R2  entrance animations travel INWARD
 *   R3  never use opacity to de-emphasise text — use colour
 *   R4  filled animations animate transform, never opacity
 *   R5  no nested backdrop-filter
 * `kit.rules.test.ts` fails the build on R3 and R4 violations, and <BlurScope>
 * enforces R5 at runtime.
 */

// ── tokens ──────────────────────────────────────────────────────────────────
export {
  KIT, TYPE, CAPS, NUM, LEGIBLE,
  TAP_MIN, TAP_PRIMARY, TAP_LG, TAP_GAP, ROW_PAD, BADGE_RESERVE,
  PANEL_W, PANEL_W_NARROW, PANEL_W_WIDE, BTN_W_PRIMARY, DEED_ROW, TYPE_FLOOR_PX,
  FS_PX, SP_PX, SA_PX, DUR_MS, Z,
  sa, turnStyle, playerStyle, groupStyle, groupColor, withVars,
} from './tokens';
export type { KitStyle } from './tokens';

export { cx } from './cx';
export { splitMoney } from './splitMoney';
export type { MoneyParts } from './splitMoney';
export { BlurScopeContext, useBlurScope } from './blurScope';

// ── layout ──────────────────────────────────────────────────────────────────
export { SafeBox, ZoneRead, ZoneAct, ZoneMid, ZoneTop, BtnRow, Actions, FxClip, Rule } from './Layout';

// ── controls ────────────────────────────────────────────────────────────────
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ClockState } from './Button';
export { Arm } from './Arm';
export type { ArmProps } from './Arm';
export { Hold } from './Hold';
export type { HoldProps } from './Hold';
export { Field, CodeInput } from './Field';
export type { FieldProps, CodeInputProps } from './Field';
export { Stepper, Slider, Switch, Segs } from './Controls';
export type { StepperProps, SliderProps, SwitchProps, SegsProps, SegOption } from './Controls';

// ── surfaces ────────────────────────────────────────────────────────────────
export { Panel } from './Panel';
export type { PanelProps } from './Panel';
export { Takeover, TakeoverCol, TakeoverRule } from './Takeover';
export type { TakeoverProps } from './Takeover';

// ── display ─────────────────────────────────────────────────────────────────
export { Badge, Dot } from './Badge';
export type { BadgeProps, BadgeTone, DotProps } from './Badge';
export { Money, Delta } from './Money';
export type { MoneyProps, MoneySize, MoneyTone } from './Money';
export { Pod } from './Pod';
export type { PodProps } from './Pod';
export { SetPips, SetCap } from './SetPips';
export type { SetPipsProps } from './SetPips';
export { Deed, DeedRowView } from './Deed';
export type { DeedProps, DeedRow, DeedMeta } from './Deed';
export { Toast, ToastStack } from './Toast';
export type { ToastProps, ToastTone } from './Toast';
export { EventLog } from './EventLog';
export type { EventLogProps, EventLogItem } from './EventLog';
export { TurnStrip } from './TurnStrip';
export type { TurnStripProps } from './TurnStrip';
export { Meter } from './Meter';
export type { MeterProps } from './Meter';

// ── brand / lobby (off-board screens only) ──────────────────────────────────
export { Wordmark, LiveDot, Plinth } from './Brand';
