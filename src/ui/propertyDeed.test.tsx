import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BOARD_SPACES } from '../constants/board';
import type { Partnership } from '../types/GameState';
import {
  buildRentRows, currentRentTier, equityOf, groupLabel, myPartnershipFor,
  otherPartners, ownerHoldsFullGroup, rentTierValue,
} from './propertyDeed';

const oldKent = BOARD_SPACES.find((s) => s.name === 'Old Kent Road');
const whitechapel = BOARD_SPACES.find((s) => s.name === 'Whitechapel Road');
if (!oldKent || !whitechapel) throw new Error('fixture spaces missing');

const partnership: Partnership = {
  partnershipId: 'ps1',
  colorGroup: 'brown',
  partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }],
  status: 'active',
  createdAt: 0,
};

describe('groupLabel', () => {
  it('title-cases a hyphenated colour group', () => {
    expect(groupLabel('dark-blue')).toBe('Dark blue');
    expect(groupLabel('brown')).toBe('Brown');
  });
});

describe('ownerHoldsFullGroup', () => {
  it('is false for an unowned or null owner', () => {
    expect(ownerHoldsFullGroup(null, 'brown', [], [])).toBe(false);
  });

  it('is true when the same owner holds every member', () => {
    const properties = [
      { spaceIndex: oldKent.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: whitechapel.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
    ];
    expect(ownerHoldsFullGroup('p1', 'brown', properties, [])).toBe(true);
  });

  it('is false when a sibling is owned by someone else and there is no partnership', () => {
    const properties = [
      { spaceIndex: oldKent.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: whitechapel.index, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ];
    expect(ownerHoldsFullGroup('p1', 'brown', properties, [])).toBe(false);
  });

  it('is true via an active partnership even without solo ownership of every member', () => {
    const properties = [
      { spaceIndex: oldKent.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: whitechapel.index, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ];
    expect(ownerHoldsFullGroup('p1', 'brown', properties, [partnership])).toBe(true);
    expect(ownerHoldsFullGroup('p2', 'brown', properties, [partnership])).toBe(true);
  });
});

describe('currentRentTier', () => {
  it('is -1 for an unowned property (no one to collect rent)', () => {
    expect(currentRentTier(oldKent, { ownerId: null, houses: 0, hasHotel: false, isMortgaged: false }, [], [])).toBe(-1);
  });

  it('is -1 while mortgaged, regardless of houses', () => {
    expect(currentRentTier(oldKent, { ownerId: 'p1', houses: 2, hasHotel: false, isMortgaged: true }, [], [])).toBe(-1);
  });

  it('is 0 (base rent) for a solo owner without the full set', () => {
    expect(currentRentTier(oldKent, { ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false }, [], [])).toBe(0);
  });

  it('is 1 ("with colour set") once the owner holds every group member', () => {
    const properties = [
      { spaceIndex: oldKent.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: whitechapel.index, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
    ];
    expect(currentRentTier(oldKent, { ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false }, properties, [])).toBe(1);
  });

  it('maps houses 1..4 to tiers 2..5', () => {
    for (let houses = 1; houses <= 4; houses++) {
      expect(currentRentTier(oldKent, { ownerId: 'p1', houses, hasHotel: false, isMortgaged: false }, [], [])).toBe(houses + 1);
    }
  });

  it('is 6 with a hotel', () => {
    expect(currentRentTier(oldKent, { ownerId: 'p1', houses: 4, hasHotel: true, isMortgaged: false }, [], [])).toBe(6);
  });

  it('is -1 for a space with no rent ladder (railroad/utility)', () => {
    const railroad = BOARD_SPACES.find((s) => s.type === 'railroad');
    if (!railroad) throw new Error('no railroad fixture');
    expect(currentRentTier(railroad, { ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false }, [], [])).toBe(-1);
  });
});

describe('rentTierValue', () => {
  const rents = requireRents(oldKent);
  it('tier 0 is the base rent', () => {
    expect(rentTierValue(rents, 0)).toBe(rents[0]);
  });
  it('tier 1 ("with colour set") doubles the base rent', () => {
    expect(rentTierValue(rents, 1)).toBe(rents[0] * 2);
  });
  it('tiers 2..6 read straight off rents[1..5]', () => {
    for (let tier = 2; tier <= 6; tier++) {
      expect(rentTierValue(rents, tier)).toBe(rents[tier - 1]);
    }
  });
});

describe('buildRentRows', () => {
  it('returns no rows when there is no rent ladder', () => {
    expect(buildRentRows(undefined, -1)).toEqual([]);
  });

  it('marks the current tier and locks every tier after it, never before', () => {
    const rents = requireRents(oldKent);
    const rows = buildRentRows(rents, 3); // "2 houses"
    expect(rows).toHaveLength(7);
    expect(rows[3].current).toBe(true);
    expect(rows[0].locked).toBe(false); // base rent, already passed — not locked
    expect(rows[2].locked).toBe(false); // 1 house, already passed — not locked
    expect(rows[4].locked).toBe(true); // 3 houses, not yet reachable
    expect(rows[6].locked).toBe(true); // hotel, not yet reachable
  });

  it('renders a <Money> node for each row', () => {
    const rents = requireRents(oldKent);
    const rows = buildRentRows(rents, 0);
    const { container } = render(<>{rows.map((r, i) => <span key={i}>{r.value}</span>)}</>);
    expect(container.querySelectorAll('.kit-money')).toHaveLength(7);
  });
});

describe('equityOf / otherPartners / myPartnershipFor', () => {
  it('equityOf returns the listed percentage, or 0 for a non-partner', () => {
    expect(equityOf(partnership, 'p1')).toBe(60);
    expect(equityOf(partnership, 'p2')).toBe(40);
    expect(equityOf(partnership, 'p3')).toBe(0);
  });

  it('otherPartners excludes the given player', () => {
    expect(otherPartners(partnership, 'p1')).toEqual([{ playerId: 'p2', percentage: 40 }]);
  });

  it('myPartnershipFor finds the active partnership for a colour group that lists the player', () => {
    expect(myPartnershipFor('brown', [partnership], 'p1')).toBe(partnership);
    expect(myPartnershipFor('brown', [partnership], 'p3')).toBeNull();
    expect(myPartnershipFor('pink', [partnership], 'p1')).toBeNull();
    expect(myPartnershipFor('brown', [partnership], null)).toBeNull();
  });
});

function requireRents(space: { rents?: number[] }): number[] {
  if (!space.rents) throw new Error('fixture space has no rents');
  return space.rents;
}
