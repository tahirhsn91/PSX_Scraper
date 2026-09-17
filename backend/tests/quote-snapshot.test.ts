/**
 * `buildQuoteSnapshot` is the whole of the quote poll's arithmetic: the DPS series is
 * newest-first `[epochSeconds, close, volume, open]`, and the second row is the previous
 * session's close — everything change / change% needs.
 *
 * `../src/config` is mocked because `src/config/env.ts` calls `process.exit(1)` when
 * DATABASE_URL/REDIS_URL are absent.
 */
jest.mock('../src/config', () => ({ env: { QUOTE_POLL_CONCURRENCY: 5, QUOTE_POLL_TIMEOUT_MS: 10000 } }));

import { buildQuoteSnapshot } from '../src/scrapers/psxQuotes.scraper';

/** What the endpoint really returned for FFC on 2026-09-15 (real numbers, real stamps). */
const TODAY = 1789470000; // 2026-09-15T11:00:00Z = 16:00 PKT — the session stamp
const PREV = 1789383600; // 2026-09-14T11:00:00Z

describe('buildQuoteSnapshot', () => {
  it('derives price, change and change% from the two newest rows', () => {
    const snap = buildQuoteSnapshot('FFC', [
      [TODAY, 540.41, 582743, 537],
      [PREV, 535.11, 684779, 538.95],
    ]);

    expect(snap).not.toBeNull();
    expect(snap!.price).toBe(540.41);
    expect(snap!.previousClose).toBe(535.11);
    // 540.41 - 535.11 = 5.2999999999999545 before rounding — the column stores 4dp.
    expect(snap!.change).toBe(5.3);
    // Derived from the two closes: 0.9905%. The company page displays 0.99 because PSX
    // rounds its own percentage to 2dp; the derivation is the more precise of the two.
    expect(snap!.changePercent).toBe(0.9905);
    expect(snap!.open).toBe(537);
    expect(snap!.volume).toBe(582743);
  });

  it('stamps the session date from the series, not the clock', () => {
    const snap = buildQuoteSnapshot('FFC', [[TODAY, 540.41, 582743, 537]]);
    expect(snap!.sessionDate.toISOString()).toBe('2026-09-15T11:00:00.000Z');
  });

  it('reports change as null rather than inventing one when there is no previous session', () => {
    const snap = buildQuoteSnapshot('NEWCO', [[TODAY, 100, 10, 99]]);
    expect(snap!.previousClose).toBeNull();
    expect(snap!.change).toBeNull();
    expect(snap!.changePercent).toBeNull();
    expect(snap!.price).toBe(100);
  });

  it('ignores a zero previous close instead of dividing by it', () => {
    const snap = buildQuoteSnapshot('X', [
      [TODAY, 100, null, null],
      [PREV, 0, null, null],
    ]);
    expect(snap!.changePercent).toBeNull();
  });

  it('sorts the rows itself instead of trusting their order', () => {
    const snap = buildQuoteSnapshot('FFC', [
      [PREV, 535.11, 684779, 538.95],
      [TODAY, 540.41, 582743, 537],
    ]);
    expect(snap!.sessionDate.toISOString()).toBe('2026-09-15T11:00:00.000Z');
    expect(snap!.price).toBe(540.41);
  });

  it('drops malformed rows and returns null when nothing usable is left', () => {
    expect(buildQuoteSnapshot('X', [['nope'], [TODAY], [null, null]])).toBeNull();
    expect(buildQuoteSnapshot('X', [])).toBeNull();
  });

  it('treats a non-positive price as no reading', () => {
    expect(buildQuoteSnapshot('X', [[TODAY, 0, 5, 5]])).toBeNull();
  });

  it('tolerates missing open/volume without fabricating them', () => {
    const snap = buildQuoteSnapshot('X', [[TODAY, 100, null, null]]);
    expect(snap!.open).toBeNull();
    expect(snap!.volume).toBeNull();
  });
});
