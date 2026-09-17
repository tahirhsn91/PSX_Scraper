import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server listens on 5173 *inside its container*, but that port is often
// published on a different host port — e.g. FRONTEND_PORT=5200 so a dev stack can
// run next to the production stack. The browser loads the page from the host port,
// so Vite's HMR websocket has to dial the same one; left at the default it dials
// 5173 and hot reload silently never connects (the page reloads only by hand).
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT) || undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    hmr: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
  },
});
