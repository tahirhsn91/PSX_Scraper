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
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the vendor libraries out of the entry chunk.
         *
         * The entry was 536 KB, and it changed whenever any page did — so a one-line copy fix
         * invalidated the React/MUI bundle in every visitor's cache. One `vendor` group changes on
         * a dependency bump, not on a page edit; pages are already route-split in `App.tsx`.
         *
         * Deliberately one group, not react/mui/data: splitting those apart produced
         * "Cannot access 'te' before initialization" at runtime, because MUI and React reach back
         * into each other's modules and the split broke their initialisation order. If this is ever
         * refined, load the built `dist` in a browser before merging — `vite build` passes either
         * way.
         */
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    hmr: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
  },
});
