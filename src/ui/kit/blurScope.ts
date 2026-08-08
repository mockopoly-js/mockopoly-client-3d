/**
 * RULE R5 ENFORCEMENT — no nested `backdrop-filter`.
 *
 * Stacking a blurred layer inside another blurred layer blanks the page in
 * Chrome's software compositor and is a known mobile-Safari performance cliff.
 * The system allows exactly one blurred surface per screen.
 *
 * Rather than trusting every caller to remember, the blurring primitives
 * (<Panel>, <Toast>) publish a scope on mount and read it on render: a blurring
 * primitive that finds itself already inside one silently downgrades to an
 * opaque fill (`kit-toast--flat` / `kit-panel--flat`). Visually near-identical,
 * and it cannot blank the compositor.
 *
 * The CSS guard selectors in kit.css §19 do the same job for markup that
 * bypasses the React primitives. Belt and braces, because this failure mode
 * presents as "the whole screen went black" with no console error.
 */
import { createContext, useContext } from 'react';

/** True when an ancestor is already applying a backdrop-filter. */
export const BlurScopeContext = createContext(false);

/** Returns true if this subtree is already inside a blurred surface. */
export function useBlurScope(): boolean {
  return useContext(BlurScopeContext);
}
