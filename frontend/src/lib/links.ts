/**
 * Where the portfolio manager lives, and how to link to it.
 *
 * Overridable per environment so a dev stack can point at a dev manager, but it defaults to the live
 * one on purpose: a link that only works once someone has filled in an `.env` entry is a link that
 * breaks on the next fresh clone. Read at build time by Vite, like `VITE_API_URL`.
 */
export const PORTFOLIO_URL = (import.meta.env.VITE_PORTFOLIO_URL as string) || 'https://manager.myportfolio365.com/';

/**
 * The anchor attributes for that link.
 *
 * `noopener` blocks the new tab from reaching back through `window.opener`; `noreferrer` also drops
 * the referrer, so the manager's analytics cannot read this app's URL — including a dev host.
 */
export const PORTFOLIO_LINK = {
  component: 'a' as const,
  href: PORTFOLIO_URL,
  target: '_blank',
  rel: 'noopener noreferrer',
};
