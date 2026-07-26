import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
import { useIsLandscape } from './useIsLandscape';
import type { Player, RentDeal, PropertyState } from '../types/GameState';
import { BOARD_SPACES } from '../constants/board';
import { FONT_FAMILY } from '../constants/fonts';

// ── Property Picker ────────────────────────────────────────────────────────────
// Shared checklist of the debtor's eligible properties (owned, not mortgaged,
// no buildings). Used in both the initial offer and the counter edit mode.

interface PropertyPickerProps {
  eligibleProps: PropertyState[];
  selected: Set<number>;
  onToggle: (idx: number) => void;
}

function PropertyPicker({ eligibleProps, selected, onToggle }: PropertyPickerProps) {
  if (eligibleProps.length === 0) {
    return <div style={{ fontSize: 12, color: '#555570', fontStyle: 'italic', margin: '4px 0 8px' }}>No eligible properties to offer</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
      {eligibleProps.map((p) => {
        const space = BOARD_SPACES.find((s) => s.index === p.spaceIndex);
        const name = space?.name ?? `Space #${p.spaceIndex}`;
        const isSelected = selected.has(p.spaceIndex);
        return (
          <button
            key={p.spaceIndex}
            onClick={() => onToggle(p.spaceIndex)}
            style={{
              fontFamily: FONT_FAMILY,
              display: 'flex', alignItems: 'center', gap: 8,
              background: isSelected ? 'rgba(212,175,55,0.15)' : '#1a1a2e',
              border: isSelected ? '1px solid #d4af37' : '1px solid #333350',
              borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
              color: isSelected ? '#d4af37' : '#e8e8f0', fontSize: 12, textAlign: 'left',
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 3, border: isSelected ? 'none' : '1px solid #555570', background: isSelected ? '#d4af37' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#08080f', flexShrink: 0 }}>
              {isSelected ? <Check size={14} aria-hidden /> : null}
            </span>
            {name}
          </button>
        );
      })}
    </div>
  );
}

// ── DealPanel ──────────────────────────────────────────────────────────────────

export function DealPanel() {
  const open = useGameStore((s) => s.showDealPanel);
  const close = useGameStore((s) => s.toggleDealPanel);
  const deal: RentDeal | null = useGameStore((s) => s.state?.activeRentDeal) ?? null;
  const turn = useGameStore((s) => s.state?.turn);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const allProperties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  const me = players.find((p) => p.id === myId);
  const owe = !!turn?.mustPayRent && turn.currentPlayerId === myId;
  const involved = !!deal && (deal.debtorId === myId || deal.creditorIds.includes(myId));
  const isOpen = open || involved || owe;

  // Hooks MUST be before early return to avoid conditional hook errors
  const [offerMoney, setOfferMoney] = useState(0);
  const [exemption, setExemption] = useState(0);
  // Property selection for initial offer
  const [selectedOfferProps, setSelectedOfferProps] = useState<Set<number>>(new Set());
  // Counter edit mode
  const [counterMode, setCounterMode] = useState(false);
  const [counterMoney, setCounterMoney] = useState(0);
  const [counterExemption, setCounterExemption] = useState(0);
  const [selectedCounterProps, setSelectedCounterProps] = useState<Set<number>>(new Set());

  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  const landscape = isMobile && isLandscape;

  if (!isOpen || !turn) return null;

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const emit = (ev: string, payload: object) => socketManager.emit(ev, payload);

  const outerWrap = landscape ? wrapLandscape : isMobile ? wrapMobile : wrap;
  const innerCard = landscape ? cardLandscape : isMobile ? sheetMobile : card;
  // In landscape, lay two sections side-by-side (wide + short); otherwise stack
  // them exactly as before (fragment is transparent — identical DOM).
  const sectStyle = landscape ? sectFlex : sect;
  const twoSects = (a: React.ReactNode, b: React.ReactNode) =>
    landscape ? <div style={sectRow}>{a}{b}</div> : <>{a}{b}</>;

  // Helper: compute eligible properties for a given player id
  const eligibleProps = (ownerId: string): PropertyState[] =>
    allProperties.filter(
      (p) => p.ownerId === ownerId && !p.isMortgaged && p.houses === 0 && !p.hasHotel
    );

  // Toggle helpers
  const toggleOfferProp = (idx: number) => {
    const next = new Set(selectedOfferProps);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelectedOfferProps(next);
  };
  const toggleCounterProp = (idx: number) => {
    const next = new Set(selectedCounterProps);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelectedCounterProps(next);
  };

  // ── active deal negotiation ──
  if (deal) {
    const iAmLast = deal.lastOfferBy === myId;
    const amDebtor = deal.debtorId === myId;
    const debtorEligible = eligibleProps(deal.debtorId);

    // Counter edit mode: pre-fill from deal when first entered
    const enterCounterMode = () => {
      setCounterMoney(deal.offeredMoney);
      setCounterExemption(deal.requestedExemption);
      setSelectedCounterProps(new Set(deal.offeredProperties));
      setCounterMode(true);
    };

    const sendCounter = () => {
      emit(EVENTS.DEAL_COUNTER, {
        dealId: deal.dealId,
        offeredProperties: Array.from(selectedCounterProps),
        offeredMoney: counterMoney,
        requestedExemption: counterExemption,
      });
      setCounterMode(false);
    };

    if (counterMode) {
      return (
        <div style={outerWrap}><div style={innerCard}>
          <Hdr title="Counter Offer" onClose={() => { setCounterMode(false); close(false); }} />
          <div style={line}>{name(deal.debtorId)} owes {formatMoney(deal.totalRentOwed)} total</div>

          {twoSects(
            <div style={sectStyle}>
              <div style={sh}>Properties to offer</div>
              <PropertyPicker
                eligibleProps={debtorEligible}
                selected={selectedCounterProps}
                onToggle={toggleCounterProp}
              />
            </div>,
            <div style={sectStyle}>
              <label style={item}>Cash to offer
                <input type="number" min={0} value={counterMoney} aria-label="counter money"
                  onChange={(e) => setCounterMoney(Math.max(0, +e.target.value))} style={inp} /></label>
              <label style={item}>Exemption requested
                <input type="number" min={0} max={deal.totalRentOwed} value={counterExemption} aria-label="counter exemption"
                  onChange={(e) => setCounterExemption(Math.max(0, Math.min(deal.totalRentOwed, +e.target.value)))} style={inp} /></label>
            </div>,
          )}

          <div style={row}>
            <button style={btnP} onClick={sendCounter}>Send Counter</button>
            <button style={btn} onClick={() => setCounterMode(false)}>Back</button>
          </div>
        </div></div>
      );
    }

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
            <button style={btn} onClick={enterCounterMode}>Counter</button>
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
  const goSkips = me?.goSkipsRemaining ?? 0;
  const canGo = (n: number) => goUsed + n <= 5;

  // Eligible properties for the initial offer (debtor = me)
  const myEligibleProps = eligibleProps(myId);

  const sendOffer = () => emit(EVENTS.DEAL_OFFER, {
    creditorIds, spaceIndex: me?.position ?? 0, totalRentOwed: owed,
    offeredProperties: Array.from(selectedOfferProps), offeredMoney: offerMoney,
    requestedExemption: exemption || owed,
  });

  return (
    <div style={outerWrap}><div style={innerCard}>
      <Hdr title="Can't pay rent?" onClose={() => close(false)} />
      <div style={line}>You owe {formatMoney(owed)} to {creditorIds.map(name).join(', ') || '—'}</div>

      {twoSects(
        <div style={sectStyle}>
          <div style={sh}>Take a GO advance</div>
          <div style={row}>
            {[1, 2, 3].map((n) => (
              <button key={n} style={btn} disabled={!canGo(n)} onClick={() => emit(EVENTS.LOAN_GO_DEDUCTION, { count: n })}>
                Take {n} ({formatMoney(n * 2_000_000)})
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#8888a0', marginTop: 4 }}>Used {goUsed}/5 lifetime.</div>
          {goSkips > 0 && (
            <div style={{ fontSize: 11, color: '#8888a0', marginTop: 2 }}>GO passes to skip: {goSkips}</div>
          )}
        </div>,
        <div style={sectStyle}>
          <div style={sh}>Propose a rent deal</div>
          <div style={{ fontSize: 12, color: '#8888a0', marginBottom: 6 }}>Properties to offer:</div>
          <PropertyPicker
            eligibleProps={myEligibleProps}
            selected={selectedOfferProps}
            onToggle={toggleOfferProp}
          />
          <label style={item}>Offer cash
            <input type="number" min={0} value={offerMoney} aria-label="offer money" onChange={(e) => setOfferMoney(Math.max(0, +e.target.value))} style={inp} /></label>
          <label style={item}>Request exemption
            <input type="number" min={0} max={owed} value={exemption} aria-label="exemption" onChange={(e) => setExemption(Math.max(0, Math.min(owed, +e.target.value)))} style={inp} /></label>
          <button style={btnP} onClick={sendOffer}>Propose deal</button>
        </div>,
      )}
    </div></div>
  );
}

function Hdr({ title, onClose }: { title: string; onClose: () => void }) {
  return <div style={hdr}><span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{title}</span>
    <button aria-label="Close" onClick={onClose} style={x}><X size={18} aria-hidden /></button></div>;
}

const F = FONT_FAMILY;
// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 400, maxWidth: '92vw', maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
// ── Mobile bottom-sheet styles ──
const wrapMobile: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F, display: 'flex', alignItems: 'flex-end' };
const sheetMobile: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: '20px 20px 0 0', padding: 20, width: '100vw', maxHeight: '85dvh', overflowY: 'auto', boxShadow: '0 -8px 40px -8px rgba(0,0,0,.7)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', paddingLeft: 'calc(20px + env(safe-area-inset-left))', paddingRight: 'calc(20px + env(safe-area-inset-right))', boxSizing: 'border-box' };
// ── Mobile LANDSCAPE styles (wide + short) ──
const wrapLandscape: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F, display: 'flex', boxSizing: 'border-box', padding: 'max(8px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))' };
const cardLandscape: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 16, width: 'min(680px, 100%)', maxHeight: '100%', overflowY: 'auto', margin: 'auto', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)', boxSizing: 'border-box' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 0 };
const line: React.CSSProperties = { fontSize: 14, margin: '4px 0' };
const sect: React.CSSProperties = { border: '1px solid #2a2a40', borderRadius: 12, padding: 12, marginTop: 12 };
// Landscape: two sections side-by-side; each fills half the wide card.
const sectRow: React.CSSProperties = { display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 12 };
const sectFlex: React.CSSProperties = { ...sect, flex: 1, minWidth: 0, marginTop: 0 };
const sh: React.CSSProperties = { fontWeight: 800, fontSize: 14, marginBottom: 8 };
const item: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, margin: '6px 0', gap: 10 };
const inp: React.CSSProperties = { width: 150, maxWidth: '45vw', background: '#08080f', color: '#e8e8f0', border: '1px solid #2a2a40', borderRadius: 8, padding: '6px 8px', fontFamily: F, minHeight: 44, boxSizing: 'border-box' };
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const btn: React.CSSProperties = { fontFamily: F, fontWeight: 800, fontSize: 13, border: 'none', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', background: '#2a2a40', color: '#e8e8f0', minHeight: 44 };
const btnP: React.CSSProperties = { ...btn, background: '#d4af37', color: '#08080f', marginTop: 10 };
