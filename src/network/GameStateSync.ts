import { socketManager } from './SocketManager';
import { useGameStore } from '../state/gameStore';
import { gameBus } from '../state/gameBus';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import type { DevHacks } from '../types/GameState';
import type {
  S_StateUpdate, S_DiceRolled, S_PlayerMoved, S_Landed,
  S_TurnStarted, S_CardDrawn, S_JailSent, S_JailReleased,
  S_PropertyBought, S_RentCollected, S_AuctionStart,
  S_HouseAdded, S_HotelAdded, S_HouseSold, S_HotelSold,
  S_PlayerBankrupt, S_GameOver, S_PlayerDisconnected, S_PlayerReconnected,
  S_RoomCreated, S_RoomJoined, S_RoomRejected, S_Countdown,
  S_Error,
  S_FreeParkingCollected, S_GoDeducted,
  S_PartnershipProposed, S_PartnershipProposalAccepted,
  S_PartnershipProposalRejected, S_PartnershipProposalCancelled,
  S_PartnershipFormed, S_PartnershipDissolveRequested,
  S_PartnershipDissolveAccepted, S_PartnershipDissolveRejected,
  S_PartnershipDissolved, S_PartnershipRentSplit, S_PartnershipBuildCostSplit,
  S_DealOffered, S_DealCountered, S_DealAccepted,
  S_DealRejected, S_DealCompleted, S_DealCancelled,
} from '../types/SocketEvents';

// ─── Game State Sync ─────────────────────────────────────────────────────────
// Listens for server events, writes durable state into the zustand store, and
// relays transient animation/UI events onto gameBus. (Was Phaser-emitter based.)

class GameStateSync {
  private registered = false;

  register(): void {
    if (this.registered) return;
    this.registered = true;

    const store = () => useGameStore.getState();

    // ── Core state sync ───────────────────────────────────────────────────────
    socketManager.on(EVENTS.GAME_STATE_UPDATE, (data: S_StateUpdate) => {
      store().update(data.state);
    });

    // ── Room / Lobby events ─────────────────────────────────────────────────
    socketManager.on(EVENTS.ROOM_CREATED, (data: S_RoomCreated) => {
      gameBus.emit('room-created', data);
      this.restoreDevHacks();
    });
    socketManager.on(EVENTS.ROOM_JOINED, (data: S_RoomJoined) => {
      gameBus.emit('room-joined', data);
      this.restoreDevHacks();
    });
    socketManager.on(EVENTS.ROOM_REJECTED, (data: S_RoomRejected) => {
      gameBus.emit('room-rejected', data);
    });
    socketManager.on(EVENTS.ROOM_COUNTDOWN, (data: S_Countdown) => {
      gameBus.emit('countdown', data);
    });

    // ── Animation events ──────────────────────────────────────────────────────
    socketManager.on(EVENTS.TURN_DICE_ROLLED, (data: S_DiceRolled) => {
      gameBus.emit('dice-rolled', data);
    });
    socketManager.on(EVENTS.TURN_PLAYER_MOVED, (data: S_PlayerMoved) => {
      gameBus.emit('player-moved', data);
    });
    socketManager.on(EVENTS.TURN_LANDED, (data: S_Landed) => {
      gameBus.emit('player-landed', data);
    });
    socketManager.on(EVENTS.TURN_STARTED, (data: S_TurnStarted) => {
      gameBus.emit('turn-started', data);
    });
    socketManager.on(EVENTS.CARD_DRAWN, (data: S_CardDrawn) => {
      gameBus.emit('card-drawn', data);
    });

    // ── Jail ──────────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.JAIL_SENT, (data: S_JailSent) => {
      gameBus.emit('jail-sent', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} was sent to Jail!`, 'warning');
    });
    socketManager.on(EVENTS.JAIL_RELEASED, (data: S_JailReleased) => {
      gameBus.emit('jail-released', data);
    });

    // ── Property ──────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.PROPERTY_BOUGHT, (data: S_PropertyBought) => {
      gameBus.emit('property-bought', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} bought a property!`, 'success');
    });
    socketManager.on(EVENTS.PROPERTY_RENT_COLLECTED, (data: S_RentCollected) => {
      gameBus.emit('rent-collected', data);
    });
    socketManager.on(EVENTS.PROPERTY_AUCTION_START, (data: S_AuctionStart) => {
      gameBus.emit('auction-start', data);
      store().addToast('Auction started!', 'info');
    });

    // ── Building ────────────────────────────────────────────────────────
    socketManager.on(EVENTS.BUILD_HOUSE_ADDED, (data: S_HouseAdded) => {
      gameBus.emit('house-added', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} built a house!`, 'success');
    });
    socketManager.on(EVENTS.BUILD_HOTEL_ADDED, (data: S_HotelAdded) => {
      gameBus.emit('hotel-added', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} built a hotel!`, 'success');
    });
    socketManager.on(EVENTS.BUILD_HOUSE_SOLD, (data: S_HouseSold) => {
      gameBus.emit('house-sold', data);
    });
    socketManager.on(EVENTS.BUILD_HOTEL_SOLD, (data: S_HotelSold) => {
      gameBus.emit('hotel-sold', data);
    });

    // ── Bankruptcy / Game Over ────────────────────────────────────────────────
    socketManager.on(EVENTS.PLAYER_BANKRUPT, (data: S_PlayerBankrupt) => {
      gameBus.emit('player-bankrupt', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} went bankrupt!`, 'error');
    });
    socketManager.on(EVENTS.GAME_OVER, (data: S_GameOver) => {
      gameBus.emit('game-over', data);
    });

    // ── Connection ────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.GAME_PLAYER_DISCONNECTED, (data: S_PlayerDisconnected) => {
      gameBus.emit('player-disconnected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} disconnected`, 'warning');
    });
    socketManager.on(EVENTS.GAME_PLAYER_RECONNECTED, (data: S_PlayerReconnected) => {
      gameBus.emit('player-reconnected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} reconnected!`, 'success');
    });

    // ── Free Parking ──────────────────────────────────────────────────────────
    socketManager.on(EVENTS.FREE_PARKING_COLLECTED, (data: S_FreeParkingCollected) => {
      gameBus.emit('free-parking-collected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} collected ${formatMoney(data.amount)} from Free Parking!`, 'success');
    });

    // ── GO Deduction ────────────────────────────────────────────────────────
    socketManager.on(EVENTS.LOAN_GO_DEDUCTED, (data: S_GoDeducted) => {
      gameBus.emit('go-deducted', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} took a GO advance of ${formatMoney(data.amount)}`, 'warning');
    });

    // ── Partnerships ────────────────────────────────────────────────────────
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSED, (data: S_PartnershipProposed) => {
      gameBus.emit('partnership-proposed', data);
      const initiator = store().state?.players.find(p => p.id === data.proposal.initiatorId);
      if (initiator) store().addToast(`${initiator.name} proposed a partnership on ${data.proposal.colorGroup}`, 'info');
    });
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSAL_ACCEPTED, (data: S_PartnershipProposalAccepted) => {
      gameBus.emit('partnership-proposal-accepted', data);
    });
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSAL_REJECTED, (data: S_PartnershipProposalRejected) => {
      gameBus.emit('partnership-proposal-rejected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} rejected the partnership proposal`, 'warning');
    });
    socketManager.on(EVENTS.PARTNERSHIP_PROPOSAL_CANCELLED, (_data: S_PartnershipProposalCancelled) => {
      gameBus.emit('partnership-proposal-cancelled', _data);
      store().addToast('Partnership proposal cancelled', 'info');
    });
    socketManager.on(EVENTS.PARTNERSHIP_FORMED, (data: S_PartnershipFormed) => {
      gameBus.emit('partnership-formed', data);
      store().addToast(`Partnership formed on ${data.partnership.colorGroup}!`, 'success');
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVE_REQUESTED, (data: S_PartnershipDissolveRequested) => {
      gameBus.emit('partnership-dissolve-requested', data);
      const requester = store().state?.players.find(p => p.id === data.requesterId);
      if (requester) store().addToast(`${requester.name} requested partnership dissolution`, 'warning');
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVE_ACCEPTED, (data: S_PartnershipDissolveAccepted) => {
      gameBus.emit('partnership-dissolve-accepted', data);
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVE_REJECTED, (data: S_PartnershipDissolveRejected) => {
      gameBus.emit('partnership-dissolve-rejected', data);
      const player = store().state?.players.find(p => p.id === data.playerId);
      if (player) store().addToast(`${player.name} rejected dissolution`, 'warning');
    });
    socketManager.on(EVENTS.PARTNERSHIP_DISSOLVED, (data: S_PartnershipDissolved) => {
      gameBus.emit('partnership-dissolved', data);
      store().addToast('Partnership dissolved!', 'info');
    });
    socketManager.on(EVENTS.PARTNERSHIP_RENT_SPLIT, (data: S_PartnershipRentSplit) => {
      gameBus.emit('partnership-rent-split', data);
    });
    socketManager.on(EVENTS.PARTNERSHIP_BUILD_COST_SPLIT, (data: S_PartnershipBuildCostSplit) => {
      gameBus.emit('partnership-build-cost-split', data);
    });

    // ── Rent Deals ──────────────────────────────────────────────────────────
    socketManager.on(EVENTS.DEAL_OFFERED, (data: S_DealOffered) => {
      gameBus.emit('deal-offered', data);
      const debtor = store().state?.players.find(p => p.id === data.deal.debtorId);
      if (debtor) store().addToast(`${debtor.name} proposed a rent deal`, 'info');
      const myId = store().myPlayerId;
      if (myId && data.deal.creditorIds.includes(myId)) {
        gameBus.emit('open-negotiation');
      }
    });
    socketManager.on(EVENTS.DEAL_COUNTERED, (data: S_DealCountered) => {
      gameBus.emit('deal-countered', data);
      store().addToast('Rent deal countered!', 'warning');
      const myId = store().myPlayerId;
      if (myId && data.deal.debtorId === myId) {
        gameBus.emit('open-negotiation');
      }
    });
    socketManager.on(EVENTS.DEAL_ACCEPTED, (data: S_DealAccepted) => {
      gameBus.emit('deal-accepted', data);
    });
    socketManager.on(EVENTS.DEAL_REJECTED, (data: S_DealRejected) => {
      gameBus.emit('deal-rejected', data);
      store().addToast('Rent deal rejected', 'warning');
    });
    socketManager.on(EVENTS.DEAL_COMPLETED, (data: S_DealCompleted) => {
      gameBus.emit('deal-completed', data);
      store().addToast(`Rent deal completed! ${formatMoney(data.exemptedAmount)} exempted`, 'success');
    });
    socketManager.on(EVENTS.DEAL_CANCELLED, (_data: S_DealCancelled) => {
      gameBus.emit('deal-cancelled', _data);
      store().addToast('Rent deal cancelled', 'info');
    });

    // ── Dev Hacks persistence ─────────────────────────────────────────────────
    socketManager.on(EVENTS.DEV_HACKS_UPDATED, (data: { devHacks: DevHacks }) => {
      try {
        localStorage.setItem('mockopoly-dev-hacks', JSON.stringify(data.devHacks));
      } catch { /* ignore */ }
    });

    // ── Error ─────────────────────────────────────────────────────────────────
    socketManager.on(EVENTS.ERROR, (data: S_Error) => {
      console.error('[server error]', data.code, data.message);
      store().addToast(data.message, 'error');
    });
  }

  private restoreDevHacks(): void {
    try {
      const saved = localStorage.getItem('mockopoly-dev-hacks');
      if (!saved) return;
      const hacks: DevHacks = JSON.parse(saved);
      for (const [key, enabled] of Object.entries(hacks)) {
        if (enabled) {
          socketManager.emit(EVENTS.DEV_SET_HACK, { hack: key, enabled: true });
        }
      }
    } catch { /* ignore corrupt data */ }
  }
}

export const gameStateSync = new GameStateSync();
