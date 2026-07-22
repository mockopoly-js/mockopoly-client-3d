// ─── Enums ────────────────────────────────────────────────────────────────────

export type SpaceType =
  | 'go'
  | 'property'
  | 'railroad'
  | 'utility'
  | 'tax'
  | 'jail'
  | 'free-parking'
  | 'go-to-jail'
  | 'community-chest'
  | 'chance';

export type ColorGroup =
  | 'brown'
  | 'light-blue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'dark-blue'
  | 'railroad'
  | 'utility';

export type TokenType =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'cyan'
  | 'pink';

export type TurnPhase =
  | 'waiting'
  | 'rolling'
  | 'moving'
  | 'landing'
  | 'action'
  | 'end';

export type GameStatus = 'lobby' | 'starting' | 'in-progress' | 'game-over';

export type CardDeck = 'chance' | 'community-chest';

export type CardEffectType =
  | 'advance-to'        // move to specific space index
  | 'advance-nearest'   // move to nearest railroad or utility
  | 'move-back'         // go back N spaces
  | 'money'             // gain or lose money
  | 'money-per-building'// pay per house/hotel
  | 'money-from-players'// collect from each player
  | 'jail'              // go to jail
  | 'jail-free';        // get out of jail free card

// ─── Board Space ──────────────────────────────────────────────────────────────

export interface BoardSpace {
  index: number;
  type: SpaceType;
  name: string;
  // Property / Railroad / Utility only
  price?: number;
  colorGroup?: ColorGroup;
  cardFrame?: number;         // spritesheet frame index (0–27) for deed display
  rents?: number[];           // [base, 1h, 2h, 3h, 4h, hotel] — property only
  railroadRents?: number[];   // [1 owned, 2, 3, 4] — railroad only
  utilityMultipliers?: number[]; // [1 owned = 4x, 2 owned = 10x] — utility only
  houseCost?: number;
  mortgageValue?: number;
  // Tax only
  taxAmount?: number;
}

// ─── Cards ────────────────────────────────────────────────────────────────────

export interface CardEffect {
  type: CardEffectType;
  value?: number;             // amount, spaces, or target space index
  targetType?: 'railroad' | 'utility'; // for advance-nearest
  perHouse?: number;          // for money-per-building
  perHotel?: number;          // for money-per-building
}

export interface GameCard {
  id: number;
  deck: CardDeck;
  description: string;
  effect: CardEffect;
}

export interface DrawnCard {
  deck: CardDeck;
  cardId: number;
  description: string;
  effect: CardEffect;
}

// ─── Trade ────────────────────────────────────────────────────────────────────

export type TradeStatus = 'pending' | 'countered' | 'accepted' | 'rejected' | 'cancelled';

export interface TradeOffer {
  tradeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  offeredProperties: number[];    // space indices
  requestedProperties: number[];  // space indices
  offeredMoney: number;
  requestedMoney: number;
  offeredJailCards: number;
  requestedJailCards: number;
  status: TradeStatus;
}

// ─── Auction ──────────────────────────────────────────────────────────────────

export interface AuctionState {
  spaceIndex: number;
  currentHighBid: number;
  currentHighBidderId: string | null;
  activeBidderIds: string[];
  status: 'active' | 'complete';
}

// ─── Partnership ─────────────────────────────────────────────────────────────

export interface PartnershipEquity {
  playerId: string;
  percentage: number;           // 1–99, all partners must sum to 100
}

export interface Partnership {
  partnershipId: string;
  colorGroup: ColorGroup;
  partners: PartnershipEquity[];  // 2–3 entries
  status: 'pending' | 'active';
  createdAt: number;
}

export interface PartnershipProposal {
  proposalId: string;
  initiatorId: string;
  colorGroup: ColorGroup;
  proposedEquity: PartnershipEquity[];
  acceptedPlayerIds: string[];    // initiator is auto-accepted
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
}

export interface PartnershipDissolutionRequest {
  dissolutionId: string;
  partnershipId: string;
  requesterId: string;
  acceptedPlayerIds: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
}

// ─── Rent Deal ───────────────────────────────────────────────────────────────

export interface RentDeal {
  dealId: string;
  debtorId: string;
  creditorIds: string[];          // 1 player or multiple (partnership)
  spaceIndex: number;
  totalRentOwed: number;
  offeredProperties: number[];    // debtor's properties being given to creditor
  offeredMoney: number;           // debtor's cash being given to creditor
  requestedExemption: number;     // amount of rent creditor will exempt (up to totalRentOwed)
  lastOfferBy: string;            // playerId who made the last offer/counter
  acceptedPlayerIds: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled';
}

// ─── Player ───────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  token: TokenType;
  position: number;           // 0–39 board space index
  money: number;
  properties: number[];       // owned space indices
  isJailed: boolean;
  jailTurns: number;          // 0–3 turns spent in jail
  jailCardCount: number;      // Get Out of Jail Free cards held
  isBankrupt: boolean;
  isConnected: boolean;
  isHost: boolean;
  isReady: boolean;
  reconnectToken: string;     // stored in client localStorage for rejoin
  goDeductionsUsed: number;   // 0–5, lifetime GO deductions taken
  goSkipsRemaining: number;   // GO salary skips remaining from deductions
}

// ─── Property State ───────────────────────────────────────────────────────────

export interface PropertyState {
  spaceIndex: number;
  ownerId: string | null;
  houses: number;             // 0–4
  hasHotel: boolean;
  isMortgaged: boolean;
}

// ─── Turn State ───────────────────────────────────────────────────────────────

export interface TurnState {
  currentPlayerId: string;
  phase: TurnPhase;
  diceValues: [number, number] | null;
  doublesCount: number;       // 0–2; third double = go to jail
  hasRolled: boolean;
  mustPayRent: boolean;
  rentAmount: number | null;
  rentOwnerId: string | null;
  pendingCard: DrawnCard | null;
  auctionState: AuctionState | null;
}

// ─── Game Log ─────────────────────────────────────────────────────────────────

export type GameLogType = 'action' | 'system' | 'card' | 'trade' | 'partnership';

export interface GameLogEntry {
  timestamp: number;
  playerId: string | null;    // null for system messages
  message: string;
  type: GameLogType;
}

// ─── Game Config ──────────────────────────────────────────────────────────────

export interface GameConfig {
  maxPlayers: number;
  startingMoney: number;
  // Extensible special rules — add new rules here as boolean flags
  specialRules: Record<string, boolean>;
}

// ─── Dev Hacks ───────────────────────────────────────────────────────────────

export interface DevHacks {
  unlimitedMoney: boolean;          // Starting money = 999M
  soloPlay: boolean;                // Allow 1-player game start
  alwaysLandOnMayfair: boolean;     // Override move → always land on position 39
  alwaysLandOnCard: boolean;        // Override move → cycle through Chance/Community Chest spaces
  sameTurn: boolean;                // Never advance turn to next player
  preAssignProperties: boolean;     // Pre-assign test properties on game start
}

// ─── Master Game State ────────────────────────────────────────────────────────

export interface GameState {
  roomCode: string;
  status: GameStatus;
  players: Player[];                  // ordered by turn
  properties: PropertyState[];        // all 28 purchasable spaces
  communityChestDeck: number[];       // shuffled card id array — draw from front
  chanceDeck: number[];
  communityChestDiscard: number[];
  chanceDiscard: number[];
  turn: TurnState;
  activeTrade: TradeOffer | null;
  partnerships: Partnership[];
  activePartnershipProposal: PartnershipProposal | null;
  activePartnershipDissolution: PartnershipDissolutionRequest | null;
  freeParkingPool: number;
  activeRentDeal: RentDeal | null;
  log: GameLogEntry[];
  config: GameConfig;
  devHacks: DevHacks;
  winnerId: string | null;
  createdAt: number;
  lastActionAt: number;
}
