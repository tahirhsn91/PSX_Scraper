import { SCREENER_PRESETS, presetSummaries, isPresetKey } from '../src/services/screenerPresets';
import type { StockListItem } from '../src/repositories/stock.repository';

const row = (over: Partial<StockListItem> = {}): StockListItem =>
  ({
    symbol: 'TEST',
    companyName: 'Test Ltd',
    sector: 'TEST',
    currentPrice: 100,
    changePercent: 2.5,
    volume: 12000,
    marketCap: 1e9,
    peRatio: 6.4,
    pbRatio: 1.1,
    dividendYield: 4.2,
    roe: 12,
    beta: 1,
    ...over,
  }) as StockListItem;

describe('screener presets', () => {
  it('exposes every preset to the UI without leaking the rule functions', () => {
    const items = presetSummaries();
    expect(items).toHaveLength(Object.keys(SCREENER_PRESETS).length);
    for (const item of items) {
      expect(typeof item.label).toBe('string');
      expect(item.description.length).toBeGreaterThan(10);
      expect('reason' in item).toBe(false);
    }
  });

  it('keeps loss-makers out of the P/E screens', () => {
    // The floor is 1, not 0: a P/E under 1 means earnings exceed market value, which in this feed
    // is a stale or mis-scaled figure rather than a bargain.
    expect(SCREENER_PRESETS.low_pe.filters.minPe).toBe(1);
    expect(SCREENER_PRESETS.high_pe.filters.minPe).toBe(10);
    expect(SCREENER_PRESETS.low_pe.caveat).toMatch(/positive earnings/i);
  });

  it('names the metric it ranked by in every reason', () => {
    const gain = SCREENER_PRESETS.gainers.reason(row(), 1, 112);
    expect(gain).toContain('+2.50%');
    expect(gain).toContain('#1 of 112');

    const pe = SCREENER_PRESETS.low_pe.reason(row(), 3, 156);
    expect(pe).toContain('P/E 6.4');
    expect(pe).toContain('#3 of 156');

    const vol = SCREENER_PRESETS.most_active.reason(row(), 2, 50);
    expect(vol).toContain('12,000 shares');
  });

  it('does not claim a percentage when the row has no change', () => {
    const text = SCREENER_PRESETS.losers.reason(row({ changePercent: null }), 1, 5);
    expect(text).not.toContain('%');
    expect(text).toContain('#1 of 5');
  });

  it('recognises only real preset keys', () => {
    expect(isPresetKey('gainers')).toBe(true);
    expect(isPresetKey('best_stocks')).toBe(false);
  });
});
