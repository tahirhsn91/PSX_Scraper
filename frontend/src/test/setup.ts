import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no layout engine, and MUI asks `matchMedia` for the breakpoint on first render. Without
 * this every component test throws before it asserts anything.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

/** jsdom lacks these; MUI's responsive helpers call them. */
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
