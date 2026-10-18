import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Unit/component tests: jsdom, no network, no live scraping.
 *
 * Anything that needs a real stack belongs in `e2e/` and runs under Playwright against the compose
 * stack — a unit test that depends on a running API fails for reasons nobody can reproduce.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    restoreMocks: true,
  },
});
