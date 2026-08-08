import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import { Actions, Button, Dot, KIT } from './kit';
import type { KitStyle } from './kit';
import { useActionBadges } from './useActionBadges';

interface HudButtonsProps {
  /**
   * REQUIRED to render. See the note below — a bare `<HudButtons />` draws
   * nothing on purpose.
   */
  inline?: boolean;
  /** Called after a panel is opened, so a host popover can close itself. */
  onPick?: () => void;
}

/**
 * The three negotiation actions — Trade / Partnership / Deal — as an
 * unpositioned kit cluster with their attention dots, plus a fourth,
 * conditional RAISE CASH action that opens <BankruptcyPanel>'s liquidation
 * flow. Unlike the other three, RAISE CASH does not render at all outside
 * debt (turn.mustPayRent for me) — there is no disabled state for it.
 *
 * WHY IT RENDERS NOTHING WITHOUT `inline`.
 * The old component was a fixed bottom-LEFT sidebar on desktop and `null` on
 * mobile, and it duplicated its three buttons and all four badge derivations
 * inside ActionsSheet. Both are wrong under the kit: bottom-left is the worst
 * quadrant on a landscape phone and the left column is read-only by design, so
 * a primary interaction may not live there. These three are now overflow
 * actions reached from the ⋯ button in the bottom-right cluster, and this is
 * their single definition — <ActionsSheet> renders `<HudButtons inline />`.
 *
 * App.tsx USED TO mount a bare `<HudButtons />` as a top-level sibling. That
 * mount was a no-op left over from the sidebar version and has been removed;
 * <ActionsSheet> is now the only call site. The `inline` guard stays as the
 * guard rail that made the leftover harmless in the first place: without a
 * positioned host this cluster would drop three buttons at the top-left of the
 * document, so it renders nothing rather than render them in the wrong place.
 */
export function HudButtons({ inline = false, onPick }: HudButtonsProps) {
  const trade = useGameStore((s) => s.toggleTradePanel);
  const partnership = useGameStore((s) => s.togglePartnershipPanel);
  const deal = useGameStore((s) => s.toggleDealPanel);
  // Same debt gate App.tsx uses to auto-open <DealPanel> (turn.mustPayRent &&
  // I am the player on the hook). RAISE CASH is the manual alternative to
  // negotiating a deal, NOT an auto-open — <BankruptcyPanel> deliberately does
  // not open itself on this condition, because two takeovers fighting over
  // one debt is worse than none. It must not render at all outside debt —
  // no disabled button sitting in the sheet for no reason.
  const inDebt = useGameStore(
    (s) => !!(s.state?.turn.mustPayRent && s.state.turn.currentPlayerId === s.myPlayerId),
  );
  const badges = useActionBadges();

  if (!inline) return null;

  const pick = (open: (show?: boolean) => void) => () => {
    open(true);
    onPick?.();
  };

  const raiseCash = () => {
    gameBus.emit('open-liquidation');
    onPick?.();
  };

  return (
    <Actions style={stretch}>
      <div style={row}>
        <Button block label="Trade" onClick={pick(trade)} />
        {badges.trade && <Dot tone="danger" pin pulse />}
      </div>
      <div style={row}>
        <Button block label="Partnership" onClick={pick(partnership)} />
        {badges.partnership && <Dot tone="danger" pin pulse />}
      </div>
      <div style={row}>
        <Button block label="Deal" onClick={pick(deal)} />
        {badges.deal && <Dot tone="danger" pin pulse />}
      </div>
      {inDebt && (
        <div style={row}>
          <Button block label="Raise Cash" onClick={raiseCash} />
          <Dot tone="danger" pin pulse />
        </div>
      )}
    </Actions>
  );
}

const stretch: KitStyle = { alignItems: 'stretch', width: '100%' };
/**
 * The dot is `position:absolute` and OVERHANGS its anchor by 2px (rule R1), so
 * this wrapper must not clip — it sets `position` and nothing else.
 */
const row: KitStyle = { position: 'relative', display: 'flex', minWidth: KIT.btnWPrimary };
