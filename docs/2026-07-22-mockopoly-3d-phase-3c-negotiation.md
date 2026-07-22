# Mockopoly 3D — Phase 3c (Negotiation modals: Trade / Partnership / Rent Deal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The three multi-player negotiation modals — Trade (property/money offers), Partnership (zone equity), and Rent Deal + GO-deduction — completing Phase 3 feature parity. All HTML overlays reading `store.state.*`, emitting socket events; identity via `store.myPlayerId`.

**Architecture:** Each modal self-gates: open when its store flag (`showTradePanel`/`showPartnershipPanel`/`showDealPanel`, already in the store) is true OR when the relevant snapshot field involves me (incoming). Content + open-state derive from the durable `GAME_STATE_UPDATE` snapshot (`activeTrade`, `activePartnershipProposal`, `activePartnershipDissolution`, `partnerships`, `activeRentDeal`, `turn`); gameBus `'open-negotiation'` (already relayed by GameStateSync for rent deals) flips `showDealPanel`. HudButtons opens user-initiated panels. Server is authoritative on all validation.

**Tech Stack:** React 18, zustand, Vitest + @testing-library/react. No new deps; no network/contract/board edits.

## Global Constraints

- **Server + 2D client untouched.** Build on `main` (Phase 3b merged, tip `d5b7639`).
- **Do NOT edit** `src/network/*`, `src/types/*`, `src/constants/*`, `src/board/*`, or P2 turn components. Additive UI + App composition only. Reuse existing store flags `showTradePanel`/`showPartnershipPanel`/`showDealPanel` + `toggleTradePanel`/`togglePartnershipPanel`/`toggleDealPanel` (Phase 0). No new store fields needed.
- **Identity:** `store.myPlayerId` only.
- **Events + payloads (verbatim):**
  - Trade: `TRADE_OFFER` `C_TradeOffer {toPlayerId, offeredProperties:number[], requestedProperties:number[], offeredMoney, requestedMoney, offeredJailCards, requestedJailCards}`; `TRADE_COUNTER` `C_TradeCounter {tradeId, …same fields…}`; `TRADE_ACCEPT`/`TRADE_REJECT`/`TRADE_CANCEL` `C_TradeAction {tradeId}`.
  - Partnership: `PARTNERSHIP_PROPOSE` `C_PartnershipPropose {colorGroup, proposedEquity:PartnershipEquity[]}`; `PARTNERSHIP_ACCEPT_PROPOSAL`/`REJECT_PROPOSAL`/`CANCEL_PROPOSAL` `C_PartnershipAction {proposalId}`; `PARTNERSHIP_DISSOLVE_REQUEST` `C_PartnershipDissolve {partnershipId}`; `PARTNERSHIP_ACCEPT_DISSOLVE`/`REJECT_DISSOLVE` `C_PartnershipDissolveAction {dissolutionId}`.
  - Rent deal: `DEAL_OFFER` `C_DealOffer {creditorIds:string[], spaceIndex, totalRentOwed, offeredProperties:number[], offeredMoney, requestedExemption}`; `DEAL_COUNTER` `C_DealCounter {dealId, offeredProperties, offeredMoney, requestedExemption}`; `DEAL_ACCEPT`/`REJECT`/`CANCEL` `C_DealAction {dealId}`; `LOAN_GO_DEDUCTION` `C_GoDeduction {count}` (1–3).
- **State shapes (verbatim):** `TradeOffer {tradeId, fromPlayerId, toPlayerId, offeredProperties, requestedProperties, offeredMoney, requestedMoney, offeredJailCards, requestedJailCards, status}`; `RentDeal {dealId, debtorId, creditorIds:string[], spaceIndex, totalRentOwed, offeredProperties, offeredMoney, requestedExemption, lastOfferBy, acceptedPlayerIds:string[], status}`; `Partnership {partnershipId, colorGroup, partners:{playerId,percentage}[], status}`; `PartnershipProposal {proposalId, initiatorId, colorGroup, proposedEquity:{playerId,percentage}[], acceptedPlayerIds, status}`; `PartnershipDissolutionRequest {dissolutionId, partnershipId, requesterId, acceptedPlayerIds, status}`. `GameState.turn` has `mustPayRent, rentAmount, rentOwnerId, currentPlayerId`. `Player` has `goDeductionsUsed`(0–5), `goSkipsRemaining`, `money`, `position`.
- **Quorum rules:** Trade is 1↔1 (recipient = `toPlayerId` accepts; counter flips roles + inverts offered/requested). Rent deal: `lastOfferBy` cannot accept own offer; settles when all `creditorIds` ∈ `acceptedPlayerIds`. Partnership: forms when all proposed partners accept; `proposedEquity` percentages must sum to **100** (client gates Propose). Server enforces all; client gating is UX only, ERROR toast (top-level ToastLayer) surfaces rejects.
- **Helpers:** `BOARD_SPACES`, `COLOR_GROUPS: Record<string,number[]>`, `COLOR_GROUP_HEX`, `TOKEN_HEX`, `formatMoney`. Houseable groups (partnership-eligible) exclude `railroad`/`utility`.
- **Style tokens:** panel `#12121e`, text `#e8e8f0`, muted `#8888a0`, gold `#d4af37`, border `#2a2a40`; modal wrap `position:fixed; inset:0; display:grid; place-items:center; background:rgba(0,0,0,.5); zIndex:40`; font `"ui-rounded, system-ui, sans-serif"`.
- **jest-dom NOT installed:** `.disabled` / `getByText` / `getByRole` / `queryByText`; `act()` for store mutations + gameBus emits.
- **Git:** branch `feat/hud-negotiation` OFF `main`; PR only (base `main`); no direct pushes/merges to protected; clean tree per commit; no `.superpowers/`.

**Working directory:** `/Users/arslan/Desktop/Monopoly/mockopoly-client-3d`.

---

### Task 1: TradePanel

**Files:** Create `src/ui/TradePanel.tsx`; Test `src/ui/TradePanel.test.tsx`.

**Interfaces:** Consumes `useGameStore` (`showTradePanel`, `toggleTradePanel`, `state.players`, `state.properties`, `state.activeTrade`, `myPlayerId`), `BOARD_SPACES`, `socketManager`, `EVENTS`, `formatMoney`. Produces `<TradePanel />` — null unless open; proposal / active / counter views.

- [ ] **Step 1: Branch**

```bash
cd /Users/arslan/Desktop/Monopoly/mockopoly-client-3d
git checkout main && git pull origin main
git checkout -b feat/hud-negotiation
```

- [ ] **Step 2: Write the failing test**

Create `src/ui/TradePanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TradePanel } from './TradePanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import type { GameState } from '../types/GameState';

const mineProp = BOARD_SPACES.find((s) => s.type === 'property')!.index;
const theirProp = BOARD_SPACES.filter((s) => s.type === 'property')[3].index;

function base(activeTrade: unknown = null) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money: 15_000_000, isBankrupt: false },
              { id: 'p2', name: 'Jonas', token: 'blue', money: 15_000_000, isBankrupt: false }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 },
    properties: [
      { spaceIndex: mineProp, ownerId: 'p1', houses: 0, hasHotel: false, isMortgaged: false },
      { spaceIndex: theirProp, ownerId: 'p2', houses: 0, hasHotel: false, isMortgaged: false },
    ],
    activeTrade,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('TradePanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('is null when closed and no active trade', () => {
    base();
    const { container } = render(<TradePanel />);
    expect(container.firstChild).toBe(null);
  });

  it('proposal form emits TRADE_OFFER with selected items', () => {
    base();
    useGameStore.getState().toggleTradePanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TradePanel />);
    // pick opponent Jonas
    fireEvent.click(screen.getByRole('button', { name: /jonas/i }));
    // offer my property, request theirs
    fireEvent.click(screen.getByTestId(`offer-${mineProp}`));
    fireEvent.click(screen.getByTestId(`request-${theirProp}`));
    fireEvent.click(screen.getByRole('button', { name: /send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_OFFER, expect.objectContaining({
      toPlayerId: 'p2', offeredProperties: [mineProp], requestedProperties: [theirProp],
      offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0,
    }));
  });

  it('incoming trade shows Accept and emits TRADE_ACCEPT', () => {
    base({ tradeId: 't1', fromPlayerId: 'p2', toPlayerId: 'p1', offeredProperties: [theirProp], requestedProperties: [], offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0, status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_ACCEPT, { tradeId: 't1' });
  });

  it('my outgoing trade shows Cancel and emits TRADE_CANCEL', () => {
    base({ tradeId: 't2', fromPlayerId: 'p1', toPlayerId: 'p2', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0, offeredJailCards: 0, requestedJailCards: 0, status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<TradePanel />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.TRADE_CANCEL, { tradeId: 't2' });
  });
});
```

- [ ] **Step 3: Run, expect fail** — `npm test -- TradePanel`.

- [ ] **Step 4: Implement `src/ui/TradePanel.tsx`**

```tsx
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { formatMoney } from '../utils/format';
import type { Player, PropertyState, TradeOffer } from '../types/GameState';

const tradeable = (props: PropertyState[], ownerId: string) =>
  props.filter((p) => p.ownerId === ownerId && !p.isMortgaged && p.houses === 0 && !p.hasHotel);

export function TradePanel() {
  const open = useGameStore((s) => s.showTradePanel);
  const close = useGameStore((s) => s.toggleTradePanel);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const activeTrade: TradeOffer | null = useGameStore((s) => s.state?.activeTrade) ?? null;
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const incoming = activeTrade && activeTrade.toPlayerId === myId;
  const isOpen = open || !!activeTrade;

  const [opp, setOpp] = useState<string | null>(null);
  const [offer, setOffer] = useState<number[]>([]);
  const [request, setRequest] = useState<number[]>([]);
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [countering, setCountering] = useState(false);

  if (!isOpen) return null;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const propName = (i: number) => BOARD_SPACES[i]?.name ?? `#${i}`;
  const toggle = (arr: number[], set: (v: number[]) => void, i: number) =>
    set(arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i]);

  const send = () => {
    if (!opp) return;
    socketManager.emit(EVENTS.TRADE_OFFER, {
      toPlayerId: opp, offeredProperties: offer, requestedProperties: request,
      offeredMoney: offerMoney, requestedMoney: requestMoney, offeredJailCards: 0, requestedJailCards: 0,
    });
    close(false);
  };
  const sendCounter = () => {
    if (!activeTrade) return;
    socketManager.emit(EVENTS.TRADE_COUNTER, {
      tradeId: activeTrade.tradeId, offeredProperties: offer, requestedProperties: request,
      offeredMoney: offerMoney, requestedMoney: requestMoney, offeredJailCards: 0, requestedJailCards: 0,
    });
    setCountering(false);
  };
  const act = (ev: string) => activeTrade && socketManager.emit(ev, { tradeId: activeTrade.tradeId });
  const startCounter = () => {
    if (!activeTrade) return;
    setOffer(activeTrade.requestedProperties); setRequest(activeTrade.offeredProperties);
    setOfferMoney(activeTrade.requestedMoney); setRequestMoney(activeTrade.offeredMoney);
    setCountering(true);
  };

  // ── active trade view (not countering) ──
  if (activeTrade && !countering) {
    return (
      <Shell title="Trade" onClose={() => close(false)}>
        <div style={sub}>{name(activeTrade.fromPlayerId)} → {name(activeTrade.toPlayerId)}</div>
        <Cols giveLabel={`${name(activeTrade.fromPlayerId)} gives`} getLabel={`${name(activeTrade.toPlayerId)} gets`}
          gives={[...activeTrade.offeredProperties.map(propName), ...(activeTrade.offeredMoney ? [formatMoney(activeTrade.offeredMoney)] : [])]}
          gets={[...activeTrade.requestedProperties.map(propName), ...(activeTrade.requestedMoney ? [formatMoney(activeTrade.requestedMoney)] : [])]} />
        <div style={row}>
          {incoming ? <>
            <button style={btnP} onClick={() => act(EVENTS.TRADE_ACCEPT)}>Accept</button>
            <button style={btn} onClick={startCounter}>Counter</button>
            <button style={btn} onClick={() => act(EVENTS.TRADE_REJECT)}>Reject</button>
          </> : activeTrade.fromPlayerId === myId ? (
            <button style={btn} onClick={() => act(EVENTS.TRADE_CANCEL)}>Cancel</button>
          ) : <div style={{ color: '#8888a0' }}>Trade in progress…</div>}
        </div>
      </Shell>
    );
  }

  // ── proposal / counter form ──
  const targetId = countering ? (activeTrade!.fromPlayerId) : opp;
  const myProps = tradeable(properties, myId);
  const theirProps = targetId ? tradeable(properties, targetId) : [];
  return (
    <Shell title={countering ? 'Counter offer' : 'Propose trade'} onClose={() => { close(false); setCountering(false); }}>
      {!countering && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {players.filter((p) => p.id !== myId && !p.isBankrupt).map((p) => (
            <button key={p.id} onClick={() => setOpp(p.id)} style={opp === p.id ? btnP : btn}>{p.name}</button>
          ))}
        </div>
      )}
      {targetId && <>
        <div style={twoCol}>
          <div>
            <div style={colHdr}>You give</div>
            {myProps.map((p) => (
              <label key={p.spaceIndex} style={item}>
                <input data-testid={`offer-${p.spaceIndex}`} type="checkbox" checked={offer.includes(p.spaceIndex)} onChange={() => toggle(offer, setOffer, p.spaceIndex)} />
                {propName(p.spaceIndex)}
              </label>
            ))}
            <input type="number" value={offerMoney} min={0} onChange={(e) => setOfferMoney(Math.max(0, +e.target.value))} style={money} aria-label="offer money" />
          </div>
          <div>
            <div style={colHdr}>You get</div>
            {theirProps.map((p) => (
              <label key={p.spaceIndex} style={item}>
                <input data-testid={`request-${p.spaceIndex}`} type="checkbox" checked={request.includes(p.spaceIndex)} onChange={() => toggle(request, setRequest, p.spaceIndex)} />
                {propName(p.spaceIndex)}
              </label>
            ))}
            <input type="number" value={requestMoney} min={0} onChange={(e) => setRequestMoney(Math.max(0, +e.target.value))} style={money} aria-label="request money" />
          </div>
        </div>
        <div style={row}>
          <button style={btnP} onClick={countering ? sendCounter : send}
            disabled={!offer.length && !request.length && !offerMoney && !requestMoney}>
            {countering ? 'Send counter' : 'Send offer'}
          </button>
        </div>
      </>}
    </Shell>
  );
}

// ── shared modal bits ──
function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={wrap}><div style={card}>
      <div style={hdr}><span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{title}</span>
        <button aria-label="Close" onClick={onClose} style={x}>×</button></div>
      {children}
    </div></div>
  );
}
function Cols({ giveLabel, getLabel, gives, gets }: { giveLabel: string; getLabel: string; gives: string[]; gets: string[] }) {
  return (<div style={twoCol}>
    <div><div style={colHdr}>{giveLabel}</div>{gives.length ? gives.map((g, i) => <div key={i} style={item}>{g}</div>) : <div style={{ color: '#555570' }}>—</div>}</div>
    <div><div style={colHdr}>{getLabel}</div>{gets.length ? gets.map((g, i) => <div key={i} style={item}>{g}</div>) : <div style={{ color: '#555570' }}>—</div>}</div>
  </div>);
}
const F = 'ui-rounded, system-ui, sans-serif';
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 420, maxWidth: '92vw', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 22, cursor: 'pointer' };
const sub: React.CSSProperties = { color: '#8888a0', fontWeight: 700, marginBottom: 10 };
const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 };
const colHdr: React.CSSProperties = { fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8888a0', fontWeight: 800, marginBottom: 6 };
const item: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' };
const money: React.CSSProperties = { width: '100%', marginTop: 8, background: '#08080f', color: '#e8e8f0', border: '1px solid #2a2a40', borderRadius: 8, padding: '6px 8px', fontFamily: F };
const row: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 6 };
const btn: React.CSSProperties = { fontFamily: F, fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', background: '#2a2a40', color: '#e8e8f0' };
const btnP: React.CSSProperties = { ...btn, background: '#d4af37', color: '#08080f' };
```

- [ ] **Step 5: Run, expect pass** — `npm test -- TradePanel` (4). Then full `npm test`. If a `Player`/`TradeOffer`/`PropertyState` field differs, match `types/GameState.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/TradePanel.tsx src/ui/TradePanel.test.tsx
git commit -m "feat(negotiation): TradePanel (propose / accept-counter-reject / cancel)"
```

---

### Task 2: PartnershipPanel

**Files:** Create `src/ui/PartnershipPanel.tsx`; Test `src/ui/PartnershipPanel.test.tsx`.

**Interfaces:** Consumes `useGameStore` (`showPartnershipPanel`, `togglePartnershipPanel`, `state.partnerships`, `state.activePartnershipProposal`, `state.activePartnershipDissolution`, `state.players`, `state.properties`, `myPlayerId`), `COLOR_GROUPS`, `COLOR_GROUP_HEX`, `socketManager`, `EVENTS`. Produces `<PartnershipPanel />`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/PartnershipPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PartnershipPanel } from './PartnershipPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function base(over: Partial<GameState> = {}) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red' }, { id: 'p2', name: 'Jonas', token: 'blue' }],
    turn: { currentPlayerId: 'p1' }, config: { maxPlayers: 4 }, properties: [],
    partnerships: [], activePartnershipProposal: null, activePartnershipDissolution: null, ...over,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('PartnershipPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('is null when closed with nothing pending', () => {
    base();
    const { container } = render(<PartnershipPanel />);
    expect(container.firstChild).toBe(null);
  });

  it('accepts an incoming proposal', () => {
    base({ activePartnershipProposal: { proposalId: 'pr1', initiatorId: 'p2', colorGroup: 'orange', proposedEquity: [{ playerId: 'p2', percentage: 50 }, { playerId: 'p1', percentage: 50 }], acceptedPlayerIds: ['p2'], status: 'pending' } } as any);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, { proposalId: 'pr1' });
  });

  it('dissolves an active partnership I am in', () => {
    base({ partnerships: [{ partnershipId: 'pt1', colorGroup: 'orange', status: 'active', partners: [{ playerId: 'p1', percentage: 60 }, { playerId: 'p2', percentage: 40 }] }] } as any);
    useGameStore.getState().togglePartnershipPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<PartnershipPanel />);
    fireEvent.click(screen.getByRole('button', { name: /dissolve/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, { partnershipId: 'pt1' });
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- PartnershipPanel`.

- [ ] **Step 3: Implement `src/ui/PartnershipPanel.tsx`**

```tsx
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { COLOR_GROUPS } from '../constants/board';
import type { Player, PropertyState, Partnership, PartnershipProposal, PartnershipDissolutionRequest, ColorGroup } from '../types/GameState';

const HOUSEABLE = ['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue'];

export function PartnershipPanel() {
  const open = useGameStore((s) => s.showPartnershipPanel);
  const close = useGameStore((s) => s.togglePartnershipPanel);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const partnerships: Partnership[] = useGameStore((s) => s.state?.partnerships) ?? [];
  const proposal: PartnershipProposal | null = useGameStore((s) => s.state?.activePartnershipProposal) ?? null;
  const dissolution: PartnershipDissolutionRequest | null = useGameStore((s) => s.state?.activePartnershipDissolution) ?? null;
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const proposalForMe = !!proposal && proposal.proposedEquity.some((e) => e.playerId === myId);
  const isOpen = open || proposalForMe || (!!dissolution);
  const [group, setGroup] = useState<string | null>(null);

  if (!isOpen) return null;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const emit = (ev: string, payload: object) => socketManager.emit(ev, payload);

  // eligible houseable groups where I own ≥1 member and no partnership exists yet
  const owns = (idx: number) => properties.find((p) => p.spaceIndex === idx)?.ownerId === myId;
  const eligibleGroups = HOUSEABLE.filter((g) =>
    !partnerships.some((pt) => pt.colorGroup === g) &&
    (COLOR_GROUPS[g] ?? []).some(owns));

  // equity editor: default equal split among owners of the group
  const groupOwners = group ? Array.from(new Set((COLOR_GROUPS[group] ?? []).map((i) => properties.find((p) => p.spaceIndex === i)?.ownerId).filter(Boolean) as string[])) : [];
  const [equity, setEquity] = useState<Record<string, number>>({});
  const eqTotal = groupOwners.reduce((s, id) => s + (equity[id] ?? 0), 0);

  const selectGroup = (g: string) => {
    setGroup(g);
    const owners = Array.from(new Set((COLOR_GROUPS[g] ?? []).map((i) => properties.find((p) => p.spaceIndex === i)?.ownerId).filter(Boolean) as string[]));
    const each = Math.floor(100 / owners.length);
    const eq: Record<string, number> = {};
    owners.forEach((id, i) => (eq[id] = i === 0 ? 100 - each * (owners.length - 1) : each));
    setEquity(eq);
  };
  const propose = () => {
    if (!group || eqTotal !== 100) return;
    emit(EVENTS.PARTNERSHIP_PROPOSE, { colorGroup: group as ColorGroup, proposedEquity: groupOwners.map((id) => ({ playerId: id, percentage: equity[id] ?? 0 })) });
    close(false);
  };

  return (
    <div style={wrap}><div style={card}>
      <div style={hdr}><span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>Partnerships</span>
        <button aria-label="Close" onClick={() => close(false)} style={x}>×</button></div>

      {/* active partnerships */}
      {partnerships.map((pt) => (
        <div key={pt.partnershipId} style={sect}>
          <div style={sh}>{pt.colorGroup} · {pt.partners.map((e) => `${name(e.playerId)} ${e.percentage}%`).join(' / ')}</div>
          {pt.partners.some((e) => e.playerId === myId) && !dissolution && (
            <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, { partnershipId: pt.partnershipId })}>Dissolve</button>
          )}
        </div>
      ))}

      {/* active proposal */}
      {proposal && (
        <div style={{ ...sect, borderColor: '#3fb6c9' }}>
          <div style={sh}>Proposal on {proposal.colorGroup} by {name(proposal.initiatorId)}</div>
          <div style={{ fontSize: 12, color: '#8888a0', marginBottom: 8 }}>
            {proposal.proposedEquity.map((e) => `${name(e.playerId)} ${e.percentage}%${proposal.acceptedPlayerIds.includes(e.playerId) ? ' ✓' : ''}`).join(' · ')}
          </div>
          {proposal.initiatorId === myId ? (
            <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_CANCEL_PROPOSAL, { proposalId: proposal.proposalId })}>Cancel</button>
          ) : proposalForMe && !proposal.acceptedPlayerIds.includes(myId) && (
            <div style={row}>
              <button style={btnP} onClick={() => emit(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, { proposalId: proposal.proposalId })}>Accept</button>
              <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_REJECT_PROPOSAL, { proposalId: proposal.proposalId })}>Reject</button>
            </div>
          )}
        </div>
      )}

      {/* active dissolution */}
      {dissolution && (
        <div style={{ ...sect, borderColor: '#e5533d' }}>
          <div style={sh}>Dissolution requested by {name(dissolution.requesterId)}</div>
          {partnerships.find((pt) => pt.partnershipId === dissolution.partnershipId)?.partners.some((e) => e.playerId === myId) && !dissolution.acceptedPlayerIds.includes(myId) && (
            <div style={row}>
              <button style={btnP} onClick={() => emit(EVENTS.PARTNERSHIP_ACCEPT_DISSOLVE, { dissolutionId: dissolution.dissolutionId })}>Agree</button>
              <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_REJECT_DISSOLVE, { dissolutionId: dissolution.dissolutionId })}>Reject</button>
            </div>
          )}
        </div>
      )}

      {/* propose new */}
      {!proposal && !dissolution && (
        <div style={sect}>
          <div style={sh}>Propose a partnership</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {eligibleGroups.map((g) => (
              <button key={g} onClick={() => selectGroup(g)} style={group === g ? btnP : btn}>{g}</button>
            ))}
            {!eligibleGroups.length && <span style={{ color: '#555570', fontSize: 13 }}>No eligible groups.</span>}
          </div>
          {group && (
            <>
              {groupOwners.map((id) => (
                <div key={id} style={item}>
                  <span style={{ flex: 1 }}>{name(id)}</span>
                  <input type="number" min={1} max={99} value={equity[id] ?? 0} aria-label={`equity ${name(id)}`}
                    onChange={(e) => setEquity({ ...equity, [id]: Math.max(0, +e.target.value) })} style={eq} />%
                </div>
              ))}
              <div style={{ fontSize: 12, color: eqTotal === 100 ? '#46b16a' : '#e5533d', margin: '6px 0' }}>Total {eqTotal}% (must be 100)</div>
              <button style={btnP} disabled={eqTotal !== 100} onClick={propose}>Propose</button>
            </>
          )}
        </div>
      )}
    </div></div>
  );
}

const F = 'ui-rounded, system-ui, sans-serif';
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 420, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 22, cursor: 'pointer' };
const sect: React.CSSProperties = { border: '1px solid #2a2a40', borderRadius: 12, padding: 12, marginBottom: 10 };
const sh: React.CSSProperties = { fontWeight: 800, fontSize: 14, marginBottom: 8 };
const item: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' };
const eq: React.CSSProperties = { width: 60, background: '#08080f', color: '#e8e8f0', border: '1px solid #2a2a40', borderRadius: 8, padding: '4px 6px', fontFamily: F };
const row: React.CSSProperties = { display: 'flex', gap: 10 };
const btn: React.CSSProperties = { fontFamily: F, fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '9px 14px', cursor: 'pointer', background: '#2a2a40', color: '#e8e8f0' };
const btnP: React.CSSProperties = { ...btn, background: '#d4af37', color: '#08080f' };
```

Note: `useState` for `equity` is declared after early returns are avoided (all hooks run before the `if (!isOpen) return null`). VERIFY the hook order — move all `useState` calls above the `if (!isOpen)` guard; the `equity` state must be declared unconditionally at the top with the others. Fix during implementation so no hook is called conditionally.

- [ ] **Step 4: Run, expect pass** — `npm test -- PartnershipPanel` (3). Then full `npm test`. Resolve any hook-order lint by hoisting all `useState` above the `if (!isOpen)` return.

- [ ] **Step 5: Commit**

```bash
git add src/ui/PartnershipPanel.tsx src/ui/PartnershipPanel.test.tsx
git commit -m "feat(negotiation): PartnershipPanel (propose/accept/reject/cancel/dissolve, equity=100)"
```

---

### Task 3: DealPanel (Rent Deal + GO deduction + Negotiation)

**Files:** Create `src/ui/DealPanel.tsx`; Test `src/ui/DealPanel.test.tsx`.

**Interfaces:** Consumes `useGameStore` (`showDealPanel`, `toggleDealPanel`, `state.activeRentDeal`, `state.turn`, `state.players`, `state.properties`, `myPlayerId`), `BOARD_SPACES`, `socketManager`, `EVENTS`, `formatMoney`. Produces `<DealPanel />`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/DealPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DealPanel } from './DealPanel';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import type { GameState } from '../types/GameState';

function base(turn: object, activeRentDeal: unknown = null, money = 15_000_000, goUsed = 0) {
  useGameStore.getState().update({
    roomCode: 'ABCD', status: 'in-progress',
    players: [{ id: 'p1', name: 'Maya', token: 'red', money, position: 5, goDeductionsUsed: goUsed, goSkipsRemaining: 0 },
              { id: 'p2', name: 'Jonas', token: 'blue', money: 9_000_000 }],
    turn: { currentPlayerId: 'p1', ...turn }, config: { maxPlayers: 4 }, properties: [], activeRentDeal,
  } as unknown as GameState);
  useGameStore.getState().setMyPlayerId('p1');
}

describe('DealPanel', () => {
  beforeEach(() => { useGameStore.getState().reset(); vi.restoreAllMocks(); });

  it('is null when not open and no rent owed / deal', () => {
    base({ mustPayRent: false });
    const { container } = render(<DealPanel />);
    expect(container.firstChild).toBe(null);
  });

  it('offers a GO deduction when I owe rent', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /take 2/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.LOAN_GO_DEDUCTION, { count: 2 });
  });

  it('sends a rent-deal offer to the creditor', () => {
    base({ mustPayRent: true, rentAmount: 3_000_000, rentOwnerId: 'p2' });
    useGameStore.getState().toggleDealPanel(true);
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /propose deal|send offer/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_OFFER, expect.objectContaining({
      creditorIds: ['p2'], spaceIndex: 5, totalRentOwed: 3_000_000,
    }));
  });

  it('creditor accepts an active deal (I am not lastOfferBy)', () => {
    base({ mustPayRent: false }, { dealId: 'd1', debtorId: 'p2', creditorIds: ['p1'], spaceIndex: 9, totalRentOwed: 2_000_000, offeredProperties: [], offeredMoney: 1_000_000, requestedExemption: 1_000_000, lastOfferBy: 'p2', acceptedPlayerIds: [], status: 'pending' });
    const emit = vi.spyOn(socketManager, 'emit').mockImplementation(() => {});
    render(<DealPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(emit).toHaveBeenCalledWith(EVENTS.DEAL_ACCEPT, { dealId: 'd1' });
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm test -- DealPanel`.

- [ ] **Step 3: Implement `src/ui/DealPanel.tsx`**

```tsx
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import type { Player, RentDeal } from '../types/GameState';

export function DealPanel() {
  const open = useGameStore((s) => s.showDealPanel);
  const close = useGameStore((s) => s.toggleDealPanel);
  const deal: RentDeal | null = useGameStore((s) => s.state?.activeRentDeal) ?? null;
  const turn = useGameStore((s) => s.state?.turn);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const me = players.find((p) => p.id === myId);
  const owe = !!turn?.mustPayRent && turn.currentPlayerId === myId;
  const involved = !!deal && (deal.debtorId === myId || deal.creditorIds.includes(myId));
  const isOpen = open || involved || owe;

  const [offerMoney, setOfferMoney] = useState(0);
  const [exemption, setExemption] = useState(0);

  if (!isOpen || !turn) return null;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const emit = (ev: string, payload: object) => socketManager.emit(ev, payload);

  // ── active deal negotiation ──
  if (deal) {
    const iAmLast = deal.lastOfferBy === myId;
    const amDebtor = deal.debtorId === myId;
    return (
      <div style={wrap}><div style={card}>
        <Hdr title="Rent Deal" onClose={() => close(false)} />
        <div style={line}>{name(deal.debtorId)} owes {formatMoney(deal.totalRentOwed)}</div>
        <div style={line}>Offer: {formatMoney(deal.offeredMoney)}{deal.offeredProperties.length ? ` + ${deal.offeredProperties.length} propertie(s)` : ''} for {formatMoney(deal.requestedExemption)} exemption</div>
        <div style={{ fontSize: 12, color: '#8888a0', margin: '8px 0' }}>
          {iAmLast ? 'Waiting for the other party…' : 'Respond to the offer'}
        </div>
        <div style={row}>
          {!iAmLast && <>
            <button style={btnP} onClick={() => emit(EVENTS.DEAL_ACCEPT, { dealId: deal.dealId })}>Accept</button>
            <button style={btn} onClick={() => emit(EVENTS.DEAL_COUNTER, { dealId: deal.dealId, offeredProperties: deal.offeredProperties, offeredMoney: deal.offeredMoney, requestedExemption: deal.requestedExemption })}>Counter</button>
            <button style={btn} onClick={() => emit(EVENTS.DEAL_REJECT, { dealId: deal.dealId })}>Reject</button>
          </>}
          {amDebtor && <button style={btn} onClick={() => emit(EVENTS.DEAL_CANCEL, { dealId: deal.dealId })}>Cancel</button>}
        </div>
      </div></div>
    );
  }

  // ── debtor: owe rent, no active deal → GO deduction + offer ──
  const owed = turn.rentAmount ?? 0;
  const creditorIds = turn.rentOwnerId ? [turn.rentOwnerId] : [];
  const goUsed = me?.goDeductionsUsed ?? 0;
  const canGo = (n: number) => goUsed + n <= 5;
  const sendOffer = () => emit(EVENTS.DEAL_OFFER, {
    creditorIds, spaceIndex: me?.position ?? 0, totalRentOwed: owed,
    offeredProperties: [], offeredMoney: offerMoney, requestedExemption: exemption || owed,
  });

  return (
    <div style={wrap}><div style={card}>
      <Hdr title="Can't pay rent?" onClose={() => close(false)} />
      <div style={line}>You owe {formatMoney(owed)} to {creditorIds.map(name).join(', ') || '—'}</div>

      <div style={sect}>
        <div style={sh}>Take a GO advance</div>
        <div style={row}>
          {[1, 2, 3].map((n) => (
            <button key={n} style={btn} disabled={!canGo(n)} onClick={() => emit(EVENTS.LOAN_GO_DEDUCTION, { count: n })}>
              Take {n} ({formatMoney(n * 2_000_000)})
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#8888a0', marginTop: 4 }}>Used {goUsed}/5 lifetime.</div>
      </div>

      <div style={sect}>
        <div style={sh}>Propose a rent deal</div>
        <label style={item}>Offer cash
          <input type="number" min={0} value={offerMoney} aria-label="offer money" onChange={(e) => setOfferMoney(Math.max(0, +e.target.value))} style={inp} /></label>
        <label style={item}>Request exemption
          <input type="number" min={0} max={owed} value={exemption} aria-label="exemption" onChange={(e) => setExemption(Math.max(0, Math.min(owed, +e.target.value)))} style={inp} /></label>
        <button style={btnP} onClick={sendOffer}>Propose deal</button>
      </div>
    </div></div>
  );
}

function Hdr({ title, onClose }: { title: string; onClose: () => void }) {
  return <div style={hdr}><span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{title}</span>
    <button aria-label="Close" onClick={onClose} style={x}>×</button></div>;
}
const F = 'ui-rounded, system-ui, sans-serif';
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 400, maxWidth: '92vw', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', fontSize: 22, cursor: 'pointer' };
const line: React.CSSProperties = { fontSize: 14, margin: '4px 0' };
const sect: React.CSSProperties = { border: '1px solid #2a2a40', borderRadius: 12, padding: 12, marginTop: 12 };
const sh: React.CSSProperties = { fontWeight: 800, fontSize: 14, marginBottom: 8 };
const item: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, margin: '6px 0', gap: 10 };
const inp: React.CSSProperties = { width: 150, background: '#08080f', color: '#e8e8f0', border: '1px solid #2a2a40', borderRadius: 8, padding: '6px 8px', fontFamily: F };
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const btn: React.CSSProperties = { fontFamily: F, fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', background: '#2a2a40', color: '#e8e8f0' };
const btnP: React.CSSProperties = { ...btn, background: '#d4af37', color: '#08080f', marginTop: 10 };
```

- [ ] **Step 4: Run, expect pass** — `npm test -- DealPanel` (4). Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/DealPanel.tsx src/ui/DealPanel.test.tsx
git commit -m "feat(negotiation): DealPanel — rent deal + GO deduction + accept/counter/reject/cancel"
```

---

### Task 4: HudButtons + App wiring

**Files:** Create `src/ui/HudButtons.tsx`; Test `src/ui/HudButtons.test.tsx`; Modify `src/App.tsx`, `src/App.routing.test.tsx`.

- [ ] **Step 1: Failing HudButtons test** — Create `src/ui/HudButtons.test.tsx`: renders Trade / Partnership / Deal buttons; clicking Trade calls `toggleTradePanel(true)` (assert `useGameStore.getState().showTradePanel === true`), Partnership → `showPartnershipPanel`, Deal → `showDealPanel`. (Set an in-progress state first so the HUD mounts.)

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HudButtons } from './HudButtons';
import { useGameStore } from '../state/gameStore';

describe('HudButtons', () => {
  beforeEach(() => useGameStore.getState().reset());
  it('opens each negotiation panel via its store flag', () => {
    render(<HudButtons />);
    fireEvent.click(screen.getByRole('button', { name: /trade/i }));
    expect(useGameStore.getState().showTradePanel).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /partnership/i }));
    expect(useGameStore.getState().showPartnershipPanel).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /deal/i }));
    expect(useGameStore.getState().showDealPanel).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `src/ui/HudButtons.tsx`** — a small fixed button cluster (bottom-left) with three buttons calling `toggleTradePanel(true)` / `togglePartnershipPanel(true)` / `toggleDealPanel(true)` from the store.

```tsx
import { useGameStore } from '../state/gameStore';

export function HudButtons() {
  const trade = useGameStore((s) => s.toggleTradePanel);
  const partnership = useGameStore((s) => s.togglePartnershipPanel);
  const deal = useGameStore((s) => s.toggleDealPanel);
  return (
    <div style={wrap}>
      <button style={btn} onClick={() => trade(true)}>Trade</button>
      <button style={btn} onClick={() => partnership(true)}>Partnership</button>
      <button style={btn} onClick={() => deal(true)}>Deal</button>
    </div>
  );
}
const F = 'ui-rounded, system-ui, sans-serif';
const wrap: React.CSSProperties = { position: 'fixed', bottom: 14, left: 14, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 30, fontFamily: F };
const btn: React.CSSProperties = { fontFamily: F, fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '9px 14px', cursor: 'pointer', background: '#12121e', color: '#e8e8f0', boxShadow: '0 8px 22px -12px rgba(0,0,0,.6)' };
```

Run: `npm test -- HudButtons` → pass (1).

- [ ] **Step 3: App wiring test (RED)** — In `src/App.routing.test.tsx`, add a test that landing in rent (`turn.mustPayRent === true` for me) auto-opens the deal panel:

```tsx
it('auto-opens the deal panel when I must pay rent', () => {
  useGameStore.getState().setMyPlayerId('p1');
  useGameStore.getState().update({ roomCode: 'A', status: 'in-progress', players: [{ id: 'p1', name: 'M', token: 'red' }], turn: { currentPlayerId: 'p1', mustPayRent: true }, config: { maxPlayers: 4 }, properties: [] } as any);
  useGameStore.getState().setScreen('game');
  render(<App />);
  expect(useGameStore.getState().showDealPanel).toBe(true);
});
```

Run: `npm test -- App.routing` → the new test FAILS (no auto-open yet).

- [ ] **Step 4: Edit `src/App.tsx`** — import `TradePanel`, `PartnershipPanel`, `DealPanel`, `HudButtons`. In the `screen==='game'` branch render all four (after the existing HUD/modals). Add two effects:
  - `gameBus 'open-negotiation'` → `toggleDealPanel(true)` (via `useGameBusEvent`).
  - auto-open deal when I owe rent: `const mustPay = useGameStore(s => s.state?.turn.mustPayRent && s.state?.turn.currentPlayerId === s.myPlayerId); useEffect(() => { if (mustPay) toggleDealPanel(true); }, [mustPay, toggleDealPanel]);`
  Keep all prior wiring intact.

- [ ] **Step 5: Verify** — `npm test -- App.routing` (pass), full `npm test` (all pass), `npm run build` (green).

- [ ] **Step 6: Commit**

```bash
git add src/ui/HudButtons.tsx src/ui/HudButtons.test.tsx src/App.tsx src/App.routing.test.tsx
git commit -m "feat(negotiation): HudButtons + wire Trade/Partnership/Deal panels + rent auto-open"
```

---

### Task 5: Push + PR

- [ ] **Step 1:** Commit the plan doc if untracked (`git add docs/2026-07-22-mockopoly-3d-phase-3c-negotiation.md && git commit -m "docs: add Phase 3c plan"`). `git status --porcelain` (empty), `npm test` (all pass), `npm run build` (green).
- [ ] **Step 2:** `git push -u origin feat/hud-negotiation`
- [ ] **Step 3:** `gh pr create --repo mockopoly-js/mockopoly-client-3d --base main --head feat/hud-negotiation --title "Phase 3c: negotiation modals (Trade, Partnership, Rent Deal + GO)" --body "Completes Phase 3 parity: TradePanel (propose/accept/counter/reject/cancel), PartnershipPanel (propose/accept/reject/cancel/dissolve, equity=100), DealPanel (rent deal + GO deduction + accept/counter/reject/cancel with lastOfferBy/quorum), HudButtons, and App wiring (rent auto-open, open-negotiation). Snapshot-driven; no network/contract/board edits. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"`
- [ ] **Step 4:** Do NOT merge from a task. Report the PR URL.

---

## Self-Review

**Spec coverage (Phase 3 §10, negotiation subset):** Trade → Task 1; Partnership → Task 2; Rent Deal + Negotiation + GO → Task 3; wiring/open triggers → Task 4. With 3a (HUD) + 3b (mortgage/devhacks), Phase 3 reaches 2D feature parity.

**Placeholder scan:** complete code in each step. The PartnershipPanel hook-order note is an explicit correctness instruction (hoist all `useState` above the `if (!isOpen)` return), not a TODO.

**Type consistency:** reuses existing store flags/toggles; event constants + C_ payloads match the contract exactly; state fields (`activeTrade`, `activeRentDeal`, `activePartnershipProposal/Dissolution`, `partnerships`, `turn.mustPayRent/rentAmount/rentOwnerId`) verbatim.

**Executor notes:** all plain-HTML (unit-testable). React hooks must all run before any early return — verify in Trade/Partnership/Deal (move `useState` to the top). Task 4 is App composition (build + routing test). Server is authoritative; client gates are UX.

## Execution Handoff

Execute via superpowers:subagent-driven-development — fresh implementer per task, task review + fix loop, final whole-branch review, PR, merge. This completes Phase 3; Phase 4 (physics dice + juice + HDRI/postFX + big-moment overlays) is the next spec phase.
