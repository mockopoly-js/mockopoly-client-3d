import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import type { Player, RentDeal } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';

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

  // Hooks MUST be before early return to avoid conditional hook errors
  const [offerMoney, setOfferMoney] = useState(0);
  const [exemption, setExemption] = useState(0);
  const isMobile = useIsMobile();

  if (!isOpen || !turn) return null;

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const emit = (ev: string, payload: object) => socketManager.emit(ev, payload);

  const outerWrap = isMobile ? wrapMobile : wrap;
  const innerCard = isMobile ? sheetMobile : card;

  // ── active deal negotiation ──
  if (deal) {
    const iAmLast = deal.lastOfferBy === myId;
    const amDebtor = deal.debtorId === myId;
    return (
      <div style={outerWrap}><div style={innerCard}>
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
    <div style={outerWrap}><div style={innerCard}>
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

const F = FONT_FAMILY;
// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 400, maxWidth: '92vw', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
// ── Mobile bottom-sheet styles ──
const wrapMobile: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F, display: 'flex', alignItems: 'flex-end' };
const sheetMobile: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: '20px 20px 0 0', padding: 20, width: '100vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 -8px 40px -8px rgba(0,0,0,.7)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' };
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
