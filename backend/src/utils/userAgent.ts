/**
 * The `User-Agent` our plain-HTTP scrapers send.
 *
 * Node's `fetch` sends none at all, which is a classic bot signal and was raised as one reason
 * PSX's edge started refusing our data paths (#27). The browser-based scrapers cannot use this
 * — a real page needs a browser-shaped agent to render — but the JSON endpoints want an honest
 * one, and an operator who wants to reach us can.
 */
export const SCRAPER_USER_AGENT =
  'PSX-Scraper/1.0 (+https://github.com/tahirhsn91/PSX_Scraper)';
