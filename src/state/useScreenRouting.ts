import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGameStore, type Screen } from './gameStore';
import { socketManager } from '../network/SocketManager';
import { EVENTS } from '../types/SocketEvents';

// ─── Client-side routing ↔ game-flow sync ────────────────────────────────────
//
// `store.screen` stays the single source of truth for the game flow; the URL
// mirrors it. This hook keeps the two in sync bidirectionally WITHOUT a loop:
//
//   • screen → URL  : entering a room (menu → lobby) PUSHes a history entry
//                     (so browser Back has somewhere to go); every other
//                     transition REPLACEs. We only navigate when the pathname
//                     actually differs from the screen's path.
//   • URL → screen  : browser Back/Forward (popstate) changes location.pathname
//                     out from under the store. We reconcile the store to match
//                     the new path. Backing OUT of an in-room screen to `/`
//                     leaves the room (ROOM_LEAVE + reset).
//   • refresh guard : landing on an in-room URL (/lobby, /game, /game-over)
//                     with no room state (e.g. a hard refresh — there is no
//                     reconnect-on-load) sends the user back to `/` (menu).
//
// Direction detection: we remember the pathname + screen from the previous
// effect run. If the PATHNAME changed we treat it as URL-driven (reconcile the
// store to the URL); otherwise a screen change is store-driven (sync the URL to
// the screen). This disambiguation is what makes `pathScreen !== screen`
// actionable in one direction only, so a store-driven `setScreen('lobby')`
// PUSHes `/lobby` instead of being mistaken for a Back-out.
//
// Loop-freedom: the effect body is idempotent. Every mutation (navigate /
// reset / setScreen) is gated by an equality check, so once screen and pathname
// agree the effect is a no-op. A `navigate`/`reset`/`setScreen` re-runs the
// effect, but the follow-up pass finds everything consistent and does nothing.

export const SCREEN_TO_PATH: Record<Screen, string> = {
  menu: '/',
  lobby: '/lobby',
  game: '/game',
  'game-over': '/game-over',
};

const PATH_TO_SCREEN: Record<string, Screen> = {
  '/': 'menu',
  '/lobby': 'lobby',
  '/game': 'game',
  '/game-over': 'game-over',
};

// Unknown paths (e.g. a stray deep-link) collapse to the menu.
function screenForPath(pathname: string): Screen {
  return PATH_TO_SCREEN[pathname] ?? 'menu';
}

const IN_ROOM_SCREENS: ReadonlySet<Screen> = new Set<Screen>(['lobby', 'game', 'game-over']);

export function useScreenRouting(): void {
  const screen = useGameStore((s) => s.screen);
  const state = useGameStore((s) => s.state);
  const roomCode = useGameStore((s) => s.roomCode);
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  // Previous values so we can tell which side (URL or store) initiated a change.
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    const store = useGameStore.getState();
    const targetPath = SCREEN_TO_PATH[screen];
    const pathScreen = screenForPath(pathname);
    const inRoom = state !== null || roomCode !== null;

    const pathChanged = pathname !== prevPathRef.current;
    prevPathRef.current = pathname;

    // (1) Refresh / deep-link guard — highest priority. An in-room URL with no
    // room state can never be honored (no reconnect-on-load), so bounce to menu.
    if (IN_ROOM_SCREENS.has(pathScreen) && !inRoom) {
      if (screen !== 'menu') store.setScreen('menu'); // re-runs effect
      if (pathname !== '/') navigate('/', { replace: true });
      return;
    }

    // Already consistent → nothing to do (this is the loop terminator).
    if (pathScreen === screen) return;

    // (2) URL → screen reconcile — the PATHNAME changed out from under the store
    // (browser Back/Forward). Bring the store in line with the URL.
    if (pathChanged) {
      // Backing out of an in-room screen to the menu leaves the room.
      if (pathScreen === 'menu' && IN_ROOM_SCREENS.has(screen)) {
        if (inRoom) socketManager.emit(EVENTS.ROOM_LEAVE);
        store.reset(); // sets screen 'menu' + clears state; effect re-runs, now consistent
        return;
      }
      // Any other URL→screen mismatch (e.g. Forward into a live /lobby): mirror
      // the URL into the store.
      store.setScreen(pathScreen);
      return;
    }

    // (3) screen → URL sync — the STORE changed (game flow); mirror to the URL.
    // menu → lobby is the ONE transition that PUSHes, creating the history
    // entry that browser Back needs. Everything else replaces so we never
    // strand a stale forward entry (dead room) or a re-enterable screen.
    const isEnterRoom = pathScreen === 'menu' && screen === 'lobby';
    navigate(targetPath, { replace: !isEnterRoom });
  }, [screen, pathname, state, roomCode, navigate]);
}
