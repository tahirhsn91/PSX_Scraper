import { boardFreshness, BOARD_MAX_AGE_MS } from '../src/services/indexScrape.service';
import { parseSarmaayaMarketView, SARMAYA_MARKET_VIEW_URL } from '../src/scrapers/psxIndices.scraper';

/**
 * The live index board: Sarmaaya's `market-view`, and the guard that refuses a reading which cannot
 * prove it is live.
 *
 * Two things are pinned here, because both fail silently in production if they regress:
 *
 *  1. On `market-view`, **`close` is the index level and `value` is not**. Both keys sit in the same
 *     row (KSE100: `close` 170425.6242 beside `value` 8909785874.15 — a rupee figure). Mapping the
 *     wrong one stores an eight-billion "level" for the index and every chart, change and percent
 *     derived from it. The sibling endpoint `/api/indices` carries the same number under `curr`.
 *  2. A reading with no read time, or one older than the session it is about, may not become a
 *     session's value. On 2026-09-28 the exchange's timestamp-less carousel served an 11:29 PKT
 *     reading at 15:17 PKT and it reached the dashboard as KSE-100's close.
 */

/**
 * A market-view row, in the shape the endpoint really answers with. The endpoint returns `response`
 * as the array itself; `/api/indices` — the board under its other key — nests the rows at
 * `response.data`, and both shapes are read.
 */
const marketViewRow = (over: Record<string, unknown> = {}) => ({
  symbol: 'KSE100',
  name: 'Karachi Stock Exchange KSE-100 Index',
  close: 170425.6242,
  change: -339.6,
  changePercentage: -0.2,
  value: 8909785874.15,
  volume: 139000299,
  updated_at: '2026-09-28T17:23:24.835Z',
  ...over,
});

const payload = (rows: unknown[]) => ({ success: true, message: 'Success', response: rows });
/** The sibling board's nesting, which the same parser accepts. */
const nested = (rows: unknown[]) => ({ success: true, response: { data: rows } });

describe('the market-view payload the /indexes page itself renders', () => {
  it('reads the level from `close`, never from `value`', () => {
    const [row] = parseSarmaayaMarketView(payload([marketViewRow()]));

    expect(row?.level).toBe(170425.6242);
    // The trap this test exists for: `value` is a rupee amount in the same row.
    expect(row?.level).not.toBe(8909785874.15);
  });

  it('carries the change figures as published and derives direction from the sign', () => {
    const [down] = parseSarmaayaMarketView(payload([marketViewRow()]));
    const [up] = parseSarmaayaMarketView(payload([marketViewRow({ symbol: 'OGTI', change: 3.02, changePercentage: 0.01 })]));

    expect(down?.change).toBe(-339.6);
    expect(down?.changePercent).toBe(-0.2);
    expect(down?.direction).toBe('down');
    expect(up?.direction).toBe('up');
  });

  it('takes the read time from `updated_at`, with or without a zone suffix', () => {
    const [zoned] = parseSarmaayaMarketView(payload([marketViewRow()]));
    const [naive] = parseSarmaayaMarketView(payload([marketViewRow({ updated_at: '2026-09-28T17:23:24' })]));
    const [missing] = parseSarmaayaMarketView(payload([marketViewRow({ updated_at: null })]));

    expect(zoned?.readAt?.toISOString()).toBe('2026-09-28T17:23:24.835Z');
    // A timestamp without a zone is read as UTC rather than as the host's local time — the same
    // mistake would put a Karachi reading five hours out and make it look stale (or fresh) wrongly.
    expect(naive?.readAt?.toISOString()).toBe('2026-09-28T17:23:24.000Z');
    // No timestamp is not a timestamp of "now": the guard needs to see the absence.
    expect(missing?.readAt).toBeNull();
  });

  it('skips a row with no readable close instead of storing a zero level', () => {
    const parsed = parseSarmaayaMarketView(
      payload([
        marketViewRow({ symbol: 'NOCLOSE', close: null }),
        marketViewRow({ symbol: 'BLANK', close: '' }),
        marketViewRow({ symbol: 'KMI30', close: 244101.8523 }),
      ]),
    );

    expect(parsed.map((r) => r.symbol)).toEqual(['KMI30']);
    expect(parsed[0]?.level).toBe(244101.8523);
  });

  it('takes a repeated symbol once, and answers nothing for a payload it cannot read', () => {
    expect(parseSarmaayaMarketView(payload([marketViewRow(), marketViewRow({ close: 1 })])).length).toBe(1);
    expect(parseSarmaayaMarketView({})).toEqual([]);
    expect(parseSarmaayaMarketView({ response: { data: 'nope' } })).toEqual([]);
    expect(parseSarmaayaMarketView(payload([{ symbol: '', close: 5 }]))).toEqual([]);
  });

  it('reads the sibling board shape too, so a nesting change upstream is not an empty board', () => {
    // `/api/indices` nests its rows one level deeper. Reading only one shape is how this leg would
    // have thrown, dropped the chain to the next source, and taken the read time with it.
    const viaNested = parseSarmaayaMarketView(nested([marketViewRow({ symbol: 'KMI30', close: 244101.8523 })]));

    expect(viaNested.map((r) => r.symbol)).toEqual(['KMI30']);
    expect(viaNested[0]?.level).toBe(244101.8523);
    expect(viaNested[0]?.readAt?.toISOString()).toBe('2026-09-28T17:23:24.835Z');
  });

  it('is the endpoint behind the page the user read the figures from', () => {
    expect(SARMAYA_MARKET_VIEW_URL).toBe('https://beta-restapi.sarmaaya.pk/api/dashboard/market-view');
  });
});

describe('a reading may only be a session value when it can prove it is live', () => {
  const now = new Date('2026-09-28T06:30:00Z'); // 11:30 PKT, mid-session

  it('accepts any age outside a session — an old reading is the close, which is the point', () => {
    expect(boardFreshness({ now, readAt: new Date('2026-09-28T05:00:00Z'), inSession: false })).toEqual({ ok: true });
    expect(boardFreshness({ now, readAt: null, inSession: false })).toEqual({ ok: true });
  });

  it('accepts a reading taken within the window while a session is running', () => {
    expect(boardFreshness({ now, readAt: new Date(now.getTime() - BOARD_MAX_AGE_MS + 1_000), inSession: true })).toEqual({
      ok: true,
    });
  });

  it('refuses a stale reading mid-session, naming how old it is', () => {
    const result = boardFreshness({ now, readAt: new Date(now.getTime() - 2 * BOARD_MAX_AGE_MS), inSession: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/30m old/);
  });

  it('refuses a reading that carries no read time during a session', () => {
    // This is how the exchange's carousel arrives (`readAt` null), and how the 11:29 freeze behaved.
    for (const readAt of [null, undefined]) {
      const result = boardFreshness({ now, readAt, inSession: true });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/no read time/);
    }
  });
});
