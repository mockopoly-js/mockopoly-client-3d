import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import type { ToastType } from '../types/ui';

const COLOR: Record<ToastType, string> = {
  info: '#3fb6c9', success: '#46b16a', warning: '#e0a30a', error: '#e5533d',
};

export function ToastLayer() {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);
  const scheduled = useRef<Set<number>>(new Set());

  useEffect(() => {
    for (const t of toasts) {
      if (scheduled.current.has(t.timestamp)) continue;
      scheduled.current.add(t.timestamp);
      setTimeout(() => {
        removeToast(t.timestamp);
        scheduled.current.delete(t.timestamp);
      }, 3000);
    }
  }, [toasts, removeToast]);

  if (!toasts.length) return null;
  return (
    <div style={wrap}>
      {toasts.map((t, i) => (
        <div key={`${t.timestamp}-${i}`} style={{ ...toast, borderLeft: `4px solid ${COLOR[t.type]}` }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', gap: 8, zIndex: 45, pointerEvents: 'none',
  fontFamily: 'ui-rounded, system-ui, sans-serif', alignItems: 'center',
};
const toast: React.CSSProperties = {
  background: '#12121e', color: '#e8e8f0', padding: '8px 16px', borderRadius: 10,
  fontWeight: 700, fontSize: 13, boxShadow: '0 8px 22px -10px rgba(0,0,0,.6)', maxWidth: 360,
};
