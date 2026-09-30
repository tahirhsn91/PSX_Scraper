/**
 * The live index board (#107): where a reading comes from, and whether it may be written.
 *
 * Two things are pinned here, both from the failure this issue is about. A board frozen at 11:29 PKT
 * served 170,300.62 as KSE-100's close at 15:17 PKT, and nothing could tell that apart from a quiet
 * market — so a reading is now taken from the source that stamps it, and a reading that cannot prove
 * it is live while a session is open is not written at all.
 */
import { fetchPsxIndices, parseSarmaayaMarketView } from '../src/scrapers/psxIndices.scraper';
import { READING_MAX_AGE_MS, readingIsWritable } from '../src/services/indexScrape.service';

/** A market-view row as the endpoint really answers (measured 2026-09-30). */
const row = (over: Record<string, unknown> = {}) => ({
  symbol: 'KSE100',
  name: 'KSE 100 Index',
  close: 169969.3266,
  // A rupee amount, not a level: the trap this endpoint sets for anyone reading the wrong key.
  value: 11230807201.72,
  change: 368.92,
  changePercentage: 0.22,
  volume: 217008080,
  updated_at: '2026-09-30T15:42:55.481Z',
  history: [],
  sort_order: 1,
  ...over,
});

/** `response` is the array itself on this endpoint. */
const payload = (rows: unknown[]) => ({ success: true, message: 'Success', response: rows });

describe('the live index board', () => {
  describe('parseSarmaayaMarketView', () => {
    it('reads the level from `close`, never from `value`', () => {
      const [kse] = parseSarmaayaMarketView(payload([row()]));
      expect(kse!.level).toBeCloseTo(169969.3266, 4);
      // The same row carries an eight-billion `value`; storing it as a level is the failure this pins.
      expect(kse!.level).toBeLessThan(200_000);
    });

    it('carries the source’s own timestamp, so a reading can prove it is live', () => {
      const [kse] = parseSarmaayaMarketView(payload([row()]));
      expect(kse!.readAt).toBeInstanceOf(Date);
      expect(kse!.readAt!.toISOString()).toBe('2026-09-30T15:42:55.481Z');
    });

    it('carries volume, and takes a symbol once when the payload repeats it', () => {
      const rows = parseSarmaayaMarketView(payload([row(), row({ volume: 1 })]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.volume).toBe(217008080);
    });

    it('skips a row with no level rather than storing a zero, and reads the sibling nesting too', () => {
      expect(parseSarmaayaMarketView(payload([row({ close: null }), row({ symbol: 'KMI30' })])).map((r) => r.symbol)).toEqual(['KMI30']);
      // `/api/indices` nests the rows a level deeper; both shapes are read.
      expect(parseSarmaayaMarketView({ response: { data: [row()] } })).toHaveLength(1);
    });

    it('answers nothing for a timestamp it cannot parse, and for a payload it cannot read', () => {
      expect(parseSarmaayaMarketView(payload([row({ updated_at: 'not-a-date' })]))[0]!.readAt).toBeNull();
      expect(parseSarmaayaMarketView({ response: { data: 'nope' } })).toEqual([]);
      expect(parseSarmaayaMarketView(null)).toEqual([]);
    });
  });

  describe('may a reading be written', () => {
    const now = new Date('2026-09-30T11:00:00.000Z');

    it('refuses, mid-session, a reading with no timestamp at all', () => {
      expect(readingIsWritable({ readAt: null, now, marketOpen: true })).toBe(false);
    });

    it('refuses, mid-session, a reading older than fifteen minutes', () => {
      const stale = new Date(now.getTime() - READING_MAX_AGE_MS - 1);
      expect(readingIsWritable({ readAt: stale, now, marketOpen: true })).toBe(false);
      const justInside = new Date(now.getTime() - READING_MAX_AGE_MS);
      expect(readingIsWritable({ readAt: justInside, now, marketOpen: true })).toBe(true);
    });

    it('accepts, mid-session, a reading the source stamped just now', () => {
      const fresh = new Date(now.getTime() - 60_000);
      expect(readingIsWritable({ readAt: fresh, now, marketOpen: true })).toBe(true);
    });

    it('never refuses outside a session — the close is the close, and a fallback may be its only record', () => {
      expect(readingIsWritable({ readAt: null, now, marketOpen: false })).toBe(true);
      const old = new Date(now.getTime() - 8 * 3600 * 1000);
      expect(readingIsWritable({ readAt: old, now, marketOpen: false })).toBe(true);
    });
  });

  describe('fetchPsxIndices', () => {
    afterEach(() => jest.restoreAllMocks());

    it('leads with the board that can prove when it read, and never touches the exchange’s page', async () => {
      const spy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => payload([row()]) } as unknown as Response);
      const rows = await fetchPsxIndices(1000);
      expect(rows.map((r) => r.symbol)).toEqual(['KSE100']);
      expect(rows[0]!.readAt).toBeInstanceOf(Date);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('falls to the next source when the live board cannot be read, and keeps what that source can say', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('market-view unreachable'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, response: { data: [{ symbol: 'KMI30', curr: 243608.5, volume: 5 }] } }),
        } as unknown as Response);
      const rows = await fetchPsxIndices(1000);
      expect(rows.map((r) => r.symbol)).toEqual(['KMI30']);
      expect(rows[0]!.volume).toBe(5);
      // This source publishes no timestamp, which is exactly what the in-session refusal is about.
      expect(rows[0]!.readAt).toBeNull();
    });

    it('surfaces the lead’s own error when every source fails, rather than the last one’s', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('market-view unreachable'))
        .mockRejectedValueOnce(new Error('indices unreachable'))
        .mockRejectedValueOnce(new Error('psx page unreachable'));
      await expect(fetchPsxIndices(1000)).rejects.toThrow(/market-view unreachable/);
    });
  });
});
