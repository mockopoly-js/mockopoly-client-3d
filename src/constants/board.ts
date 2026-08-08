import type { BoardSpace } from '../types/GameState';

// ─── Board Spaces (0–39) ──────────────────────────────────────────────────────
// Standard UK Monopoly layout starting from GO (index 0), moving clockwise.
// cardFrame is the spritesheet index (0–27) matching property_cards.png row-major order.
// All money values are in thousands (K). E.g. price: 60000 = £60K on the cards.

export const BOARD_SPACES: BoardSpace[] = [
  // ── Bottom row: GO → Jail ──────────────────────────────────────────────────
  // All values ×10 to match updated board/card assets (M600K, M1.0M, etc.)
  { index: 0,  type: 'go',            name: 'GO' },
  { index: 1,  type: 'property',      name: 'Old Kent Road',        price: 600000,  colorGroup: 'brown',     cardFrame: 0,  rents: [20000,100000,300000,900000,1600000,2500000],    houseCost: 500000,  mortgageValue: 300000 },
  { index: 2,  type: 'community-chest', name: 'Community Chest' },
  { index: 3,  type: 'property',      name: 'Whitechapel Road',     price: 600000,  colorGroup: 'brown',     cardFrame: 1,  rents: [40000,200000,600000,1800000,3200000,4500000],    houseCost: 500000,  mortgageValue: 300000 },
  { index: 4,  type: 'tax',           name: 'Income Tax',           taxAmount: 2000000 },
  { index: 5,  type: 'railroad',      name: 'Kings Cross Station',  price: 2000000, colorGroup: 'railroad',  cardFrame: 2,  railroadRents: [250000,500000,1000000,2000000],  mortgageValue: 1000000 },
  { index: 6,  type: 'property',      name: 'The Angle Islington',  price: 1000000, colorGroup: 'light-blue',cardFrame: 3,  rents: [60000,300000,900000,2700000,4000000,5500000],    houseCost: 500000,  mortgageValue: 500000 },
  { index: 7,  type: 'chance',        name: 'Chance' },
  { index: 8,  type: 'property',      name: 'Euston Road',          price: 1000000, colorGroup: 'light-blue',cardFrame: 4,  rents: [60000,300000,900000,2700000,4000000,5500000],    houseCost: 500000,  mortgageValue: 500000 },
  { index: 9,  type: 'property',      name: 'Pentonville Road',     price: 1200000, colorGroup: 'light-blue',cardFrame: 5,  rents: [80000,400000,1000000,3000000,4500000,6000000],   houseCost: 500000,  mortgageValue: 600000 },

  // ── Left column: Jail → Free Parking ──────────────────────────────────────
  { index: 10, type: 'jail',          name: 'Jail / Just Visiting' },
  { index: 11, type: 'property',      name: 'Pall Mall',            price: 1400000, colorGroup: 'pink',      cardFrame: 6,  rents: [100000,500000,1500000,4500000,6250000,7500000],  houseCost: 1000000, mortgageValue: 700000 },
  { index: 12, type: 'utility',       name: 'Electric Company',     price: 1500000, colorGroup: 'utility',   cardFrame: 7, utilityMultipliers: [4, 10],      mortgageValue: 750000 },
  { index: 13, type: 'property',      name: 'Whitehall',            price: 1400000, colorGroup: 'pink',      cardFrame: 8,  rents: [100000,500000,1500000,4500000,6250000,7500000],  houseCost: 1000000, mortgageValue: 700000 },
  { index: 14, type: 'property',      name: 'Northumberland Avenue',price: 1600000, colorGroup: 'pink',      cardFrame: 9,  rents: [120000,600000,1800000,5000000,7000000,9000000],  houseCost: 1000000, mortgageValue: 800000 },
  { index: 15, type: 'railroad',      name: 'Marylebone Station',   price: 2000000, colorGroup: 'railroad',  cardFrame: 10, railroadRents: [250000,500000,1000000,2000000],  mortgageValue: 1000000 },
  { index: 16, type: 'property',      name: 'Bow Street',           price: 1800000, colorGroup: 'orange',    cardFrame: 11, rents: [140000,700000,2000000,5500000,7500000,9500000],  houseCost: 1000000, mortgageValue: 900000 },
  { index: 17, type: 'community-chest', name: 'Community Chest' },
  { index: 18, type: 'property',      name: 'Marlborough Street',   price: 1800000, colorGroup: 'orange',    cardFrame: 12, rents: [140000,700000,2000000,5500000,7500000,9500000],  houseCost: 1000000, mortgageValue: 900000 },
  { index: 19, type: 'property',      name: 'Vine Street',          price: 2000000, colorGroup: 'orange',    cardFrame: 13, rents: [160000,800000,2200000,6000000,8000000,10000000], houseCost: 1000000, mortgageValue: 1000000 },

  // ── Top row: Free Parking → Go To Jail ────────────────────────────────────
  { index: 20, type: 'free-parking',  name: 'Free Parking' },
  { index: 21, type: 'property',      name: 'Strand',               price: 2200000, colorGroup: 'red',       cardFrame: 14, rents: [180000,900000,2500000,7000000,8750000,10500000], houseCost: 1500000, mortgageValue: 1100000 },
  { index: 22, type: 'chance',        name: 'Chance' },
  { index: 23, type: 'property',      name: 'Fleet Street',         price: 2200000, colorGroup: 'red',       cardFrame: 15, rents: [180000,900000,2500000,7000000,8750000,10500000], houseCost: 1500000, mortgageValue: 1100000 },
  { index: 24, type: 'property',      name: 'Trafalgar Square',     price: 2400000, colorGroup: 'red',       cardFrame: 16, rents: [200000,1000000,3000000,7500000,9250000,11000000],houseCost: 1500000, mortgageValue: 1200000 },
  { index: 25, type: 'railroad',      name: 'Fenchurch St. Station',price: 2000000, colorGroup: 'railroad',  cardFrame: 17, railroadRents: [250000,500000,1000000,2000000],  mortgageValue: 1000000 },
  { index: 26, type: 'property',      name: 'Leicester Square',     price: 2600000, colorGroup: 'yellow',    cardFrame: 18, rents: [220000,1100000,3300000,8000000,9750000,11500000], houseCost: 1500000, mortgageValue: 1300000 },
  { index: 27, type: 'property',      name: 'Coventry Street',      price: 2600000, colorGroup: 'yellow',    cardFrame: 19, rents: [220000,1100000,3300000,8000000,9750000,11500000], houseCost: 1500000, mortgageValue: 1300000 },
  { index: 28, type: 'utility',       name: 'Water Works',          price: 1500000, colorGroup: 'utility',   cardFrame: 20, utilityMultipliers: [4, 10],      mortgageValue: 750000 },
  { index: 29, type: 'property',      name: 'Piccadilly',           price: 2800000, colorGroup: 'yellow',    cardFrame: 21, rents: [240000,1200000,3600000,8500000,10250000,12000000],houseCost: 1500000, mortgageValue: 1400000 },

  // ── Right column: Go To Jail → GO ─────────────────────────────────────────
  { index: 30, type: 'go-to-jail',    name: 'Go To Jail' },
  { index: 31, type: 'property',      name: 'Regent Street',        price: 3000000, colorGroup: 'green',     cardFrame: 22, rents: [260000,1300000,3900000,9000000,11000000,12750000],houseCost: 2000000, mortgageValue: 1500000 },
  { index: 32, type: 'property',      name: 'Oxford Street',        price: 3000000, colorGroup: 'green',     cardFrame: 23, rents: [260000,1300000,3900000,9000000,11000000,12750000],houseCost: 2000000, mortgageValue: 1500000 },
  { index: 33, type: 'community-chest', name: 'Community Chest' },
  { index: 34, type: 'property',      name: 'Bond Street',          price: 3200000, colorGroup: 'green',     cardFrame: 24, rents: [280000,1500000,4500000,10000000,12000000,14000000],houseCost: 2000000, mortgageValue: 1600000 },
  { index: 35, type: 'railroad',      name: 'Liverpool St. Station',price: 2000000, colorGroup: 'railroad',  cardFrame: 25, railroadRents: [250000,500000,1000000,2000000],  mortgageValue: 1000000 },
  { index: 36, type: 'chance',        name: 'Chance' },
  { index: 37, type: 'property',      name: 'Park Lane',            price: 3500000, colorGroup: 'dark-blue', cardFrame: 26, rents: [350000,1750000,5000000,11000000,13000000,15000000],houseCost: 2000000, mortgageValue: 1750000 },
  { index: 38, type: 'tax',           name: 'Luxury Tax',           taxAmount: 1000000 },
  { index: 39, type: 'property',      name: 'Mayfair',              price: 4000000, colorGroup: 'dark-blue', cardFrame: 27, rents: [500000,2000000,6000000,14000000,17000000,20000000],houseCost: 2000000, mortgageValue: 2000000 },
];

// All purchasable space indices
export const PURCHASABLE_SPACES = BOARD_SPACES
  .filter(s => s.type === 'property' || s.type === 'railroad' || s.type === 'utility')
  .map(s => s.index);

// Space indices grouped by color
export const COLOR_GROUPS: Record<string, number[]> = BOARD_SPACES
  .reduce<Record<string, number[]>>((acc, s) => {
    const g = s.colorGroup;
    if (!g) return acc; // narrows colorGroup and skips non-grouped spaces
    (acc[g] ??= []).push(s.index);
    return acc;
  }, {});

