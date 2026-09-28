import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { ThemeProvider, CssBaseline, PaletteMode } from '@mui/material';
import { createAppTheme, tokensFor } from '../theme';

/** What the user chose. `system` follows the OS and is the default on a first visit. */
export type ThemePreference = 'light' | 'dark' | 'system';

interface ColorModeCtx {
  /** The resolved mode actually in use. */
  mode: PaletteMode;
  /** What the user picked (may be `system`). */
  preference: ThemePreference;
  toggle: () => void;
  setPreference: (next: ThemePreference) => void;
}

const STORAGE_KEY = 'color-mode';

const ColorModeContext = createContext<ColorModeCtx>({
  mode: 'light',
  preference: 'system',
  toggle: () => {},
  setPreference: () => {},
});

export const useColorMode = () => useContext(ColorModeContext);

const systemMode = (): PaletteMode =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const readPreference = (): ThemePreference => {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'light' || s === 'dark' || s === 'system') return s;
  } catch {
    /* private mode / storage disabled: fall through to system */
  }
  return 'system';
};

const resolveMode = (preference: ThemePreference, sys: PaletteMode): PaletteMode =>
  preference === 'system' ? sys : preference;

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<PaletteMode>(systemMode);
  const mode = resolveMode(preference, system);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
  }, []);

  const toggle = useCallback(
    () => setPreference(resolveMode(preference, system) === 'dark' ? 'light' : 'dark'),
    [preference, system, setPreference],
  );

  // Follow the OS while the preference is `system`. The previous provider only read
  // `prefers-color-scheme` once, so an OS switch mid-session was silently ignored.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Keep the document in step so native UI (scrollbars, form controls, browser chrome) matches the
  // app theme, and so the pre-paint script in index.html and this provider never disagree.
  useEffect(() => {
    const t = tokensFor(mode);
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    root.style.backgroundColor = t.bg;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = t.bg;
  }, [mode]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ColorModeContext.Provider value={{ mode, preference, toggle, setPreference }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
