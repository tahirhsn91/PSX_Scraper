import {
  FUNDAMENTAL_METRICS,
  CURRENT_KEYS,
  FUTURE_KEYS,
  metricCredit,
  scoreFundamentals,
  medianOf,
  mediansOf,
  verdictOf,
  outlookOf,
} from '../src/services/fundamentals.service';

describe('fundamentals scoring (#131)', () => {
  test('the metric list carries every one of the 17 requested fields exactly once', () => {
    const keys = FUNDAMENTAL_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(17);
    expect(keys).toEqual(expect.arrayContaining([
      'eps', 'peRatio', 'bookValue', 'pbRatio', 'dividendYield', 'dps', 'payoutRatio',
      'roe', 'roa', 'roic', 'debtToEquity', 'currentRatio', 'netProfitMargin',
      'revenueGrowth', 'epsGrowth', 'freeFloatShares', 'freeFloatPercent',
    ]));
  });

  test('current and future groups partition the scored metrics, free float is informational only', () => {
    const neutral = FUNDAMENTAL_METRICS.filter((m) => m.direction === 'neutral').map((m) => m.key);
    expect(neutral).toEqual(['freeFloatShares', 'freeFloatPercent']);
    const scored = [...CURRENT_KEYS, ...FUTURE_KEYS];
    // debtToEquity is deliberately in both groups.
    expect(scored).toContain('debtToEquity');
    expect(new Set(CURRENT_KEYS).has('debtToEquity')).toBe(true);
    expect(new Set(FUTURE_KEYS).has('debtToEquity')).toBe(true);
  });

  test('metricCredit: higher-better earns full credit only by beating both signals', () => {
    // ROE: benchmark 15, higher-better.
    expect(metricCredit('roe', 20, 10)).toBe(1);    // beats benchmark (>=15) and median (>=10)
    expect(metricCredit('roe', 12, 10)).toBe(0.5);  // beats median, misses benchmark
    expect(metricCredit('roe', 18, 25)).toBe(0.5);  // beats benchmark, misses median
    expect(metricCredit('roe', 5, 10)).toBe(0);     // beats neither
  });

  test('metricCredit: lower-better never treats a negative value as a bargain', () => {
    // P/E: benchmark 20, lower-better.
    expect(metricCredit('peRatio', 12, 15)).toBe(1);   // beats benchmark and median
    expect(metricCredit('peRatio', 25, 30)).toBe(0.5); // beats median only
    expect(metricCredit('peRatio', -5, 15)).toBe(0);   // negative P/E is a loss, not a bargain
  });

  test('metricCredit: range metric (payout ratio 20–70) is benchmark-only', () => {
    expect(metricCredit('payoutRatio', 50, null)).toBe(1);   // inside 20–70
    expect(metricCredit('payoutRatio', 90, 40)).toBe(0);     // outside 20–70
  });

  test('metricCredit: neutral and unpublished metrics are excluded, not scored as zero', () => {
    expect(metricCredit('freeFloatShares', 600_000_000, 400_000_000)).toBeNull();
    expect(metricCredit('roe', null, 10)).toBeNull();
    expect(metricCredit('roe', undefined, 10)).toBeNull();
  });

  test('medianOf and mediansOf compute medians and skip unpublished values', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    const medians = mediansOf([
      { roe: 10, peRatio: 20, currentRatio: null },
      { roe: 20, peRatio: 30, currentRatio: 1.5 },
      { roe: 30, peRatio: null, currentRatio: 2.0 },
    ]);
    expect(medians.roe).toBe(20);
    expect(medians.peRatio).toBe(25);       // (20+30)/2
    expect(medians.currentRatio).toBe(1.75); // (1.5+2.0)/2
  });

  test('scoreFundamentals: the math is the mean credit, not a guess', () => {
    // A clean, fully-assessed example where the verdict follows the arithmetic.
    const ratios: Record<string, number | null> = {
      // Current — all beat both benchmark and median except P/E and D/E (miss both).
      eps: 10, peRatio: 30, bookValue: 100, pbRatio: 4, dividendYield: 6, dps: 5,
      payoutRatio: 50, roe: 20, roa: 8, roic: 12, debtToEquity: 2, currentRatio: 2,
      netProfitMargin: 15,
      // Future — revenue and EPS growth beat both; D/E (leverage) misses both.
      revenueGrowth: 15, epsGrowth: 20,
      freeFloatShares: 500_000_000, freeFloatPercent: 45,
    };
    // Medians chosen so every current metric beats the median (>= for higher, <= for lower)
    // and P/E / D/E miss the *benchmark* (P/E 30 > 20, D/E 2 > 1).
    const medians: Record<string, number | null> = {
      eps: 5, peRatio: 15, bookValue: 50, pbRatio: 2, dividendYield: 3, dps: 2,
      payoutRatio: 40, roe: 10, roa: 4, roic: 6, debtToEquity: 1, currentRatio: 1,
      netProfitMargin: 8, revenueGrowth: 5, epsGrowth: 8,
      freeFloatShares: 300_000_000, freeFloatPercent: 30,
    };

    const ins = scoreFundamentals(ratios, medians);

    // Current: 13 metrics. P/E (30 > 20), P/B (4 > 3) and D/E (2 > 1) all miss their benchmark
    // AND their median, so they score 0; the other ten beat both and score 1.
    // Sum = 10 over 13 -> 76.9 -> 77.
    expect(ins.current.assessed).toBe(13);
    expect(ins.current.score).toBe(Math.round((10 / 13) * 100)); // 77

    // Future: revenueGrowth and epsGrowth beat both (1 each); D/E (2, median 1, lower-better)
    // misses both -> 0. Sum = 2 over 3 -> 66.7 -> 67.
    expect(ins.future.assessed).toBe(3);
    expect(ins.future.score).toBe(Math.round((2 / 3) * 100)); // 67

    expect(ins.overall).toBe(Math.round((77 + 67) / 2)); // 72
    expect(ins.verdict).toBe('strong');
    expect(ins.outlook).toBe('positive');
  });

  test('scoreFundamentals: an unpublished metric shrinks the denominator, never the score', () => {
    const ratios: Record<string, number | null> = {
      roe: 20, roa: null, roic: null, peRatio: null, pbRatio: null, dividendYield: null,
      dps: null, payoutRatio: null, debtToEquity: null, currentRatio: null,
      netProfitMargin: null, eps: null, bookValue: null,
      revenueGrowth: null, epsGrowth: null, freeFloatShares: null, freeFloatPercent: null,
    };
    const medians: Record<string, number | null> = { roe: 10 };
    const ins = scoreFundamentals(ratios, medians);
    // Only ROE is assessed in the current group, and it beats both -> 100.
    expect(ins.current.assessed).toBe(1);
    expect(ins.current.score).toBe(100);
    // No future metric assessed.
    expect(ins.future.score).toBeNull();
    expect(ins.outlook).toBeNull();
  });

  test('verdictOf and outlookOf map score bands to labels', () => {
    expect(verdictOf(null)).toBeNull();
    expect(verdictOf(67)).toBe('strong');
    expect(verdictOf(50)).toBe('fair');
    expect(verdictOf(10)).toBe('weak');
    expect(outlookOf(80)).toBe('positive');
    expect(outlookOf(40)).toBe('neutral');
    expect(outlookOf(20)).toBe('cautious');
  });
});
