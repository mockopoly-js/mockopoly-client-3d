// Provides a proper in-memory localStorage for vitest running under Node.js 25+,
// which ships its own localStorage stub that is broken when --localstorage-file
// is not given a valid path. This setup replaces the global with a working Map.
const store = new Map<string, string>();

const localStorageMock: Storage = {
  get length() { return store.size; },
  key(index: number): string | null {
    return Array.from(store.keys())[index] ?? null;
  },
  getItem(key: string): string | null {
    return store.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    store.set(key, String(value));
  },
  removeItem(key: string): void {
    store.delete(key);
  },
  clear(): void {
    store.clear();
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import { afterEach } from 'vitest';
afterEach(() => { store.clear(); });
