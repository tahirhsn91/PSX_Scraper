import { useCallback, useSyncExternalStore } from 'react';

/**
 * Saved screens — device-local, no account, no server call.
 *
 * A "screen" is stored as the screener's query string, because the screener's whole state already
 * lives there (filters, preset, period, sort, page). That keeps one model rather than two: applying
 * a saved screen means navigating to the query it holds, so it restores exactly what was saved and
 * the same string can be pasted to someone else as a shareable URL.
 *
 * Nothing leaves the browser — the criterion the PRD set for "if storage can be added safely" with
 * no accounts in the product.
 */
const KEY = 'screener:saved';

export interface SavedScreen {
  id: string;
  name: string;
  /** The screener query string, without the leading `?`. */
  query: string;
  savedAt: string;
}

/** True when localStorage can actually be written (private mode and some policies refuse). */
export function storageAvailable(): boolean {
  try {
    const probe = '__screener_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function isSavedScreen(v: unknown): v is SavedScreen {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.query === 'string';
}

function read(): SavedScreen[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // Stored data is user-editable and survives version changes: keep only well-formed entries
    // rather than letting one bad record break the list.
    return parsed.filter(isSavedScreen);
  } catch {
    return [];
  }
}

function write(screens: SavedScreen[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(screens));
    return true;
  } catch {
    return false;
  }
}

let cache = read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => cache;

// Two tabs open on the same device should agree: `storage` fires in the *other* tabs only, which is
// exactly the update each one is missing.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      cache = read();
      emit();
    }
  });
}

/** Trimmed, non-empty, and not a duplicate of a name already used. */
export function screenNameProblem(screens: SavedScreen[], name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the screen a name.';
  if (trimmed.length > 60) return 'Keep the name under 60 characters.';
  if (screens.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
    return 'A screen with that name already exists.';
  }
  return null;
}

export function useSavedScreens(): {
  screens: SavedScreen[];
  save: (name: string, query: string) => { ok: boolean; error?: string };
  remove: (id: string) => void;
  blocked: boolean;
} {
  const screens = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const blocked = !storageAvailable();

  // A save that could not be written must not look like it worked; the caller shows the message.
  const save = useCallback((name: string, query: string) => {
    const problem = screenNameProblem(cache, name);
    if (problem) return { ok: false, error: problem };
    const next: SavedScreen[] = [
      ...cache,
      {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: name.trim(),
        query,
        savedAt: new Date().toISOString(),
      },
    ];
    if (!write(next)) return { ok: false, error: 'This browser would not store the screen.' };
    cache = next;
    emit();
    return { ok: true };
  }, []);

  const remove = useCallback((id: string) => {
    const next = cache.filter((s) => s.id !== id);
    if (!write(next)) return;
    cache = next;
    emit();
  }, []);

  return { screens, save, remove, blocked };
}

/** The absolute URL for a screen — what "copy link" puts on the clipboard. */
export function screenUrl(query: string): string {
  const base = `${window.location.origin}/screener`;
  return query ? `${base}?${query}` : base;
}
