import {
  METRIC_RULES,
  MIN_METRICS,
  MIN_PEERS,
  LOSS_CAP,
  NEGATIVE_EQUITY_CAP,
  scoreFundamentals,
  peerStatsOf,
  percentileOf,
  metricScores,
  pillarScores,
  verdictOf,
  outlookOf,
  isFinancialSector,
  medianOf,
  type PeerStats,
  type RatioMap,
} from '../src/services/fundamentals.service';

/** A sector with no peer distributions: every metric is scored on its absolute curve only. */
const soloPeer = (sector = 'CEMENT'): PeerStats => ({ sector, distributions: {} });

describe('fundamentals scoring v2', () => {
  test('the metric list scores 12 ratios — rupee amounts are gates, not scores', () => {
    const keys = METRIC_RULES.map((m) => m.key);
    expect(keys).toHaveLength(12);
    // EPS / book value / DPS are not scored on level: a 5 rupee EPS is not comparable to a 300 rupee one.
    expect(keys).not.toContain('eps');
    expect(keys).not.toContain('bookValue');
    expect(keys).not.toContain('dps');
    expect(keys).toContain('roe');
    expect(keys).toContain('peRatio');
    expect(keys).toContain('epsGrowth');
  });

  test('curves are continuous, so scores are not a handful of steps', () => {
    const roe = METRIC_RULES.find((m) => m.key === 'roe')!;
    expect(roe.curve(0)).toBe(0);
    expect(roe.curve(12.5)).toBe(50);
    expect(roe.curve(25)).toBe(100);
    expect(roe.curve(40)).toBe(100); // clamped

    const pe = METRIC_RULES.find((m) => m.key === 'peRatio')!;
    expect(pe.curve(8)).toBe(100);
    expect(pe.curve(21.5)).toBe(50);
    expect(pe.curve(35)).toBe(0);
    expect(pe.curve(-4)).toBe(0); // a loss has no meaningful P/E

    const payout = METRIC_RULES.find((m) => m.key === 'payoutRatio')!;
    expect(payout.curve(42)).toBe(100);
    expect(payout.curve(10)).toBeLessThan(100);
    expect(payout.curve(90)).toBeLessThan(20);
  });

  test('percentiles need a real peer group, and rank correctly when they have one', () => {
    expect(percentileOf(5, [1, 2, 3])).toBeNull(); // fewer than MIN_PEERS
    expect(MIN_PEERS).toBe(8);
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(percentileOf(5, sorted)).toBeCloseTo((4 / 8) * 100); // four below, eight gaps
    expect(percentileOf(1, sorted)).toBe(0);
    expect(percentileOf(9, sorted)).toBe(100);
  });

  test('peerStatsOf sorts the published values and skips nulls', () => {
    const peer = peerStatsOf('CEMENT', [
      { roe: 20, peRatio: 8 },
      { roe: 5, peRatio: null },
      { roe: null, peRatio: 12 },
    ]);
    expect(peer.distributions.roe).toEqual([5, 20]);
    expect(peer.distributions.peRatio).toEqual([8, 12]);
    expect(peer.distributions.roa).toBeUndefined();
  });

  test('metricScores blends absolute quality with the sector percentile', () => {
    const peer: PeerStats = {
      sector: 'CEMENT',
      distributions: { roe: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    };
    const [roe] = metricScores({ roe: 9 }, peer);
    // absolute 9/25 = 36, percentile 100 → 68
    expect(roe!.score).toBeCloseTo(0.5 * 36 + 0.5 * 100, 5);
    // with no distribution it is the absolute score alone
    const [solo] = metricScores({ roe: 9 }, soloPeer());
    expect(solo!.score).toBeCloseTo(36, 5);
  });

  test('pillarScores averages within a pillar, not across pillars', () => {
    const scores = metricScores({ roe: 25, roa: 15 }, soloPeer());
    expect(pillarScores(scores).profitability).toBeCloseTo(100, 5);
  });

  test('the arithmetic: absolute curves, weighted pillars, mean of the two views', () => {
    // Every metric lands exactly on the middle of its curve, payout inside its band.
    const ratios: RatioMap = {
      roe: 12.5, roa: 7.5, netProfitMargin: 12.5,
      peRatio: 21.5, pbRatio: 3.5,
      dividendYield: 4.5, payoutRatio: 42.5,
      revenueGrowth: 10, epsGrowth: 10,
      debtToEquity: 1.4, currentRatio: 1.65,
      eps: 5, bookValue: 50,
    };

    const ins = scoreFundamentals(ratios, soloPeer());

    // current: profitability .45*50 + valuation .30*50 + income .15*75 + health .10*50 = 53.75
    expect(ins.current.score).toBe(54);
    // future: growth .6*50 + profitability .4*50 = 50
    expect(ins.future.score).toBe(50);
    expect(ins.future.fallback).toBe(false);
    expect(ins.overall).toBe(52);
    expect(ins.verdict).toBe('fair');
    expect(ins.outlook).toBe('neutral');
    expect(ins.pillars.map((p) => p.key)).toEqual(['profitability', 'growth', 'valuation', 'health', 'income']);
    expect(ins.pillars.find((p) => p.key === 'income')!.score).toBe(75);
  });

  test('a bank is not failed on leverage and liquidity ratios it does not report', () => {
    const ratios: RatioMap = {
      roe: 20, roa: 10, netProfitMargin: 20,
      peRatio: 6, pbRatio: 1,
      dividendYield: 6, payoutRatio: 50,
      revenueGrowth: 15, epsGrowth: 20,
      // Nonsense for a bank — they must be ignored, not scored as failures.
      debtToEquity: 9, currentRatio: 0.4,
    };

    const ins = scoreFundamentals(ratios, soloPeer('COMMERCIAL BANKS'));

    expect(isFinancialSector('COMMERCIAL BANKS')).toBe(true);
    expect(ins.coverage).toEqual({ scored: 9, applicable: 9 });
    expect(ins.current.score).toBe(85);
    expect(ins.future.score).toBe(69);
    expect(ins.overall).toBe(77);
    expect(ins.verdict).toBe('strong');
  });

  test('the same ratios in a non-financial sector are held back by the same leverage', () => {
    const ins = scoreFundamentals(
      { roe: 20, roa: 10, netProfitMargin: 20, peRatio: 6, pbRatio: 1, debtToEquity: 9, currentRatio: 0.4 },
      soloPeer('CEMENT'),
    );
    // D/E 9 and current ratio 0.4 both score 0, dragging the health pillar and the current view down.
    expect(ins.pillars.find((p) => p.key === 'health')!.score).toBe(0);
    expect(ins.current.score).toBeLessThan(85);
  });

  test('two published ratios are a dash, not a performance score', () => {
    const ins = scoreFundamentals({ peRatio: 5, pbRatio: 0.8 }, soloPeer());
    expect(ins.coverage).toEqual({ scored: 2, applicable: 12 });
    expect(ins.overall).toBeNull();
    expect(ins.verdict).toBeNull();
    expect(ins.outlook).toBeNull();
    expect(MIN_METRICS).toBe(4);
  });

  test('four metrics across two pillars are enough to score', () => {
    const ins = scoreFundamentals({ roe: 20, roa: 10, peRatio: 10, pbRatio: 2 }, soloPeer());
    expect(ins.overall).not.toBeNull();
    expect(ins.coverage.scored).toBe(4);
  });

  test('a loss-maker can never read Strong, however cheap its ratios look', () => {
    const ins = scoreFundamentals(
      {
        roe: 45, roa: 25, netProfitMargin: 35, peRatio: 3, pbRatio: 0.4,
        dividendYield: 12, payoutRatio: 40, revenueGrowth: 40, epsGrowth: 80,
        debtToEquity: 0.1, currentRatio: 3,
        eps: -2.5,
      },
      soloPeer(),
    );
    expect(ins.capped).toBe('loss');
    expect(ins.current.score).toBe(LOSS_CAP);
    expect(ins.future.score).toBe(LOSS_CAP);
    expect(ins.overall).toBe(LOSS_CAP);
    expect(ins.verdict).toBe('fair'); // 49 is still "fair" — but never "strong"
    expect(ins.outlook).toBe('neutral');
  });

  test('negative equity caps harder than a loss', () => {
    const ins = scoreFundamentals(
      { roe: 45, roa: 25, netProfitMargin: 35, peRatio: 3, pbRatio: 0.4, bookValue: -12 },
      soloPeer(),
    );
    expect(ins.capped).toBe('negative-equity');
    expect(ins.overall).toBe(NEGATIVE_EQUITY_CAP);
  });

  test('the forward view falls back to the current view when no growth series exists', () => {
    const ins = scoreFundamentals(
      { roe: 20, roa: 10, netProfitMargin: 20, peRatio: 12, pbRatio: 2 },
      soloPeer(),
    );
    expect(ins.future.fallback).toBe(true);
    expect(ins.future.score).toBe(ins.current.score);
  });

  test('a stock with no published ratios has no score at all', () => {
    const ins = scoreFundamentals({}, soloPeer());
    expect(ins.coverage.scored).toBe(0);
    expect(ins.current.score).toBeNull();
    expect(ins.future.score).toBeNull();
    expect(ins.overall).toBeNull();
    expect(ins.verdict).toBeNull();
    expect(ins.outlook).toBeNull();
    expect(ins.pillars).toEqual([]);
  });

  test('verdict and outlook bands', () => {
    expect(verdictOf(null)).toBeNull();
    expect(verdictOf(67)).toBe('strong');
    expect(verdictOf(66)).toBe('fair');
    expect(verdictOf(34)).toBe('fair');
    expect(verdictOf(33)).toBe('weak');
    expect(outlookOf(67)).toBe('positive');
    expect(outlookOf(34)).toBe('neutral');
    expect(outlookOf(33)).toBe('cautious');
  });

  test('medianOf still works for the median tiles', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
});
