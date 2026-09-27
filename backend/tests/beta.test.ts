import {
  BETA_METHOD,
  BETA_MIN_OBSERVATIONS,
  BETA_WINDOW_SESSIONS,
  betaService,
  computeBeta,
  type BetaSample,
} from '../src/services/beta.service';
import { fetchBetaSeries, recordBeta } from '../src/repositories/beta.repository';
import { stockRepository } from '../src/repositories/stock.repository';

/**
 * Beta is measured, not scraped (#79 criterion 7), so these tests pin the two things a measurement
 * can get wrong without anybody noticing: the arithmetic (against a hand calculation) and the
 * window (which sessions are allowed to contribute a return).
 */

jest.mock('../src/repositories/beta.repository', () => ({
  fetchBetaSeries: jest.fn(),
  recordBeta: jest.fn(),
}));
jest.mock('../src/repositories/stock.repository', () => ({
  stockRepository: { findAllSymbols: jest.fn() },
}));

const fetchSeries = fetchBetaSeries as jest.Mock;
const store = recordBeta as jest.Mock;
const allSymbols = stockRepository.findAllSymbols as jest.Mock;

beforeEach(() => jest.clearAllMocks());

/** The window's samples from parallel arrays of closes; null means "no close that session". */
const samples = (indexCloses: Array<number | null>, stockCloses: Array<number | null>): BetaSample[] =>
  indexCloses.map((indexClose, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    indexClose,
    stockClose: stockCloses[i] ?? null,
  }));

/**
 * A window long enough to measure, in which the stock compounds at (1.01)² / (0.99)² per session
 * while the index compounds at 1.01 / 0.99 — alternating so the index genuinely moves, i.e. a beta
 * of exactly 2 over a window whose variance is not zero.
 */
const tracking = (n = BETA_MIN_OBSERVATIONS): BetaSample[] => {
  const idx: number[] = [100];
  const stk: number[] = [200];
  for (let i = 1; i <= n; i += 1) {
    const up = i % 2 === 1;
    idx.push(Number((idx[i - 1]! * (up ? 1.01 : 0.99)).toFixed(6)));
    stk.push(Number((stk[i - 1]! * (up ? 1.0201 : 0.9801)).toFixed(6)));
  }
  return samples(idx, stk);
};

describe('computeBeta — the arithmetic', () => {
  it('matches a hand calculation on the same window', () => {
    // Three sessions, two returns:
    //   index  100 → 110 → 99     log returns  +0.095310, -0.105361
    //   stock   50 →  60 → 60     log returns  +0.182322,  0.000000
    // Means: index -0.005025, stock 0.091161. Deviations are symmetric in both series, so
    // cov = 2·(0.100335·0.091161)/1 and var(index) = 2·(0.100335²)/1 — the 2s cancel and
    //   beta = 0.091161 / 0.100335 = 0.908566
    // which is (log(1.2)/2) / ((log(1.1) − log(0.9))/2), the closed form written out here.
    const expected = (Math.log(1.2) / 2) / ((Math.log(1.1) - Math.log(0.9)) / 2);

    const result = computeBeta(samples([100, 110, 99], [50, 60, 60]), { minimum: 1 });

    expect(result.value).toBeCloseTo(expected, 4);
    expect(result.value).toBeCloseTo(0.9086, 4);
    expect(result.reason).toBeNull();
    expect(result.window.observations).toBe(2);
    expect(result.window.from).toBe('2026-09-01');
    expect(result.window.to).toBe('2026-09-03');
    expect(result.method).toBe(BETA_METHOD);
  });

  it('gives 2 for a stock whose every move is twice the index’s', () => {
    // Each stock log return is exactly twice the index's (the factors are 1.01² / 0.99² against
    // 1.01 / 0.99), so cov = 2·var and beta is 2 by construction — over a window whose index
    // variance is not zero, which a single geometric series would have been.
    const result = computeBeta(tracking(5), { minimum: 5 });
    expect(result.value).toBeCloseTo(2, 3);
    expect(result.window.observations).toBe(5);
  });

  it('measures a beta of 1 for a stock that tracks the index', () => {
    const result = computeBeta(samples([100, 105, 110, 120], [500, 525, 550, 600]), { minimum: 1 });
    expect(result.value).toBeCloseTo(1, 4);
  });

  it('reports the window it used, and the default one is the stated year', () => {
    const result = computeBeta(samples([100, 101, 102], [200, 202, 204]), { minimum: 1 });
    expect(result.window).toEqual({
      index: 'KSE100',
      label: '1Y',
      sessions: BETA_WINDOW_SESSIONS,
      observations: 2,
      from: '2026-09-01',
      to: '2026-09-03',
      minimum: 1,
    });
  });
});

describe('computeBeta — which sessions may contribute', () => {
  it('takes a return only when both series have a close on both sessions of the pair', () => {
    // Sessions 2 and 4 have no stock close: nothing is measured across them, and the observations
    // count says so rather than a value being carried forward from the neighbouring session.
    const result = computeBeta(samples([100, 101, 102, 103, 104, 105], [10, null, 12, null, 14, 15]));

    // Only the 5→6 pair is fully aligned, so one return — and one is not a year.
    expect(result.window.observations).toBe(1);
    expect(result.window.from).toBe('2026-09-05');
    expect(result.window.to).toBe('2026-09-06');
    expect(result.value).toBeNull();
    expect(result.reason).toContain('1 aligned session');
  });

  it('never carries a close across a gap', () => {
    // A stock traded on day 1 and day 3 only. The move across day 2 must not become a return: the
    // 1→3 pair is two index sessions apart, and the index's own 2→3 move is left with no stock leg.
    const result = computeBeta(samples([100, 101, 102], [10, null, 12]), { minimum: 1 });
    expect(result.window.observations).toBe(0);
    expect(result.value).toBeNull();
    expect(result.reason).toContain('no session in the last');
  });

  it('ignores a non-positive close rather than computing an infinite return', () => {
    const result = computeBeta(samples([100, 101, 102], [10, 0, 12]), { minimum: 1 });
    expect(result.window.observations).toBe(0);
    expect(result.value).toBeNull();
  });

  it('is undefined when the index did not move at all', () => {
    const result = computeBeta(samples([100, 100, 100], [10, 20, 5]), { minimum: 1 });
    expect(result.value).toBeNull();
    expect(result.reason).toContain('no variation');
  });
});

describe('computeBeta — the minimum', () => {
  it('is a dash below the minimum, with the window and the reason reported', () => {
    // Five aligned sessions is a handful of days, not a year: the answer is the dash, and the
    // payload still says which window was looked at and how much of it was usable.
    const indexCloses = Array.from({ length: 6 }, (_, i) => 100 + i);
    const stockCloses = Array.from({ length: 6 }, (_, i) => 200 + 2 * i);
    const result = computeBeta(samples(indexCloses, stockCloses));

    expect(result.value).toBeNull();
    expect(result.reason).toContain(`${BETA_MIN_OBSERVATIONS} are required`);
    expect(result.reason).toContain('5 aligned session(s)');
    expect(result.window.observations).toBe(5);
    expect(result.window.minimum).toBe(BETA_MIN_OBSERVATIONS);
    expect(result.window.sessions).toBe(BETA_WINDOW_SESSIONS);
  });

  it('serves a value once the window is long enough', () => {
    const result = computeBeta(tracking(BETA_MIN_OBSERVATIONS));
    expect(result.window.observations).toBe(BETA_MIN_OBSERVATIONS);
    expect(result.value).not.toBeNull();
    expect(result.reason).toBeNull();
  });
});

describe('betaService — reading and storing', () => {
  it('computes over the stored window and writes the value into the column', async () => {
    fetchSeries.mockResolvedValue(tracking(60));
    store.mockResolvedValue('updated');

    const result = await betaService.refreshSymbol('FFC');

    // The window asked of the database is the stated one, and the window reported is the one used.
    expect(fetchSeries).toHaveBeenCalledWith('FFC', BETA_WINDOW_SESSIONS, 'KSE100');
    expect(store).toHaveBeenCalledWith('FFC', result.value);
    expect(result.value).toBeCloseTo(2, 2);
    expect(result.window.observations).toBe(60);
    expect(result.stored).toBe('updated');
  });

  it('stores a null — never a figure from a handful of days — when the window is too thin', async () => {
    fetchSeries.mockResolvedValue(samples([100, 101], [200, 202]));
    store.mockResolvedValue('updated');

    const result = await betaService.refreshSymbol('NEWLIST');

    expect(result.value).toBeNull();
    expect(store).toHaveBeenCalledWith('NEWLIST', null);
  });

  it('refreshes every tracked symbol and counts what it did', async () => {
    allSymbols.mockResolvedValue(['FFC', 'NEWLIST']);
    fetchSeries.mockResolvedValueOnce(tracking(60)).mockResolvedValueOnce(samples([100, 101], [200, 202]));
    store.mockResolvedValue('updated');

    const summary = await betaService.refreshAll();

    expect(summary.tracked).toBe(2);
    expect(summary.computed).toBe(1);
    expect(summary.written.updated).toBe(2);
    expect(summary.belowMinimum).toHaveLength(1);
    expect(summary.belowMinimum[0]!.symbol).toBe('NEWLIST');
    expect(summary.belowMinimum[0]!.reason).toContain('required');
  });

  it('keeps walking when one symbol fails, and names the failure', async () => {
    allSymbols.mockResolvedValue(['BROKEN', 'FFC']);
    fetchSeries.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(tracking(60));
    store.mockResolvedValue('updated');

    const summary = await betaService.refreshAll();

    expect(summary.computed).toBe(1);
    expect(summary.belowMinimum[0]).toEqual({
      symbol: 'BROKEN',
      observations: 0,
      reason: 'refresh failed: boom',
    });
  });
});
