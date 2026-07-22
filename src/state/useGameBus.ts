import { useEffect, useRef } from 'react';
import { gameBus } from './gameBus';

/**
 * Subscribe a React component to a gameBus (eventemitter3) event for its
 * lifetime. The latest `handler` is always invoked without needing it to be
 * referentially stable, and the listener is removed on unmount.
 */
export function useGameBusEvent(name: string, handler: (payload: any) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (payload: any) => ref.current(payload);
    gameBus.on(name, listener);
    return () => { gameBus.off(name, listener); };
  }, [name]);
}
