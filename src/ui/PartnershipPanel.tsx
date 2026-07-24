import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';
import { COLOR_GROUPS } from '../constants/board';
import { useIsMobile } from './useIsMobile';
import type { Player, PropertyState, Partnership, PartnershipProposal, PartnershipDissolutionRequest, ColorGroup } from '../types/GameState';
import { FONT_FAMILY } from '../constants/fonts';

const HOUSEABLE = ['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue'];

export function PartnershipPanel() {
  // ── All hooks MUST be declared unconditionally before any early return ──
  const open = useGameStore((s) => s.showPartnershipPanel);
  const close = useGameStore((s) => s.togglePartnershipPanel);
  const players: Player[] = useGameStore((s) => s.state?.players) ?? [];
  const properties: PropertyState[] = useGameStore((s) => s.state?.properties) ?? [];
  const partnerships: Partnership[] = useGameStore((s) => s.state?.partnerships) ?? [];
  const proposal: PartnershipProposal | null = useGameStore((s) => s.state?.activePartnershipProposal) ?? null;
  const dissolution: PartnershipDissolutionRequest | null = useGameStore((s) => s.state?.activePartnershipDissolution) ?? null;
  const myId = useGameStore((s) => s.myPlayerId) ?? '';

  // useState hooks all at the top, before any conditional return
  const [group, setGroup] = useState<string | null>(null);
  const [equity, setEquity] = useState<Record<string, number>>({});
  const isMobile = useIsMobile();

  // Derived (non-hook) values — computed after hooks, before early return
  const proposalForMe = !!proposal && proposal.proposedEquity.some((e) => e.playerId === myId);
  const isOpen = open || proposalForMe || !!dissolution;

  if (!isOpen) return null;

  // Helper functions (non-hook, safe after early return)
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const emit = (ev: string, payload: object) => socketManager.emit(ev, payload);

  const ownerOf = (idx: number) => properties.find((p) => p.spaceIndex === idx)?.ownerId ?? null;
  const eligibleGroups = HOUSEABLE.filter((g) => {
    const groupIndices = COLOR_GROUPS[g] ?? [];
    // No active partnership already exists for this group
    if (partnerships.some((pt) => pt.colorGroup === g)) return false;
    // All group members must be owned (no unowned spaces)
    if (!groupIndices.every((idx) => ownerOf(idx) !== null)) return false;
    // Must have ≥2 distinct owners across the group (a partnership requires co-owners)
    const owners = new Set(groupIndices.map(ownerOf));
    if (owners.size < 2) return false;
    // I must own at least one property in the group
    return groupIndices.some((idx) => ownerOf(idx) === myId);
  });

  const groupOwners = group
    ? Array.from(new Set(
        (COLOR_GROUPS[group] ?? [])
          .map((i) => properties.find((p) => p.spaceIndex === i)?.ownerId)
          .filter(Boolean) as string[]
      ))
    : [];

  const eqTotal = groupOwners.reduce((s, id) => s + (equity[id] ?? 0), 0);

  const selectGroup = (g: string) => {
    setGroup(g);
    const owners = Array.from(new Set(
      (COLOR_GROUPS[g] ?? [])
        .map((i) => properties.find((p) => p.spaceIndex === i)?.ownerId)
        .filter(Boolean) as string[]
    ));
    const each = Math.floor(100 / owners.length);
    const eq: Record<string, number> = {};
    owners.forEach((id, i) => (eq[id] = i === 0 ? 100 - each * (owners.length - 1) : each));
    setEquity(eq);
  };

  const propose = () => {
    if (!group || eqTotal !== 100) return;
    emit(EVENTS.PARTNERSHIP_PROPOSE, {
      colorGroup: group as ColorGroup,
      proposedEquity: groupOwners.map((id) => ({ playerId: id, percentage: equity[id] ?? 0 })),
    });
    close(false);
  };

  const outerWrap = isMobile ? wrapMobile : wrap;
  const innerCard = isMobile ? sheetMobile : card;

  return (
    <div style={outerWrap}>
      <div style={innerCard}>
        <div style={hdr}>
          <span style={{ flex: 1, fontWeight: 800, fontSize: 18 }}>Partnerships</span>
          <button aria-label="Close" onClick={() => close(false)} style={x}><X size={18} aria-hidden /></button>
        </div>

        {/* Active partnerships */}
        {partnerships.map((pt) => (
          <div key={pt.partnershipId} style={sect}>
            <div style={sh}>{pt.colorGroup} · {pt.partners.map((e) => `${name(e.playerId)} ${e.percentage}%`).join(' / ')}</div>
            {pt.partners.some((e) => e.playerId === myId) && !dissolution && (
              <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, { partnershipId: pt.partnershipId })}>
                Dissolve
              </button>
            )}
          </div>
        ))}

        {/* Active proposal */}
        {proposal && (
          <div style={{ ...sect, borderColor: '#3fb6c9' }}>
            <div style={sh}>Proposal on {proposal.colorGroup} by {name(proposal.initiatorId)}</div>
            <div style={{ fontSize: 12, color: '#8888a0', marginBottom: 8 }}>
              {proposal.proposedEquity
                .map((e, i) => (
                  <span key={e.playerId} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {i > 0 && ' · '}
                    {`${name(e.playerId)} ${e.percentage}%`}
                    {proposal.acceptedPlayerIds.includes(e.playerId) && <Check size={14} aria-hidden style={{ marginLeft: 2 }} />}
                  </span>
                ))}
            </div>
            {proposal.initiatorId === myId ? (
              <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_CANCEL_PROPOSAL, { proposalId: proposal.proposalId })}>
                Cancel
              </button>
            ) : proposalForMe && !proposal.acceptedPlayerIds.includes(myId) ? (
              <div style={row}>
                <button style={btnP} onClick={() => emit(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, { proposalId: proposal.proposalId })}>
                  Accept
                </button>
                <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_REJECT_PROPOSAL, { proposalId: proposal.proposalId })}>
                  Reject
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Active dissolution request */}
        {dissolution && (
          <div style={{ ...sect, borderColor: '#e5533d' }}>
            <div style={sh}>Dissolution requested by {name(dissolution.requesterId)}</div>
            {partnerships.find((pt) => pt.partnershipId === dissolution.partnershipId)?.partners.some((e) => e.playerId === myId) &&
              !dissolution.acceptedPlayerIds.includes(myId) && (
              <div style={row}>
                <button style={btnP} onClick={() => emit(EVENTS.PARTNERSHIP_ACCEPT_DISSOLVE, { dissolutionId: dissolution.dissolutionId })}>
                  Agree
                </button>
                <button style={btn} onClick={() => emit(EVENTS.PARTNERSHIP_REJECT_DISSOLVE, { dissolutionId: dissolution.dissolutionId })}>
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

        {/* Propose new partnership */}
        {!proposal && !dissolution && (
          <div style={sect}>
            <div style={sh}>Propose a partnership</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {eligibleGroups.map((g) => (
                <button key={g} onClick={() => selectGroup(g)} style={group === g ? btnP : btn}>
                  {g}
                </button>
              ))}
              {!eligibleGroups.length && (
                <span style={{ color: '#555570', fontSize: 13 }}>No eligible groups.</span>
              )}
            </div>
            {group && (
              <>
                {groupOwners.map((id) => (
                  <div key={id} style={item}>
                    <span style={{ flex: 1 }}>{name(id)}</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={equity[id] ?? 0}
                      aria-label={`equity ${name(id)}`}
                      onChange={(e) => setEquity({ ...equity, [id]: Math.max(0, +e.target.value) })}
                      style={eqInput}
                    />%
                  </div>
                ))}
                <div style={{ fontSize: 12, color: eqTotal === 100 ? '#46b16a' : '#e5533d', margin: '6px 0' }}>
                  Total {eqTotal}% (must be 100)
                </div>
                <button style={btnP} disabled={eqTotal !== 100} onClick={propose}>
                  Propose
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const F = FONT_FAMILY;
// ── Desktop styles (unchanged) ──
const wrap: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
  background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F,
};
const card: React.CSSProperties = {
  background: '#12121e', color: '#e8e8f0', borderRadius: 16, padding: 20,
  width: 420, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto',
  boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)',
};
// ── Mobile bottom-sheet styles ──
const wrapMobile: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40, fontFamily: F, display: 'flex', alignItems: 'flex-end' };
const sheetMobile: React.CSSProperties = { background: '#12121e', color: '#e8e8f0', borderRadius: '20px 20px 0 0', padding: 20, width: '100vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 -8px 40px -8px rgba(0,0,0,.7)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' };
const hdr: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#8888a0', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 0 };
const sect: React.CSSProperties = { border: '1px solid #2a2a40', borderRadius: 12, padding: 12, marginBottom: 10 };
const sh: React.CSSProperties = { fontWeight: 800, fontSize: 14, marginBottom: 8 };
const item: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' };
const eqInput: React.CSSProperties = {
  width: 60, background: '#08080f', color: '#e8e8f0',
  border: '1px solid #2a2a40', borderRadius: 8, padding: '4px 6px', fontFamily: F,
};
const row: React.CSSProperties = { display: 'flex', gap: 10 };
const btn: React.CSSProperties = {
  fontFamily: F, fontWeight: 800, fontSize: 13, border: 'none',
  borderRadius: 12, padding: '9px 14px', cursor: 'pointer',
  background: '#2a2a40', color: '#e8e8f0',
};
const btnP: React.CSSProperties = { ...btn, background: '#d4af37', color: '#08080f' };
