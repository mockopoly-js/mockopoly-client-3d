import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES } from '../constants/board';
import { formatMoney } from '../utils/format';
import { useIsMobile } from './useIsMobile';
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
  const isMobile = useIsMobile();

  // ALL useState calls MUST come before the early return to satisfy React hooks rules
  const [opp, setOpp] = useState<string | null>(null);
  const [offer, setOffer] = useState<number[]>([]);
  const [request, setRequest] = useState<number[]>([]);
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [countering, setCountering] = useState(false);

  const incoming = activeTrade && activeTrade.toPlayerId === myId;
  const isOpen = open || !!activeTrade;

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
    setOffer(activeTrade.requestedProperties);
    setRequest(activeTrade.offeredProperties);
    setOfferMoney(activeTrade.requestedMoney);
    setRequestMoney(activeTrade.offeredMoney);
    setCountering(true);
  };

  // ── active trade view (not countering) ──
  if (activeTrade && !countering) {
    return (
      <Shell title="Trade" onClose={() => close(false)} isMobile={isMobile}>
        <div style={sub}>{name(activeTrade.fromPlayerId)} → {name(activeTrade.toPlayerId)}</div>
        <Cols
          giveLabel={`${name(activeTrade.fromPlayerId)} gives`}
          getLabel={`${name(activeTrade.toPlayerId)} gets`}
          gives={[...activeTrade.offeredProperties.map(propName), ...(activeTrade.offeredMoney ? [formatMoney(activeTrade.offeredMoney)] : [])]}
          gets={[...activeTrade.requestedProperties.map(propName), ...(activeTrade.requestedMoney ? [formatMoney(activeTrade.requestedMoney)] : [])]}
        />
        <div style={row}>
          {incoming ? (
            <>
              <button style={btnP} onClick={() => act(EVENTS.TRADE_ACCEPT)}>Accept</button>
              <button style={btn} onClick={startCounter}>Counter</button>
              <button style={btn} onClick={() => act(EVENTS.TRADE_REJECT)}>Reject</button>
            </>
          ) : activeTrade.fromPlayerId === myId ? (
            <button style={btn} onClick={() => act(EVENTS.TRADE_CANCEL)}>Cancel</button>
          ) : (
            <div style={{ color: '#8888a0' }}>Trade in progress…</div>
          )}
        </div>
      </Shell>
    );
  }

  // ── proposal / counter form ──
  const targetId = countering ? activeTrade!.fromPlayerId : opp;
  const myProps = tradeable(properties, myId);
  const theirProps = targetId ? tradeable(properties, targetId) : [];

  return (
    <Shell
      title={countering ? 'Counter offer' : 'Propose trade'}
      onClose={() => { close(false); setCountering(false); }}
      isMobile={isMobile}
    >
      {!countering && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {players.filter((p) => p.id !== myId && !p.isBankrupt).map((p) => (
            <button key={p.id} onClick={() => setOpp(p.id)} style={opp === p.id ? btnP : btn}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      {targetId && (
        <>
          <div style={twoCol}>
            <div>
              <div style={colHdr}>You give</div>
              {myProps.map((p) => (
                <label key={p.spaceIndex} style={item}>
                  <input
                    data-testid={`offer-${p.spaceIndex}`}
                    type="checkbox"
                    checked={offer.includes(p.spaceIndex)}
                    onChange={() => toggle(offer, setOffer, p.spaceIndex)}
                  />
                  {propName(p.spaceIndex)}
                </label>
              ))}
              <input
                type="number"
                value={offerMoney}
                min={0}
                onChange={(e) => setOfferMoney(Math.max(0, +e.target.value))}
                style={money}
                aria-label="offer money"
              />
            </div>
            <div>
              <div style={colHdr}>You get</div>
              {theirProps.map((p) => (
                <label key={p.spaceIndex} style={item}>
                  <input
                    data-testid={`request-${p.spaceIndex}`}
                    type="checkbox"
                    checked={request.includes(p.spaceIndex)}
                    onChange={() => toggle(request, setRequest, p.spaceIndex)}
                  />
                  {propName(p.spaceIndex)}
                </label>
              ))}
              <input
                type="number"
                value={requestMoney}
                min={0}
                onChange={(e) => setRequestMoney(Math.max(0, +e.target.value))}
                style={money}
                aria-label="request money"
              />
            </div>
          </div>
          <div style={row}>
            <button
              style={btnP}
              onClick={countering ? sendCounter : send}
              disabled={!offer.length && !request.length && !offerMoney && !requestMoney}
            >
              {countering ? 'Send counter' : 'Send offer'}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

// ── shared modal bits ──
function Shell({ title, onClose, children, isMobile }: { title: string; onClose: () => void; children: React.ReactNode; isMobile?: boolean }) {
  if (isMobile) {
    return (
      <div style={wrapMobile}>
        <div style={sheetMobile}>
          <div style={hdr}>
            <span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{title}</span>
            <button aria-label="Close" onClick={onClose} style={x}>×</button>
          </div>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={hdr}>
          <span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>{title}</span>
          <button aria-label="Close" onClick={onClose} style={x}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Cols({ giveLabel, getLabel, gives, gets }: { giveLabel: string; getLabel: string; gives: string[]; gets: string[] }) {
  return (
    <div style={twoCol}>
      <div>
        <div style={colHdr}>{giveLabel}</div>
        {gives.length
          ? gives.map((g, i) => <div key={i} style={item}>{g}</div>)
          : <div style={{ color: '#555570' }}>—</div>}
      </div>
      <div>
        <div style={colHdr}>{getLabel}</div>
        {gets.length
          ? gets.map((g, i) => <div key={i} style={item}>{g}</div>)
          : <div style={{ color: '#555570' }}>—</div>}
      </div>
    </div>
  );
}

const F = 'ui-rounded, system-ui, sans-serif';
// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F };
const card: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20, width: 420, maxWidth: '92vw', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)' };
// ── Mobile bottom-sheet styles ──
const wrapMobile: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F, display: 'flex', alignItems: 'flex-end' };
const sheetMobile: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: '20px 20px 0 0', padding: 20, width: '100vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 -8px 40px -8px rgba(0,0,0,.7)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' };
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
