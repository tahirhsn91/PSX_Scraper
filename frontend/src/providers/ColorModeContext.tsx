import { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import { ThemeProvider, createTheme, CssBaseline, PaletteMode } from '@mui/material';

interface ColorModeCtx { mode: PaletteMode; toggle: () => void }
const ColorModeContext = createContext<ColorModeCtx>({ mode: 'light', toggle: () => {} });
export const useColorMode = () => useContext(ColorModeContext);

const stored = (): PaletteMode => {
  const s = localStorage.getItem('color-mode');
  if (s === 'light' || s === 'dark') return s;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PaletteMode>(stored);
  const toggle = () =>
    setMode((m) => {
      const next = m === 'light' ? 'dark' : 'light';
      localStorage.setItem('color-mode', next);
      return next;
    });
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: '#0b8457' },
          secondary: { main: '#1976d2' },
        },
      }),
    [mode],
  );
  return (
    <ColorModeContext.Provider value={{ mode, toggle }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
