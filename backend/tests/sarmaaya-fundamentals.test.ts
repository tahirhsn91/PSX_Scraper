import {
  asNumber,
  mergeRatioSeries,
  parseSarmaayaDetails,
  parseSarmaayaDividends,
  parseSarmaayaRatioSeries,
  seriesLatest,
  sarmaayaDetailsUrl,
  sarmaayaDividendsUrl,
  sarmaayaRatioSeriesUrl,
  SarmaayaFundamentalsScraper,
  SARMAYA_FUNDAMENTALS_SOURCE,
} from '../src/scrapers/sarmaayaFundamentals.scraper';
import { mergeDividends, mergeRatios } from '../src/scrapers/orchestrator';
import { scrapeResultSchema } from '../src/scrapers/result.schema';
import { RatioDTO, DividendDTO } from '../src/types/dto';

/**
 * Fixtures below are verbatim excerpts of the live payloads, captured 2026-09-27 from
 * `beta-restapi.sarmaaya.pk` for EFERT (P/E 12.48, P/B 5.95, dividend yield 6.16, book value per
 * share TTM 32.842, newest dividend announced 2026-08-10 at 1.75/share). Values are trimmed to the
 * rows the parser reads so the test states the contract rather than the whole response.
 */

/** POST /api/stocks/details/EFERT — the metric table. */
const DETAILS_EFERT = {
  success: true,
  message: 'Success',
  response: [
    { isin: 'PK0099701010', metricName: 'Price open', metricMetric: 'FF_PRICE_OPEN', afValue: '194.00' },
    { isin: 'PK0099701010', metricName: 'Price close', metricMetric: 'FF_PRICE_CLOSE', afValue: '195.27' },
    { isin: 'PK0099701010', metricName: '52 week high price', metricMetric: 'FF_PRICE_HIGH_52WK', afValue: '263.30' },
    { isin: 'PK0099701010', metricName: 'Market cap', metricMetric: 'FF_MKT_CAP', afValue: '260743908956.25' },
    { isin: 'PK0099701010', metricName: 'Shares outstanding', metricMetric: 'FF_COM_SHS_OUT', afValue: '1335299375.00' },
    { isin: 'PK0099701010', metricName: 'Dividend Yield (%)', metricMetric: 'FF_DIV_YLD', afValue: '6.16' },
    { isin: 'PK0099701010', metricName: 'Earnings Per Share', metricMetric: 'FF_EPS', afValue: '15.94' },
    { isin: 'PK0099701010', metricName: 'Net Income Margin (%)', metricMetric: 'FF_NET_MGN', afValue: '9.36' },
    { isin: 'PK0099701010', metricName: 'Price to Book Value', metricMetric: 'FF_PBK', afValue: '5.95' },
    { isin: 'PK0099701010', metricName: 'Price to Earnings', metricMetric: 'FF_PE', afValue: '12.48' },
    { isin: 'PK0099701010', metricName: 'PEG Ratio', metricMetric: 'FF_PEG', afValue: '-1.62' },
  ],
};

/** GET /api/stocks/fundamentals/ratios?isin=PK0099701010&periodicity=LTM (series trimmed). */
const RATIOS_LTM_EFERT = {
  success: true,
  response: {
    'Book Value Per Share': {
      metric: 'FF_BPS',
      displayType: 'wholeNumber',
      data: [
        { value: 32.842, date: '2026-06-30T00:00:00.000Z', year: 2026, periodicity: 'QTR', fiscalPeriod: 2 },
        { value: 31.996, date: '2026-03-31T00:00:00.000Z', year: 2026, periodicity: 'QTR', fiscalPeriod: 1 },
        { value: 33.511, date: '2025-12-31T00:00:00.000Z', year: 2025, periodicity: 'QTR', fiscalPeriod: 4 },
      ],
    },
    // Quoted, not numeric: the source mixes both, and older rows carry a repeated value that must
    // never win — only the newest entry is read.
    'Return on Common Equity (%)': {
      metric: 'FF_ROE',
      data: [
        { value: 49.444, date: '2025-06-30T00:00:00.000Z', year: 2025, periodicity: 'LTM', fiscalPeriod: 2 },
        { value: 0.534, date: '2025-03-31T00:00:00.000Z', year: 2025, periodicity: 'LTM', fiscalPeriod: 1 },
      ],
    },
    'Return on Average Assets (%)': {
      metric: 'FF_ROA',
      data: [{ value: '10.717', date: '2025-06-30T00:00:00.000Z', year: 2025, periodicity: 'LTM', fiscalPeriod: 2 }],
    },
  },
};

/** GET /api/stocks/fundamentals/ratios?...&periodicity=ANN — the annual fallback. */
const RATIOS_ANN_EFERT = {
  success: true,
  response: {
    'Book Value Per Share': {
      metric: 'FF_BPS',
      data: [
        { value: 33.511, date: '2025-12-31T00:00:00.000Z', year: 2025, periodicity: 'ANN', fiscalPeriod: 0 },
        { value: '6.897', date: '2024-12-31T00:00:00.000Z', year: 2024, periodicity: 'ANN', fiscalPeriod: 0 },
      ],
    },
    'Return on Common Equity (%)': {
      data: [{ value: 49.082, date: '2025-12-31T00:00:00.000Z', year: 2025, periodicity: 'ANN', fiscalPeriod: 0 }],
    },
  },
};

/** GET /api/stocks/dividends/EFERT — payout history, including the placeholder rows. */
const DIVIDENDS_EFERT = {
  success: true,
  response: {
    data: [],
    dividendsYield: [{ '2026': '6.16%' }],
    payoutHistory: [
      { symbol: 'EFERT', year: '2026', announcementDate: '2026-08-10', payoutType: 'dividend', faceValue: 10, dividendPerShare: 1.75, percentage: 17.5 },
      { symbol: 'EFERT', year: '2026', announcementDate: '2026-05-04', payoutType: 'dividend', faceValue: 10, dividendPerShare: 2, percentage: 20 },
      { symbol: 'EFERT', year: '2025', announcementDate: '2025-10-24', payoutType: 'dividend', faceValue: 10, dividendPerShare: 4.5, percentage: 45 },
      // The source's unfilled placeholders: not a payout of anything, and not a date.
      { symbol: 'EFERT', year: '2024', announcementDate: '0000-00-00', payoutType: 'type', faceValue: 0, dividendPerShare: 0, percentage: 0 },
      { symbol: 'EFERT', year: '2023', announcementDate: '0000-00-00', payoutType: 'type', faceValue: 0, dividendPerShare: 0, percentage: 0 },
    ],
  },
};

describe('asNumber', () => {
  it('reads the source quoted values', () => {
    expect(asNumber('12.48')).toBeCloseTo(12.48, 4);
    expect(asNumber('6.897')).toBeCloseTo(6.897, 4);
    expect(asNumber('1,335,299,375.00')).toBeCloseTo(1335299375, 0);
    expect(asNumber(32.842)).toBeCloseTo(32.842, 3);
  });

  it('keeps a real zero and rejects absence, which Number() would flatten to zero', () => {
    // The trap: Number(null) and Number('') are both 0, so an absent metric would be stored as a
    // fabricated zero in a column that promises a dash for "unknown".
    expect(asNumber('0')).toBe(0);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(null)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber('')).toBeNull();
    expect(asNumber('   ')).toBeNull();
    expect(asNumber('n/a')).toBeNull();
    expect(asNumber({})).toBeNull();
    expect(asNumber(true)).toBeNull();
  });
});

describe('parseSarmaayaDetails', () => {
  it('reads the valuation metrics by their own metric code', () => {
    const d = parseSarmaayaDetails(DETAILS_EFERT);
    expect(d.isin).toBe('PK0099701010');
    expect(d.peRatio).toBeCloseTo(12.48, 4);
    expect(d.pbRatio).toBeCloseTo(5.95, 4);
    expect(d.dividendYield).toBeCloseTo(6.16, 4);
    expect(d.eps).toBeCloseTo(15.94, 4);
  });

  it('answers null for a metric the payload does not carry, never zero', () => {
    const d = parseSarmaayaDetails({
      response: [{ isin: 'PK0000000000', metricName: 'Price close', metricMetric: 'FF_PRICE_CLOSE', afValue: '10' }],
    });
    expect(d.peRatio).toBeNull();
    expect(d.pbRatio).toBeNull();
    expect(d.dividendYield).toBeNull();
    // Nothing recognisable at all: the payload is not a metric table.
    expect(parseSarmaayaDetails({ success: false }).peRatio).toBeNull();
    expect(parseSarmaayaDetails(null).isin).toBeNull();
  });

  it('takes the newest fiscal period when a code is listed more than once', () => {
    const d = parseSarmaayaDetails({
      response: [
        { isin: 'PK0099701010', metricMetric: 'FF_PE', afValue: '9.99', afFiscalYear: 2024 },
        { isin: 'PK0099701010', metricMetric: 'FF_PE', afValue: '12.48', afFiscalYear: 2026 },
      ],
    });
    expect(d.peRatio).toBeCloseTo(12.48, 4);
  });
});

describe('parseSarmaayaRatioSeries', () => {
  it('takes the newest published period of book value, ROE and ROA', () => {
    const s = parseSarmaayaRatioSeries(RATIOS_LTM_EFERT, 'LTM');
    expect(s.bookValue).toBeCloseTo(32.842, 3);
    expect(s.bookValueAsOf).toBe('2026-06-30');
    expect(s.roe).toBeCloseTo(49.444, 3);
    // Quoted in the source; parsed as a number here.
    expect(s.roa).toBeCloseTo(10.717, 3);
    expect(s.periodicity).toBe('LTM');
  });

  it('answers null when the source publishes no book value for the symbol', () => {
    const s = parseSarmaayaRatioSeries({ response: { 'Return on Common Equity (%)': { data: [] } } }, 'LTM');
    expect(s.bookValue).toBeNull();
    expect(s.bookValueAsOf).toBeNull();
    expect(s.roe).toBeNull();
    expect(seriesLatest({}, 'Book Value Per Share').value).toBeNull();
  });

  it('falls back to the annual series field by field when TTM published nothing', () => {
    const ttm = parseSarmaayaRatioSeries({ response: {} }, 'LTM');
    const annual = parseSarmaayaRatioSeries(RATIOS_ANN_EFERT, 'ANN');
    const merged = mergeRatioSeries(ttm, annual);
    expect(merged.bookValue).toBeCloseTo(33.511, 3);
    expect(merged.bookValueAsOf).toBe('2025-12-31');
    expect(merged.periodicity).toBe('ANN');
    // …and TTM wins where it has a value of its own.
    const both = mergeRatioSeries(parseSarmaayaRatioSeries(RATIOS_LTM_EFERT, 'LTM'), annual);
    expect(both.bookValue).toBeCloseTo(32.842, 3);
    expect(both.periodicity).toBe('LTM');
  });
});

describe('parseSarmaayaDividends', () => {
  it('maps the payout history, newest announcement first, and drops the placeholder rows', () => {
    const rows = parseSarmaayaDividends(DIVIDENDS_EFERT);
    expect(rows.map((r) => [r.announcementDate, r.dividend])).toEqual([
      ['2026-08-10T00:00:00.000Z', 1.75],
      ['2026-05-04T00:00:00.000Z', 2],
      ['2025-10-24T00:00:00.000Z', 4.5],
    ]);
    // No ex-date and no payment date is published for these, so none is invented.
    expect(rows.every((r) => r.bookClosure === null && r.paymentDate === null)).toBe(true);
  });

  it('answers no rows for a symbol this source carries no payout for', () => {
    expect(parseSarmaayaDividends({ response: { data: [], payoutHistory: [] } })).toEqual([]);
    expect(parseSarmaayaDividends({ response: {} })).toEqual([]);
    expect(parseSarmaayaDividends(null)).toEqual([]);
  });
});

describe('mergeRatios', () => {
  const none: RatioDTO = {
    peRatio: null, pbRatio: null, roe: null, roa: null,
    dividendYield: null, bookValue: null, beta: null,
  };

  it('fills each field from the first provider that actually stated it', () => {
    const api: RatioDTO = { ...none, peRatio: 12.48, pbRatio: 5.95, dividendYield: 6.16, bookValue: 32.842, roe: 49.444 };
    const page: RatioDTO = { ...none, beta: 0.87 };
    const merged = mergeRatios(api, page);
    expect(merged).toEqual({ ...api, beta: 0.87 });
  });

  it('leaves a field nobody published null rather than reaching for another provider block', () => {
    expect(mergeRatios(none)).toEqual(none);
    expect(mergeRatios(null, undefined)).toBeNull();
    // A block-level pick would have thrown the page provider away entirely; field-wise keeps it.
    expect(mergeRatios(null, none)?.peRatio).toBeNull();
  });
});

describe('mergeDividends', () => {
  const row = (date: string, amount: number): DividendDTO =>
    ({ announcementDate: date, bookClosure: null, paymentDate: null, dividend: amount });

  it('deduplicates one announcement two providers both reported and keeps the first', () => {
    const merged = mergeDividends([row('2026-08-10T00:00:00.000Z', 1.75)], [row('2026-08-10T00:00:00.000Z', 1.8)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.dividend).toBe(1.75);
  });

  it('sorts newest first and drops a dateless row, which cannot key the table', () => {
    const merged = mergeDividends([row('2025-10-24T00:00:00.000Z', 4.5), row('2026-05-04T00:00:00.000Z', 2)]);
    expect(merged.map((r) => r.announcementDate)).toEqual([
      '2026-05-04T00:00:00.000Z', '2025-10-24T00:00:00.000Z',
    ]);
    expect(mergeDividends([{ announcementDate: null, bookClosure: null, paymentDate: null, dividend: 3 }])).toEqual([]);
  });
});

describe('scrapeResultSchema with the new field', () => {
  const base = {
    symbol: 'EFERT', companyName: 'Engro', sector: 'FERTILIZER', price: null,
    dividends: [] as unknown[], financials: [] as unknown[],
  };

  it('accepts a merged result that carries book value', () => {
    const parsed = scrapeResultSchema.parse({
      ...base,
      ratios: { peRatio: 12.48, pbRatio: 5.95, roe: 49.44, roa: 10.72, dividendYield: 6.16, bookValue: 32.842, beta: null },
    }) as { ratios: RatioDTO };
    expect(parsed.ratios.bookValue).toBeCloseTo(32.842, 3);
  });

  it('still accepts a provider block that has nothing to say about book value', () => {
    const parsed = scrapeResultSchema.parse({
      ...base,
      ratios: { peRatio: 10, pbRatio: 2, roe: 20, roa: 10, dividendYield: 5, beta: 0.9 },
    }) as { ratios: RatioDTO };
    expect(parsed.ratios.bookValue).toBeUndefined();
  });
});

describe('SarmaayaFundamentalsScraper over a stubbed source', () => {
  const realFetch = global.fetch;
  const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks the documented endpoints and returns the ratios, book value and dividends', async () => {
    const seen: string[] = [];
    global.fetch = (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('/details/')) return json(DETAILS_EFERT);
      if (String(url).includes('periodicity=LTM')) return json(RATIOS_LTM_EFERT);
      if (String(url).includes('/dividends/')) return json(DIVIDENDS_EFERT);
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const result = await new SarmaayaFundamentalsScraper().scrape('efert');

    expect(seen).toEqual([
      sarmaayaDetailsUrl('EFERT'),
      sarmaayaRatioSeriesUrl('PK0099701010', 'LTM'),
      sarmaayaDividendsUrl('EFERT'),
    ]);
    expect(result.ratios).toMatchObject({ peRatio: 12.48, pbRatio: 5.95, dividendYield: 6.16, bookValue: 32.842 });
    // Beta is computed from our own history against the index, never borrowed from this payload.
    expect(result.ratios!.beta).toBeNull();
    expect(result.dividends[0]).toMatchObject({ announcementDate: '2026-08-10T00:00:00.000Z', dividend: 1.75 });
    // The page scraper owns the price block and the sector; this leg must not blank them.
    expect(result.price).toBeNull();
    expect(result.sector).toBeNull();
    expect(result.companyName).toBeNull();
    expect(result.financials).toEqual([]);
  });

  it('spends the annual request only when TTM published no book value', async () => {
    const seen: string[] = [];
    global.fetch = (async (url: string) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('/details/')) return json(DETAILS_EFERT);
      if (u.includes('periodicity=LTM')) return json({ response: {} });
      if (u.includes('periodicity=ANN')) return json(RATIOS_ANN_EFERT);
      if (u.includes('/dividends/')) return json(DIVIDENDS_EFERT);
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const result = await new SarmaayaFundamentalsScraper().scrape('EFERT');

    expect(seen).toContain(sarmaayaRatioSeriesUrl('PK0099701010', 'ANN'));
    expect(result.ratios!.bookValue).toBeCloseTo(33.511, 3);
  });

  it('keeps what answered when one leg is refused, and reports the leg', async () => {
    global.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/details/')) return json(DETAILS_EFERT);
      if (u.includes('periodicity=LTM')) return json(RATIOS_LTM_EFERT);
      throw Object.assign(new Error('http=404'), { httpStatus: 404 });
    }) as unknown as typeof fetch;

    const result = await new SarmaayaFundamentalsScraper().scrape('EFERT');
    expect(result.ratios!.peRatio).toBeCloseTo(12.48, 4);
    expect(result.ratios!.bookValue).toBeCloseTo(32.842, 3);
    expect(result.dividends).toEqual([]);
  });

  it('throws when every leg fails, so the orchestrator records the provider as failed', async () => {
    global.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(new SarmaayaFundamentalsScraper().scrape('EFERT')).rejects.toThrow();
    // …and the failure is counted against the source, not against the symbol.
    expect(SARMAYA_FUNDAMENTALS_SOURCE).toBe('sarmaaya-fundamentals');
  });
});
