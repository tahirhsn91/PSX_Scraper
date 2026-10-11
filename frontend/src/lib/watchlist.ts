import { useCallback, useSyncExternalStore } from 'react';

/**
 * A device-local watchlist. No account, no backend: the list lives in `localStorage`, so it
 * survives reloads but stays on this browser. That is a deliberate first cut — accounts and a
 * server-side watchlist are a follow-up; this ships the feature without waiting for auth.
 */
const KEY = 'watchlist';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function write(symbols: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(symbols));
  } catch {
    // Storage full or blocked — the watchlist just does not persist. Nothing to recover.
  }
}

let cache = read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(symbols: string[]) {
  cache = symbols;
  write(symbols);
  emit();
}

/** Subscribe on the browser only — no SSR here, but guard anyway. */
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string[] {
  return cache;
}

/** React hook over the local watchlist. `toggle` adds or removes a symbol and returns the new state. */
export function useWatchlist(): {
  symbols: string[];
  has: (symbol: string) => boolean;
  toggle: (symbol: string) => boolean;
  clear: () => void;
} {
  const symbols = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const has = useCallback((symbol: string) => symbols.includes(symbol.toUpperCase()), [symbols]);
  const toggle = useCallback((symbol: string) => {
    const sym = symbol.toUpperCase();
    const next = cache.includes(sym) ? cache.filter((s) => s !== sym) : [...cache, sym];
    set(next);
    return next.includes(sym);
  }, []);
  const clear = useCallback(() => set([]), []);
  return { symbols, has, toggle, clear };
}
