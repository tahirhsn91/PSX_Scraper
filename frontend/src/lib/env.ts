/**
 * True only while running on the Vite dev server.
 *
 * Vite statically replaces `import.meta.env.DEV` at build time, so this constant is
 * `false` in every production bundle and any UI gated behind `{isDev && …}` is
 * dead-code-eliminated — it cannot ship to production. This mirrors the gate the
 * red `EnvBanner` strip already uses, so the two can never drift apart.
 */
export const isDev = import.meta.env.DEV;
