/**
 * The quote poll must identify itself, and must stop asking a source that is refusing us (#27).
 *
 * Both halves are acceptance criteria of that issue, and both are the kind of thing that regresses
 * silently: the request is a plain `fetch` whose headers nothing else asserts, and the back-off
 * lives in a shared breaker that a refactor could quietly stop consulting. These tests drive the
 * real scraper with a stubbed `fetch`, so they fail if either behaviour stops happening.
 *
 * The breaker is a module singleton shared with every other suite in the run, so it is reset after
 * each test — otherwise a cooled-down `psx-quotes` would be inherited by whatever runs next.
 */
import { psxQuoteScraper } from '../src/scrapers/psxQuotes.scraper';
import { sourceBreaker } from '../src/utils/sourceBreaker';
import { SCRAPER_USER_AGENT } from '../src/utils/userAgent';

const SOURCE = psxQuoteScraper.source;
const originalFetch = global.fetch;

/** One valid DPS series row: [epochSeconds, close, volume, open]. */
const SERIES = JSON.stringify({ status: 'ok', data: [[1790000000, 100, 5000, 99]] });

afterEach(() => {
  global.fetch = originalFetch;
  sourceBreaker.reset();
});

it('sends an honest User-Agent on poll requests', async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  global.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return { ok: true, status: 200, text: async () => SERIES };
  }) as unknown as typeof global.fetch;

  const snapshot = await psxQuoteScraper.fetchSnapshot('FFC');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.headers['user-agent']).toBe(SCRAPER_USER_AGENT);
  // Identifiable, and it says who we are rather than impersonating a browser.
  expect(calls[0]?.headers['user-agent']).toMatch(/^PSX-Scraper\/1\.0 \(\+https?:\/\//);
  expect(calls[0]?.headers.accept).toBe('application/json');
  expect(calls[0]?.url).toContain('/timeseries/eod/FFC');
  expect(snapshot?.price).toBe(100);
});

it('stops asking a source that refuses us, and says why when it does', async () => {
  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    // What the source's refusal looks like to undici: the connection closes with no response.
    throw new Error('fetch failed');
  }) as unknown as typeof global.fetch;

  // Five consecutive availability failures is the default threshold.
  for (let i = 0; i < 5; i += 1) {
    await expect(psxQuoteScraper.fetchSnapshot('FFC')).rejects.toThrow(/site unavailable/i);
  }
  expect(attempts).toBe(5);

  const [state] = sourceBreaker.state();
  expect(state).toMatchObject({ source: SOURCE, failures: 5, coolingDown: true, opens: 1 });
  expect(state?.resumeAt).not.toBeNull();
  expect(new Date(state?.resumeAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  expect(state?.lastError).toMatch(/site unavailable/i);

  // The next tick is refused before a request leaves the process: the count does not move.
  await expect(psxQuoteScraper.fetchSnapshot('FFC')).rejects.toThrow(/cooling down/i);
  expect(attempts).toBe(5);
});
