import { prisma } from '../src/database/prisma';
import {
  annualiseLevels,
  buyLot,
  calculateRoi,
  dcaSchedule,
  maxDrawdown,
  sessionOnOrAfter,
  sessionOnOrBefore,
  suspectedAction,
  xirr,
} from '../src/services/roi.service';

/**
 * What these tests pin, in order of how expensive the mistake would be:
 *
 *  - the cash maths (whole shares, fees charged once, nothing overspent);
 *  - XIRR against hand-checked answers, including the sub-year case;
 *  - which dividends a holding is entitled to at each boundary;
 *  - the DCA calendar on 29/30/31-day months and holidays;
 *  - that a split inside the window is *reported*, not silently averaged into the return.
 *
 * The pure functions need no database; the boundary cases at the end run against real rows because
 * the entitlement rule and the session resolver are SQL-shaped and a mock would test the mock.
 */

const DAY = 86_400_000;
const SYMBOL = 'ZZROI1';
const SPLIT = 'ZZROI2';

/** A stored session stamped 16:00 PKT, the way every row is. */
function sessionAt(isoDate: string): Date {
  return new Date(`${isoDate}T11:00:00.000Z`);
}

describe('buyLot — whole shares, fees charged once', () => {
  it('matches a hand calculation at 0.15%', () => {
    const lot = buyLot(10_000_000, 378.8, 0.15, 0);
    // 378.80 × 1.0015 = 379.3682 → floor(100000 / 379.3682) = 263 shares
    expect(lot.quantity).toBe(263);
    expect(lot.invested).toBe(9_977_384); // 263 × 378.80 = 99,624.40 + 149.44 fee
    expect(lot.leftover).toBe(22_616);
    expect(lot.invested + lot.leftover).toBe(10_000_000);
  });

  it('takes the flat fee out of the cash *before* dividing', () => {
    const withFlat = buyLot(1_000_000, 100, 0, 250);
    // (10,000 − 250) / 100 = 97.5 → 97 shares: 9,700 of shares + the 250 flat charge = 9,950 spent
    expect(withFlat.quantity).toBe(97);
    expect(withFlat.invested).toBe(995_000);
    expect(withFlat.leftover).toBe(5_000);
  });

  it('buys nothing when the cash cannot cover one share plus the flat fee', () => {
    const lot = buyLot(5_000, 100, 0.15, 60);
    expect(lot.quantity).toBe(0);
    expect(lot.invested).toBe(0);
    expect(lot.leftover).toBe(5_000);
  });
});

describe('xirr — actual/365, hand-checked', () => {
  it('solves a one-year double-digit return', () => {
    const r = xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 110 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(10, 1);
  });

  it('solves two years at 10% a year', () => {
    const r = xirr([
      { date: '2024-01-01', amount: -100 },
      { date: '2026-01-01', amount: 121 },
    ]);
    expect(r!).toBeCloseTo(10, 1);
  });

  it('returns null when every flow has the same sign', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2025-06-01', amount: -50 }])).toBeNull();
  });
});

describe('annualiseLevels', () => {
  it('annualises an index ratio over two years', () => {
    expect(annualiseLevels(100, 121, 730)).toBeCloseTo(10, 1);
  });

  it('refuses to annualise under a year', () => {
    expect(annualiseLevels(100, 110, 300)).toBeNull();
  });
});

describe('suspectedAction — a split is a step, not a crash', () => {
  it('recognises a 10-for-1 split and its reverse', () => {
    expect(suspectedAction(1000, 100)).toBe(10);
    expect(suspectedAction(100, 1000)).toBeCloseTo(0.1, 5);
  });

  it('recognises a 2-for-1 split', () => {
    expect(suspectedAction(200, 100)).toBe(2);
  });

  it('leaves an ordinary bad day alone', () => {
    expect(suspectedAction(100, 70)).toBeNull(); // −30%, not a simple fraction
    expect(suspectedAction(100, 95)).toBeNull();
    expect(suspectedAction(100, 100)).toBeNull();
  });
});

describe('maxDrawdown', () => {
  it('finds the deepest peak-to-trough fall', () => {
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(50, 5);
  });

  it('is zero on a monotonic series', () => {
    expect(maxDrawdown([100, 101, 102])).toBe(0);
  });
});

describe('session resolution', () => {
  const dates = ['2026-09-01', '2026-09-10', '2026-09-20'];

  it('moves a holiday forward to the next session for a buy', () => {
    expect(sessionOnOrAfter(dates, '2026-09-05')).toBe('2026-09-10');
  });

  it('moves a holiday back to the previous session for a sell', () => {
    expect(sessionOnOrBefore(dates, '2026-09-05')).toBe('2026-09-01');
  });

  it('returns null outside the stored range', () => {
    expect(sessionOnOrAfter(dates, '2026-10-01')).toBeNull();
    expect(sessionOnOrBefore(dates, '2026-08-01')).toBeNull();
  });
});

describe('dcaSchedule — month ends and missing days', () => {
  // Real sessions around a leap February and a 31-day month.
  const dates = [
    '2024-01-31', '2024-02-01', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-28', '2024-03-29',
    '2024-04-01', '2024-04-30', '2024-05-01', '2024-05-31',
  ];

  it('uses the last session of a short month when day=31', () => {
    const out = dcaSchedule(dates, '2024-01-01', '2024-04-30', 31);
    expect(out).toEqual(['2024-01-31', '2024-02-29', '2024-03-29', '2024-04-30']);
  });

  it('never schedules a contribution after the sell date', () => {
    const out = dcaSchedule(dates, '2024-01-01', '2024-03-15', 1);
    expect(out[out.length - 1]!).toBe('2024-03-01');
    expect(out.every((d) => d <= '2024-03-15')).toBe(true);
  });

  it('buys at the first session after the start date, then on the chosen day', () => {
    const out = dcaSchedule(dates, '2024-02-10', '2024-04-30', 1);
    expect(out).toEqual(['2024-02-28', '2024-03-01', '2024-04-01']);
  });
});

describe('calculateRoi — entitlement boundaries against stored rows', () => {
  beforeAll(async () => {
    await prisma.stock.deleteMany({ where: { symbol: { in: [SYMBOL, SPLIT] } } });

    const stock = await prisma.stock.create({
      data: { symbol: SYMBOL, companyName: 'ZZ ROI test' },
      select: { id: true },
    });
    for (const [d, close] of [
      ['2026-09-01', 100],
      ['2026-09-10', 110],
      ['2026-09-20', 120],
    ] as const) {
      await prisma.stockPrice.create({
        data: { stockId: stock.id, close, currentPrice: close, volume: 1000n, lastTradeDate: sessionAt(d) },
      });
    }
    await prisma.dividend.create({
      data: { stockId: stock.id, dividend: 5, announcementDate: new Date('2026-09-10T00:00:00.000Z') },
    });

    const split = await prisma.stock.create({
      data: { symbol: SPLIT, companyName: 'ZZ split test' },
      select: { id: true },
    });
    for (const [d, close] of [
      ['2025-01-02', 1000],
      ['2025-01-03', 100],
    ] as const) {
      await prisma.stockPrice.create({
        data: { stockId: split.id, close, currentPrice: close, volume: 1000n, lastTradeDate: sessionAt(d) },
      });
    }
  });

  afterAll(async () => {
    await prisma.stock.deleteMany({ where: { symbol: { in: [SYMBOL, SPLIT] } } });
    await prisma.$disconnect();
  });

  const run = (start: string, end: string) =>
    calculateRoi({
      mode: 'single',
      symbols: [SYMBOL],
      start,
      end,
      amount: 10_000,
      feePct: 0,
      feeFlat: 0,
      divTaxPct: 0,
      cgtPct: 0,
    });

  it('credits a dividend announced after the buy date', async () => {
    const r = await run('2026-09-01', '2026-09-20');
    expect(r.holding!.quantity).toBe(100);
    expect(r.holding!.dividends.count).toBe(1);
    expect(r.holding!.dividends.gross).toBe(500);
    expect(r.holding!.profit).toBe(2_500); // 12,000 proceeds + 500 dividend − 10,000
    expect(r.holding!.returnPct).toBe(25);
  });

  it('does not credit a dividend when the buy date is the announcement date', async () => {
    const r = await run('2026-09-10', '2026-09-20');
    expect(r.holding!.dividends.count).toBe(0);
    expect(r.holding!.quantity).toBe(90);
  });

  it('credits a dividend when the sell date is the announcement date', async () => {
    const r = await run('2026-09-01', '2026-09-10');
    expect(r.holding!.dividends.count).toBe(1);
  });

  it('resolves a weekend start forward to the next session', async () => {
    const r = await run('2026-09-05', '2026-09-20');
    expect(r.holding!.buy.session).toBe('2026-09-10');
    expect(r.holding!.buy.movedFromRequest).toBe(true);
  });

  it('withholds the annualised figure under a year and says why', async () => {
    const r = await run('2026-09-01', '2026-09-20');
    expect(r.holding!.annualisedPct).toBeNull();
    expect(r.meta.warnings.some((w) => w.code === 'SHORT_HOLDING')).toBe(true);
  });

  it('flags a split inside the window instead of annualising a 90% fall', async () => {
    const r = await calculateRoi({
      mode: 'single',
      symbols: [SPLIT],
      start: '2025-01-02',
      end: '2025-01-03',
      amount: 10_000,
      feePct: 0,
      feeFlat: 0,
      divTaxPct: 0,
      cgtPct: 0,
    });
    expect(r.meta.warnings.some((w) => w.code === 'CORPORATE_ACTION_SUSPECTED')).toBe(true);
    expect(r.holding!.annualisedPct).toBeNull();
  });

  it('rejects a symbol with no stored sessions', async () => {
    await expect(
      calculateRoi({
        mode: 'single',
        symbols: ['ZZNOPE'],
        start: '2026-09-01',
        end: '2026-09-20',
        amount: 10_000,
        feePct: 0,
        feeFlat: 0,
        divTaxPct: 0,
        cgtPct: 0,
      }),
    ).rejects.toThrow(/No stored sessions/);
  });
});
