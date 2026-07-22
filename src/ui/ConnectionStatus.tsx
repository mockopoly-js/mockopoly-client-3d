interface Props {
  connected: boolean;
  playerId: string | null;
}

export function ConnectionStatus({ connected, playerId }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        padding: '8px 14px',
        borderRadius: 999,
        fontFamily: 'ui-rounded, system-ui, sans-serif',
        fontWeight: 700,
        fontSize: 13,
        color: '#fffdf8',
        background: connected ? '#2f9153' : '#e07d0a',
        boxShadow: '0 8px 22px -10px rgba(80,60,20,.45)',
      }}
    >
      {connected ? `Connected · ${playerId ?? 'no id yet'}` : 'Connecting…'}
    </div>
  );
}
