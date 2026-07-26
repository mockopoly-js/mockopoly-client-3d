import { useGameStore, selectIsMyTurn } from '../state/gameStore';

/**
 * Attention badges for the three secondary negotiation actions. Mirrors the
 * derivations HudButtons uses on desktop so the mobile ⋯ sheet (and the ⋯
 * trigger's aggregate dot) light up for the same incoming events. All guarded —
 * a dot only shows when the underlying data is actually present.
 */
export interface ActionBadges {
  trade: boolean;
  partnership: boolean;
  deal: boolean;
  any: boolean;
}

export function useActionBadges(): ActionBadges {
  const myId = useGameStore((s) => s.myPlayerId);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const activeTrade = useGameStore((s) => s.state?.activeTrade);
  const proposal = useGameStore((s) => s.state?.activePartnershipProposal);
  const activeRentDeal = useGameStore((s) => s.state?.activeRentDeal);
  const mustPayRent = useGameStore((s) => s.state?.turn.mustPayRent ?? false);

  const trade = !!(activeTrade && myId && activeTrade.toPlayerId === myId && activeTrade.status === 'pending');
  const partnership = !!(proposal && myId &&
    proposal.status === 'pending' &&
    proposal.initiatorId !== myId &&
    proposal.proposedEquity.some((e) => e.playerId === myId) &&
    !proposal.acceptedPlayerIds.includes(myId));
  const deal = !!(
    (mustPayRent && isMyTurn) ||
    (activeRentDeal && myId && activeRentDeal.status === 'pending' &&
      activeRentDeal.lastOfferBy !== myId &&
      (activeRentDeal.creditorIds.includes(myId) || activeRentDeal.debtorId === myId))
  );

  return { trade, partnership, deal, any: trade || partnership || deal };
}
