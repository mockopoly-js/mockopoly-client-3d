import { KIT } from './kit';
import type { KitStyle } from './kit';
import { HudButtons } from './HudButtons';

interface ActionsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Overflow menu for the three negotiation actions, opened by the ⋯ button in
 * the bottom-right cluster.
 *
 * WHY A POPOVER AND NOT A <Panel>. The kit's right slide-in panel is the detail
 * surface — a deed, a mortgage ladder, a portfolio. Three buttons do not earn
 * 392px and a scrim over half the board. This is a small anchored surface built
 * from the same tokens (surface-panel + ring-hair + shadow-3 + r-lg) with the
 * kit's own bottom-anchored inward entrance.
 *
 * POSITIONING CONTRACT: it must be rendered as a child of <ZoneAct>, which is
 * `position:absolute` and does not clip. `bottom:100%` anchors it directly above
 * the cluster WITHOUT joining the cluster's flex flow, so opening it cannot move
 * the primary button by a pixel — the tap target under the thumb never moves.
 *
 * NOT a kit <Panel>, so conditional rendering is correct here: there is no
 * mounted-while-closed exit transition to preserve.
 *
 * NO TAKEOVER STAND-DOWN OF ITS OWN, AND THAT IS DELIBERATE. Every other
 * HUD-layer surface calls `useHudStandDown()` because each is its own
 * `position:fixed` stage that inherits nothing from any other. This one is not:
 * the positioning contract above puts it inside <ZoneAct>, inside TurnHud's
 * stage, which already yields. `opacity: 0` on that ancestor composites this
 * whole subtree — including the `position:fixed` scrim, which an opacity
 * stacking context still paints inside — and the inherited `visibility: hidden`
 * takes the scrim out of hit-testing, so the tap-catcher cannot swallow a tap
 * meant for the takeover. Adding a second flag here would be a second mechanism
 * for one surface, and it would double-fade. The sheet stays OPEN underneath
 * and is exactly where the thumb left it when the takeover closes.
 */
export function ActionsSheet({ open, onClose }: ActionsSheetProps) {
  if (!open) return null;

  return (
    <>
      {/* Transparent full-viewport tap-catcher. Below the sheet, above the HUD. */}
      <div style={scrim} onClick={onClose} aria-hidden="true" />
      <div style={sheet} className="kit-in-bottom" role="menu" aria-label="More actions">
        <HudButtons inline onPick={onClose} />
      </div>
    </>
  );
}

/**
 * No z-index on purpose. Every kit button is `position:relative`, so within
 * <ZoneAct>'s stacking context the cluster paints in tree order — this scrim is
 * the FIRST child, so the sheet and the buttons after it stay tappable and
 * everything else falls through to the dismiss.
 */
const scrim: KitStyle = {
  position: 'fixed', inset: 0, background: 'transparent', pointerEvents: 'auto',
};

const sheet: KitStyle = {
  position: 'absolute', right: 0, bottom: '100%', marginBottom: KIT.tapGap,
  display: 'flex', flexDirection: 'column',
  padding: KIT.sp3, borderRadius: KIT.rLg,
  background: KIT.surfacePanel,
  boxShadow: `${KIT.ringHair}, ${KIT.shadow3}`,
  pointerEvents: 'auto',
};
