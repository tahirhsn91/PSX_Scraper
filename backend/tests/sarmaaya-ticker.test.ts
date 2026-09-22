import { parseTicker } from '../src/scrapers/sarmaayaTicker.scraper';
import type { QuoteSnapshot } from '../src/scrapers/psxQuotes.scraper';

/**
 * The ticker payload is the poll's fallback source (#56), so its parsing rules are pinned here:
 * a row is either a whole quote or it is dropped. Nothing is coerced — the two failure modes
 * that matter are inventing a price from a blank field and turning a missing reading into `0`.
 */
const payload = (response: unknown): unknown => ({ response });

/** The parse result's first row — fails the test loudly if nothing parsed. */
const first = (body: unknown, symbols?: string[]): QuoteSnapshot => {
  const [snapshot] = parseTicker(body, symbols);
  if (!snapshot) throw new Error('expected at least one snapshot');
  return snapshot;
};

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  symbol: 'ABL',
  price: 170.05,
  change: -0.43,
  changePercentage: -0.25,
  volume: 331_758,
  date: '2026-09-22T00:00:00.000Z',
  ...over,
});

describe('parseTicker', () => {
  it('maps a row to a quote stamped on the session, not on the fetch time', () => {
    const snapshot = first(payload([row()]));

    expect(snapshot).toMatchObject({
      symbol: 'ABL',
      price: 170.05,
      change: -0.43,
      changePercent: -0.25,
      volume: 331_758,
      open: null,
    });
    // The payload dates the trading day at midnight UTC; the row key everywhere else in the
    // repo is 16:00 PKT, so a ticker row must land on that same session row.
    expect(snapshot.sessionDate.toISOString()).toBe('2026-09-22T11:00:00.000Z');
  });

  it('keeps a real zero — a flat close and a zero-volume session are readings', () => {
    const flat = first(payload([row({ change: 0, changePercentage: 0, volume: 0 })]));

    expect(flat.change).toBe(0);
    expect(flat.changePercent).toBe(0);
    expect(flat.volume).toBe(0);
  });

  it('reads numbers that arrive as strings, and blanks as nothing', () => {
    const quoted = first(payload([row({ price: '1,234.50', volume: '' })]));

    expect(quoted.price).toBe(1234.5);
    expect(quoted.volume).toBeNull();
  });

  it('drops rows that cannot be a quote instead of guessing', () => {
    const snapshots = parseTicker(
      payload([
        row({ symbol: 'NOPRICE', price: null }),
        row({ symbol: 'ZEROPRICE', price: 0 }),
        row({ symbol: 'NODATE', date: null }),
        row({ symbol: '  ' }),
        row({ symbol: 'OK' }),
        'not-a-row',
      ]),
    );

    expect(snapshots.map((s) => s.symbol)).toEqual(['OK']);
  });

  it('filters to the tracked symbols when a set is given', () => {
    const snapshots = parseTicker(payload([row({ symbol: 'ABL' }), row({ symbol: 'OGDC' })]), [
      'ogdc',
    ]);

    expect(snapshots.map((s) => s.symbol)).toEqual(['OGDC']);
  });

  it('refuses a payload that is not the ticker shape', () => {
    expect(() => parseTicker({})).toThrow(/sarmaaya-ticker/);
  });
});
