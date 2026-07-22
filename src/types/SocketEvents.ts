import type { GameState, Player, TradeOffer, DrawnCard, CardEffect, SpaceType, TokenType, Partnership, PartnershipProposal, PartnershipEquity, RentDeal, ColorGroup, DevHacks } from './GameState';

// ─── Event Name Constants ─────────────────────────────────────────────────────

export const EVENTS = {
  // Room
  ROOM_CREATE:         'room:create',
  ROOM_JOIN:           'room:join',
  ROOM_LEAVE:          'room:leave',
  ROOM_READY:          'room:ready',
  ROOM_START:          'room:start',
  ROOM_CREATED:        'room:created',
  ROOM_JOINED:         'room:joined',
  ROOM_REJECTED:       'room:rejected',
  ROOM_PLAYER_JOINED:  'room:player-joined',
  ROOM_PLAYER_LEFT:    'room:player-left',
  ROOM_PLAYER_READY:   'room:player-ready',
  ROOM_COUNTDOWN:      'room:start-countdown',

  // Game state
  GAME_STATE_UPDATE:          'game:state-update',
  GAME_OVER:                  'game:over',
  GAME_PLAYER_DISCONNECTED:   'game:player-disconnected',
  GAME_PLAYER_RECONNECTED:    'game:player-reconnected',

  // Turn
  TURN_ROLL_DICE:    'turn:roll-dice',
  TURN_BUY_PROPERTY: 'turn:buy-property',
  TURN_PASS_BUY:     'turn:pass-buy',
  TURN_END:          'turn:end-turn',
  TURN_DICE_ROLLED:  'turn:dice-rolled',
  TURN_PLAYER_MOVED: 'turn:player-moved',
  TURN_LANDED:       'turn:landed',
  TURN_STARTED:      'turn:started',
  TURN_ENDED:        'turn:ended',

  // Jail
  JAIL_PAY_FINE:    'jail:pay-fine',
  JAIL_USE_CARD:    'jail:use-card',
  JAIL_ROLL:        'jail:roll-doubles',
  JAIL_SENT:        'jail:sent',
  JAIL_RELEASED:    'jail:released',

  // Building
  BUILD_BUY_HOUSE:   'build:buy-house',
  BUILD_SELL_HOUSE:  'build:sell-house',
  BUILD_BUY_HOTEL:   'build:buy-hotel',
  BUILD_SELL_HOTEL:  'build:sell-hotel',
  BUILD_HOUSE_ADDED: 'build:house-added',
  BUILD_HOTEL_ADDED: 'build:hotel-added',
  BUILD_HOUSE_SOLD:  'build:house-sold',
  BUILD_HOTEL_SOLD:  'build:hotel-sold',

  // Mortgage
  MORTGAGE_APPLY:    'mortgage:apply',
  MORTGAGE_LIFT:     'mortgage:lift',
  MORTGAGE_APPLIED:  'mortgage:applied',
  MORTGAGE_LIFTED:   'mortgage:lifted',

  // Property
  PROPERTY_BOUGHT:        'property:bought',
  PROPERTY_RENT_COLLECTED:'property:rent-collected',
  PROPERTY_AUCTION_START: 'property:auction-start',
  PROPERTY_AUCTION_BID:   'property:auction-bid',
  PROPERTY_AUCTION_WON:   'property:auction-won',

  // Auction
  AUCTION_BID:  'auction:bid',
  AUCTION_PASS: 'auction:pass',

  // Cards
  CARD_DRAWN:          'card:drawn',
  CARD_EFFECT_APPLIED: 'card:effect-applied',

  // Trade
  TRADE_OFFER:    'trade:offer',
  TRADE_COUNTER:  'trade:counter',
  TRADE_ACCEPT:   'trade:accept',
  TRADE_REJECT:   'trade:reject',
  TRADE_CANCEL:   'trade:cancel',
  TRADE_OFFERED:  'trade:offered',
  TRADE_COUNTERED:'trade:countered',
  TRADE_ACCEPTED: 'trade:accepted',
  TRADE_REJECTED: 'trade:rejected',
  TRADE_COMPLETED:'trade:completed',
  TRADE_CANCELLED:'trade:cancelled',

  // Bankruptcy
  BANKRUPTCY_DECLARE:         'bankruptcy:declare',
  BANKRUPTCY_TRANSFER_ASSETS: 'bankruptcy:transfer-assets',
  PLAYER_BANKRUPT:            'player:bankrupt',

  // Partnership
  PARTNERSHIP_PROPOSE:            'partnership:propose',
  PARTNERSHIP_ACCEPT_PROPOSAL:    'partnership:accept-proposal',
  PARTNERSHIP_REJECT_PROPOSAL:    'partnership:reject-proposal',
  PARTNERSHIP_CANCEL_PROPOSAL:    'partnership:cancel-proposal',
  PARTNERSHIP_PROPOSED:           'partnership:proposed',
  PARTNERSHIP_PROPOSAL_ACCEPTED:  'partnership:proposal-accepted',
  PARTNERSHIP_PROPOSAL_REJECTED:  'partnership:proposal-rejected',
  PARTNERSHIP_PROPOSAL_CANCELLED: 'partnership:proposal-cancelled',
  PARTNERSHIP_FORMED:             'partnership:formed',
  PARTNERSHIP_DISSOLVE_REQUEST:   'partnership:dissolve-request',
  PARTNERSHIP_ACCEPT_DISSOLVE:    'partnership:accept-dissolve',
  PARTNERSHIP_REJECT_DISSOLVE:    'partnership:reject-dissolve',
  PARTNERSHIP_DISSOLVE_REQUESTED: 'partnership:dissolve-requested',
  PARTNERSHIP_DISSOLVE_ACCEPTED:  'partnership:dissolve-accepted',
  PARTNERSHIP_DISSOLVE_REJECTED:  'partnership:dissolve-rejected',
  PARTNERSHIP_DISSOLVED:          'partnership:dissolved',
  PARTNERSHIP_RENT_SPLIT:         'partnership:rent-split',
  PARTNERSHIP_BUILD_COST_SPLIT:   'partnership:build-cost-split',

  // Free Parking
  FREE_PARKING_COLLECTED:  'free-parking:collected',

  // GO Deduction
  LOAN_GO_DEDUCTION:  'loan:go-deduction',
  LOAN_GO_DEDUCTED:   'loan:go-deducted',

  // Rent Deal
  DEAL_OFFER:     'deal:offer',
  DEAL_COUNTER:   'deal:counter',
  DEAL_ACCEPT:    'deal:accept',
  DEAL_REJECT:    'deal:reject',
  DEAL_CANCEL:    'deal:cancel',
  DEAL_OFFERED:   'deal:offered',
  DEAL_COUNTERED: 'deal:countered',
  DEAL_ACCEPTED:  'deal:accepted',
  DEAL_REJECTED:  'deal:rejected',
  DEAL_COMPLETED: 'deal:completed',
  DEAL_CANCELLED: 'deal:cancelled',

  // Dev Hacks
  DEV_SET_HACK:      'dev:set-hack',
  DEV_HACKS_UPDATED: 'dev:hacks-updated',

  // System
  ERROR:        'error',
  CONNECT_ACK:  'connect-ack',
} as const;

// ─── Client → Server Payloads ─────────────────────────────────────────────────

export interface C_RoomCreate   { playerName: string; token: TokenType }
export interface C_RoomJoin     { roomCode: string; playerName: string; token: TokenType; reconnectToken?: string }
export interface C_RoomReady    { isReady: boolean }
export interface C_BuildHouse   { spaceIndex: number }
export interface C_BuildHotel   { spaceIndex: number }
export interface C_SellHouse    { spaceIndex: number }
export interface C_SellHotel    { spaceIndex: number }
export interface C_MortgageApply { spaceIndex: number }
export interface C_MortgageLift  { spaceIndex: number }
export interface C_TradeOffer   { toPlayerId: string; offeredProperties: number[]; requestedProperties: number[]; offeredMoney: number; requestedMoney: number; offeredJailCards: number; requestedJailCards: number }
export interface C_TradeCounter { tradeId: string; offeredProperties: number[]; requestedProperties: number[]; offeredMoney: number; requestedMoney: number; offeredJailCards: number; requestedJailCards: number }
export interface C_TradeAction  { tradeId: string }
export interface C_AuctionBid   { amount: number }
export interface C_BankruptcyTransfer { toPlayerId: string | null; properties: number[]; money: number }
export interface C_PartnershipPropose    { colorGroup: ColorGroup; proposedEquity: PartnershipEquity[] }
export interface C_PartnershipAction     { proposalId: string }
export interface C_PartnershipDissolve   { partnershipId: string }
export interface C_PartnershipDissolveAction { dissolutionId: string }
export interface C_GoDeduction           { count: number }
export interface C_DealOffer             { creditorIds: string[]; spaceIndex: number; totalRentOwed: number; offeredProperties: number[]; offeredMoney: number; requestedExemption: number }
export interface C_DealCounter           { dealId: string; offeredProperties: number[]; offeredMoney: number; requestedExemption: number }
export interface C_DealAction            { dealId: string }
export interface C_DevSetHack            { hack: keyof DevHacks; enabled: boolean }

// ─── Server → Client Payloads ─────────────────────────────────────────────────

export interface S_ConnectAck   { playerId: string }
export interface S_Error        { code: string; message: string }
export interface S_RoomCreated  { roomCode: string; state: GameState }
export interface S_RoomJoined   { state: GameState }
export interface S_RoomRejected { reason: string }
export interface S_PlayerJoined { player: Player }
export interface S_PlayerLeft   { playerId: string }
export interface S_PlayerReady  { playerId: string; isReady: boolean }
export interface S_Countdown    { seconds: number }
export interface S_StateUpdate  { state: GameState }
export interface S_DiceRolled   { playerId: string; dice: [number, number]; isDoubles: boolean }
export interface S_PlayerMoved  { playerId: string; from: number; to: number; passedGo: boolean }
export interface S_Landed       { playerId: string; spaceIndex: number; spaceType: SpaceType }
export interface S_TurnStarted  { playerId: string }
export interface S_TurnEnded    { playerId: string }
export interface S_CardDrawn    { playerId: string; deck: 'chance' | 'community-chest'; card: DrawnCard }
export interface S_CardEffect   { playerId: string; effect: CardEffect }
export interface S_JailSent     { playerId: string }
export interface S_JailReleased { playerId: string; method: 'fine' | 'card' | 'doubles' | 'forced' }
export interface S_PropertyBought     { playerId: string; spaceIndex: number; price: number }
export interface S_RentCollected      { fromId: string; toId: string; amount: number; spaceIndex: number }
export interface S_AuctionStart       { spaceIndex: number; startingBid: number; bidderIds: string[] }
export interface S_AuctionBid         { playerId: string; amount: number }
export interface S_AuctionWon         { playerId: string; spaceIndex: number; amount: number }
export interface S_MortgageApplied    { playerId: string; spaceIndex: number; amount: number }
export interface S_MortgageLifteed    { playerId: string; spaceIndex: number; cost: number }
export interface S_HouseAdded         { playerId: string; spaceIndex: number; newCount: number }
export interface S_HotelAdded         { playerId: string; spaceIndex: number }
export interface S_HouseSold          { playerId: string; spaceIndex: number; newCount: number }
export interface S_HotelSold          { playerId: string; spaceIndex: number }
export interface S_TradeOffered       { offer: TradeOffer }
export interface S_TradeCountered     { tradeId: string; offer: TradeOffer }
export interface S_TradeResolved      { tradeId: string }
export interface S_PlayerBankrupt     { playerId: string; creditorId: string | null }
export interface S_GameOver           { winnerId: string; finalStandings: Player[] }
export interface S_PlayerDisconnected { playerId: string; reconnectWindowSeconds: number }
export interface S_PlayerReconnected  { playerId: string }

// Partnership
export interface S_PartnershipProposed          { proposal: PartnershipProposal }
export interface S_PartnershipProposalAccepted   { proposalId: string; playerId: string }
export interface S_PartnershipProposalRejected   { proposalId: string; playerId: string }
export interface S_PartnershipProposalCancelled  { proposalId: string }
export interface S_PartnershipFormed             { partnership: Partnership }
export interface S_PartnershipDissolveRequested   { dissolutionId: string; partnershipId: string; requesterId: string }
export interface S_PartnershipDissolveAccepted    { dissolutionId: string; playerId: string }
export interface S_PartnershipDissolveRejected    { dissolutionId: string; playerId: string }
export interface S_PartnershipDissolved           { partnershipId: string; refunds: { playerId: string; amount: number }[] }
export interface S_PartnershipRentSplit           { spaceIndex: number; fromId: string; splits: { playerId: string; amount: number }[] }
export interface S_PartnershipBuildCostSplit      { spaceIndex: number; splits: { playerId: string; amount: number }[] }

// Free Parking
export interface S_FreeParkingCollected  { playerId: string; amount: number }

// GO Deduction
export interface S_GoDeducted  { playerId: string; count: number; amount: number; totalUsed: number; skipsRemaining: number }

// Rent Deal
export interface S_DealOffered    { deal: RentDeal }
export interface S_DealCountered  { deal: RentDeal }
export interface S_DealAccepted   { dealId: string; playerId: string }
export interface S_DealRejected   { dealId: string; playerId: string }
export interface S_DealCompleted  { dealId: string; exemptedAmount: number }
export interface S_DealCancelled  { dealId: string }

// Dev Hacks
export interface S_DevHacksUpdated  { devHacks: DevHacks }
