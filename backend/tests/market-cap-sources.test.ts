import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CAP_COLUMN_INDEX,
  dropSharedGapValues,
  MarketCapSnapshot,
  parseCompactAmount,
  parseStockanalysisMarketCap,
  parseTradingViewRows,
  SCANNER_COLUMNS,
} from '../src/scrapers/marketCap.scraper';

/**
 * The two market-cap parsers, pinned.
 *
 * Both read a page shape we do not control, so the tests that matter are the ones about *not*
 * inventing a number: a missing figure has to come back null (the dashboard renders a dash), never
 * as a zero or as whatever digits happened to be nearby.
 */
describe('parseCompactAmount', () => {
  it('scales the compact suffixes aggregators use', () => {
    expect(parseCompactAmount('1.39B')).toBe(1_390_000_000);
    expect(parseCompactAmount('12.4M')).toBe(12_400_000);
    expect(parseCompactAmount('1.2T')).toBe(1_200_000_000_000);
    expect(parseCompactAmount('745.2B')).toBe(745_200_000_000);
    expect(parseCompactAmount('48,131.13')).toBe(48_131.13);
  });

  it('returns null rather than a number it had to guess', () => {
    expect(parseCompactAmount(null)).toBeNull();
    expect(parseCompactAmount('')).toBeNull();
    expect(parseCompactAmount('—')).toBeNull();
    expect(parseCompactAmount('N/A')).toBeNull();
    expect(parseCompactAmount('0')).toBeNull();
    expect(parseCompactAmount('-5B')).toBeNull();
    expect(parseCompactAmount('1.39B +124.8%')).toBeNull();
  });
});

describe('parseStockanalysisMarketCap', () => {
  // Captured from https://stockanalysis.com/quote/psx/DFSM/ (2026-09-25): the label is an anchor
  // into the site's market-cap page and the value is the next cell, with a change badge after it.
  const dfsm = [
    '<td class="whitespace-nowrap">',
    '<a href="/quote/psx/DFSM/market-cap/" class="dothref text-default">Market Cap</a>',
    '</td>',
    '<td class="whitespace-nowrap text-left text-smaller font-semibold">1.39B <!---->',
    '<span class="rg">+124.8%</span><!----></td>',
  ].join('\n');

  it('reads the value cell and ignores the change badge next to it', () => {
    expect(parseStockanalysisMarketCap(dfsm)).toBe(1_390_000_000);
  });

  // Preference shares and rights pages carry the same figure under a label that is not a link —
  // captured from https://stockanalysis.com/quote/psx/SGPLR/ (2026-09-25).
  it('reads a label that is plain text between HTML comments, not an anchor', () => {
    const sgplr = [
      '<td class="whitespace-nowrap px-0.5 py-px xs:px-1 sm:py-2"><!--[-1-->Market Cap<!--]--></td>',
      '<td class="whitespace-nowrap text-left text-smaller font-semibold">497.15M <!---->',
      '<span class="rg">+175.2%</span><!----></td>',
    ].join('\n');
    expect(parseStockanalysisMarketCap(sgplr)).toBe(497_150_000);
  });

  it('does not grab a change badge as if it were the cap', () => {
    const html = '<a href="/quote/psx/FFC/market-cap/">Market Cap</a></td><td>+124.8%</td>';
    expect(parseStockanalysisMarketCap(html)).toBeNull();
  });

  it('ignores a page that merely mentions the words', () => {
    expect(parseStockanalysisMarketCap('<h2>Market Cap</h2><p>No data here</p>')).toBeNull();
  });

  it('rejects a figure too small to be a market cap', () => {
    const html = '<a href="/quote/psx/X/market-cap/">Market Cap</a></td><td>500</td>';
    expect(parseStockanalysisMarketCap(html)).toBeNull();
  });
});

describe('parseTradingViewRows', () => {
  const row = (ticker: string, cap: unknown) => ({ s: ticker, d: ['SYM', cap, 100] });

  it('reads the cap from its column and strips the exchange prefix', () => {
    const payload = {
      data: [
        row('PSX:OGDC', 1_360_082_733_511),
        row('PSX:FFC', 779_403_734_961),
        row('PSX:DFSM', null),
        row('PSX:X', 0),
        row('PSX:Y', -5),
        { s: 'PSX:Z' },
      ],
    };
    const rows = parseTradingViewRows(payload);
    expect(rows.map((r) => r.symbol)).toEqual(['OGDC', 'FFC']);
    expect(rows[0]).toEqual({ symbol: 'OGDC', marketCap: 1_360_082_733_511, source: 'tradingview' });
  });

  it('keeps one reading per symbol, and it is the largest', () => {
    const rows = parseTradingViewRows({ data: [row('PSX:FFC', 1e9), row('PSX:FFC', 8e11)] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.marketCap).toBe(8e11);
  });

  it('survives a payload that is not what we expect', () => {
    expect(parseTradingViewRows(null)).toEqual([]);
    expect(parseTradingViewRows({ error: 'rate limited' })).toEqual([]);
    expect(parseTradingViewRows({ data: 'nope' })).toEqual([]);
  });
});

describe('the scrapers keep their promises about sources', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const src = read('src/scrapers/marketCap.scraper.ts');

  it('asks the scanner for the market-cap column, at a position the parser agrees with', () => {
    expect(SCANNER_COLUMNS).toContain('market_cap_basic');
    expect(SCANNER_COLUMNS.indexOf('market_cap_basic')).toBe(CAP_COLUMN_INDEX);
    expect(src).toContain('scanner.tradingview.com/pakistan/scan');
  });

  it('spaces the per-symbol requests instead of firing them as a burst', () => {
    expect(src).toContain('GAP_FILL_DELAY_MS');
    expect(src).toMatch(/await new Promise\(\(resolve\) => setTimeout\(resolve, options\.delayMs/);
  });

  it('never turns a failure into a zero', () => {
    expect(src).toContain('missing: wanted.filter((s) => !found.has(s))');
    expect(src).toContain('return null;');
  });
});

describe('dropSharedGapValues', () => {
  const snap = (
    symbol: string,
    marketCap: number,
    source: MarketCapSnapshot['source'],
  ): MarketCapSnapshot => ({ symbol, marketCap, source });

  // The real case (#71): stockanalysis reports 1.61B for both Escorts Investment Bank and Habib
  // Insurance, and the scanner has a cap for neither — so without this rule the dashboard shows one
  // company's figure on another's row. A wrong number is worse than a dash.
  it('drops a gap-fill figure that another symbol also reported', () => {
    const { kept, discarded } = dropSharedGapValues(
      [],
      [snap('ESBL', 1_610_000_000, 'stockanalysis'), snap('HICL', 1_610_000_000, 'stockanalysis')],
    );
    expect(kept).toEqual([]);
    expect(discarded.map((s) => s.symbol)).toEqual(['ESBL', 'HICL']);
  });

  it('drops a gap-fill figure that collides with another symbol on the scanner', () => {
    const { kept, discarded } = dropSharedGapValues(
      [snap('FFC', 779_403_734_961, 'tradingview')],
      [snap('NOTFFC', 779_403_734_961, 'stockanalysis')],
    );
    expect(kept).toEqual([]);
    expect(discarded.map((s) => s.symbol)).toEqual(['NOTFFC']);
  });

  // A security and its convertible genuinely report one company cap (Mughal/MUGHALC), which is why
  // the rule judges the gap-fill only — the scanner corroborates those pairs with a share count.
  it('does not judge the scanner, where sibling lines share a figure legitimately', () => {
    const shared = 25_723_770_643;
    const { kept, discarded } = dropSharedGapValues(
      [snap('MUGHAL', shared, 'tradingview'), snap('MUGHALC', shared, 'tradingview')],
      [],
    );
    expect(kept).toEqual([]);
    expect(discarded).toEqual([]);
  });

  it('keeps a gap-fill figure nobody else reports', () => {
    const { kept, discarded } = dropSharedGapValues(
      [snap('FFC', 779_403_734_961, 'tradingview')],
      [snap('DFSM', 1_390_000_000, 'stockanalysis')],
    );
    expect(kept.map((s) => s.symbol)).toEqual(['DFSM']);
    expect(discarded).toEqual([]);
  });
});
