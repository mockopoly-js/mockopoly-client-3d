import { FONT_FAMILY } from '../constants/fonts';

export function LoadingScreen() {
  return (
    <>
      <style>{`
        @keyframes _lsSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#08080f',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          zIndex: 9999,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '4px solid #2a2a40',
            borderTopColor: '#d4af37',
            animation: '_lsSpin 0.8s linear infinite',
          }}
        />
        <span
          style={{
            color: '#d4af37',
            fontFamily: FONT_FAMILY,
            fontSize: 18,
            letterSpacing: 2,
          }}
        >
          Loading&hellip;
        </span>
      </div>
    </>
  );
}
