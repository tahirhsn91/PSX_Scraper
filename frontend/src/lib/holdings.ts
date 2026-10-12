import { useCallback, useSyncExternalStore } from 'react';
import { isHolding, type Holding } from './portfolio';

/**
 * Device-local holdings. No account, no backend: positions live in `localStorage`, so they survive
 * reloads but stay on this browser. That is a deliberate first cut, matching the watchlist — a
 * server-side portfolio needs auth and a schema, and this ships the feature without either.
 *
 * One difference from `watchlist.ts`: this store also listens for the `storage` event, so a second
 * tab on the same device picks the change up instead of holding a stale copy until it reloads.
 */
export const HOLDINGS_KEY = 'portfolio-holdings';

function read(): Holding[] {
  try {
    const raw = localStorage.getItem(HOLDINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // A row that does not parse is dropped rather than trusted: prices come off 508 live symbols and
    // one bad quantity would otherwise spread NaN through every total on the page. Symbols are
    // upper-cased on the way in, so a position is found however the page was opened.
    return parsed
      .filter(isHolding)
      .map((h) => ({ symbol: h.symbol.trim().toUpperCase(), quantity: h.quantity, avgBuyPrice: h.avgBuyPrice }));
  } catch {
    return [];
  }
}

function write(holdings: Holding[]) {
  try {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
  } catch {
    // Storage full or blocked — the positions just do not persist. Nothing to recover.
  }
}

/** Mirrors storage, so `getSnapshot` can hand React the same reference until something changes. */
let cache = read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(holdings: Holding[]) {
  cache = holdings;
  write(holdings);
  emit();
}

/** Subscribe on the browser only — no SSR here, but guard anyway. */
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Holding[] {
  return cache;
}

/**
 * Another tab wrote the key — or cleared storage, which arrives with `key === null`. Re-read from
 * `localStorage` rather than trusting the event payload, so this tab ends up with exactly what is
 * stored. Registered once for the module, not per subscriber.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== HOLDINGS_KEY) return;
    cache = read();
    emit();
  });
}

/** React hook over the local holdings. */
export function useHoldings(): {
  holdings: Holding[];
  get: (symbol: string) => Holding | undefined;
  /** Add, or overwrite the position for that symbol. */
  upsert: (holding: Holding) => void;
  remove: (symbol: string) => void;
  clear: () => void;
} {
  const holdings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const get = useCallback(
    (symbol: string) => holdings.find((h) => h.symbol === symbol.trim().toUpperCase()),
    [holdings],
  );
  const upsert = useCallback((holding: Holding) => {
    const symbol = holding.symbol.trim().toUpperCase();
    const next: Holding = { symbol, quantity: holding.quantity, avgBuyPrice: holding.avgBuyPrice };
    set(
      cache.some((h) => h.symbol === symbol)
        ? cache.map((h) => (h.symbol === symbol ? next : h))
        : [...cache, next],
    );
  }, []);
  const remove = useCallback((symbol: string) => {
    const wanted = symbol.trim().toUpperCase();
    set(cache.filter((h) => h.symbol !== wanted));
  }, []);
  const clear = useCallback(() => set([]), []);
  return { holdings, get, upsert, remove, clear };
}

/** Just one symbol's position — for the control on a stock's own page. */
export function useHolding(symbol: string): Holding | undefined {
  const holdings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const wanted = symbol.trim().toUpperCase();
  return holdings.find((h) => h.symbol === wanted);
}
