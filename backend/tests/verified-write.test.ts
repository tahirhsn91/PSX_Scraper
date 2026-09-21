import { applyVerdicts, toScrapedQuote } from '../src/services/verifiedWrite.service';
import type { VerificationResult } from '../src/services/quoteVerification.service';
import type { ScrapeResult } from '../src/types/dto';

const scrapeResult = (over: Partial<ScrapeResult['price']> = {}): ScrapeResult => ({
  symbol: 'SHSML',
  companyName: 'Shams Textile Mills Limited',
  sector: 'TEXTILE',
  price: {
    currentPrice: 354.76,
    change: -5.2,
    changePercent: -1.44,
    volume: 1234,
    high: 360,
    low: 350,
    open: 356,
    close: 354.76,
    marketCap: null,
    week52High: 541.2,
    week52Low: 367,
    lastTradeDate: '2026-09-17T11:00:00.000Z',
    ...over,
  },
  dividends: [],
  financials: [],
  ratios: null,
});

const verification = (verdicts: VerificationResult['verdicts']): VerificationResult => ({
  listed: true,
  verdicts,
});

describe('toScrapedQuote', () => {
  it('maps the price block, taking the session from lastTradeDate', () => {
    expect(toScrapedQuote('SHSML', scrapeResult())).toEqual({
      symbol: 'SHSML',
      price: 354.76,
      change: -5.2,
      changePercent: -1.44,
      volume: 1234,
      week52Low: 367,
      week52High: 541.2,
      sessionDate: '2026-09-17T11:00:00.000Z',
    });
  });

  it('reports nulls for a missing price block rather than inventing values', () => {
    const empty: ScrapeResult = { ...scrapeResult(), price: null };
    expect(toScrapedQuote('SHSML', empty)).toEqual({
      symbol: 'SHSML',
      price: null,
      change: null,
      changePercent: null,
      volume: null,
      week52Low: null,
      week52High: null,
      sessionDate: null,
    });
  });
});

describe('applyVerdicts', () => {
  it('blanks rejected fields and leaves accepted ones untouched', () => {
    // The SHSML shape: the price sits below its own 52-week low, so the range is rejected.
    const result = scrapeResult();
    applyVerdicts(
      result,
      verification([
        { field: 'price', status: 'ok', value: 354.76 },
        { field: 'change', status: 'ok', value: -5.2 },
        { field: 'changePercent', status: 'ok', value: -1.44 },
        { field: 'volume', status: 'ok', value: 1234 },
        { field: 'week52Low', status: 'rejected', value: null, rawValue: 367, reason: 'price outside 52W range' },
        { field: 'week52High', status: 'rejected', value: null, rawValue: 541.2, reason: 'price outside 52W range' },
      ]),
    );

    expect(result.price!.week52Low).toBeNull();
    expect(result.price!.week52High).toBeNull();
    expect(result.price!.currentPrice).toBe(354.76);
    expect(result.price!.volume).toBe(1234);
    expect(result.price!.changePercent).toBe(-1.44);
  });

  it('blanks an absent field as well, so a missing reading is never confused with a stored one', () => {
    const result = scrapeResult();
    applyVerdicts(
      result,
      verification([
        { field: 'volume', status: 'absent', value: null, rawValue: null, reason: 'volume not usable (null)' },
      ]),
    );
    expect(result.price!.volume).toBeNull();
  });

  it('is a no-op when there is no price block', () => {
    const result: ScrapeResult = { ...scrapeResult(), price: null };
    expect(() => applyVerdicts(result, verification([]))).not.toThrow();
  });
});
