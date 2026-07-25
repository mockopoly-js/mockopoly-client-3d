import { useEffect, useRef } from 'react';
import { gameBus } from './gameBus';

/**
 * Subscribe a React component to a gameBus (eventemitter3) event for its
 * lifetime. The latest `handler` is always invoked without needing it to be
 * referentially stable, and the listener is removed on unmount.
 *
 * `T` is an inference-directed payload type: callers annotate the payload their
 * handler expects and `T` is inferred from it, keeping handler bodies type-safe
 * without `any`. The gameBus itself (eventemitter3) is untyped, so the emitted
 * value is treated as `T` at the subscription boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- inference-directed payload type; the untyped gameBus payload is surfaced as T to the caller's handler
export function useGameBusEvent<T = unknown>(name: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (payload: T) => { ref.current(payload); };
    gameBus.on(name, listener);
    return () => { gameBus.off(name, listener); };
  }, [name]);
}
