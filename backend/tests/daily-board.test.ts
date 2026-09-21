import { msUntilNextRun, parseBoard } from '../src/services/dailyBoard.service';

const wrap = (rows: unknown[]) => ({ success: true, message: 'Success', response: rows });

describe('parseBoard', () => {
  it('maps a board row to a symbol reading', () => {
    expect(parseBoard(wrap([
      { symbol: 'FFC', price: 540.51, change: 1.5, changePercentage: 0.28, volume: 430725, date: '2026-09-21T11:00:00.000Z' },
    ]))).toEqual([
      { symbol: 'FFC', price: 540.51, change: 1.5, changePercent: 0.28, volume: 430725, at: '2026-09-21T11:00:00.000Z' },
    ]);
  });

  it('never turns an absent price into a level of zero', () => {
    // Number(null) and Number('') are both 0, which would register a stock at zero.
    for (const absent of [null, undefined, '', 'abc']) {
      expect(parseBoard(wrap([{ symbol: 'XXX', price: absent }, { symbol: 'FFC', price: 540.51 }]))).toHaveLength(1);
    }
  });

  it('drops rows with no usable symbol', () => {
    expect(parseBoard(wrap([{ symbol: '', price: 10 }, { symbol: '   ', price: 10 }, { price: 10 }]))).toEqual([]);
  });

  it('keeps one row per symbol and sorts alphabetically', () => {
    const out = parseBoard(wrap([
      { symbol: 'ogdc', price: 317.49 },
      { symbol: 'ABL', price: 170.48 },
      { symbol: 'OGDC', price: 999 },
    ]));
    expect(out.map((r) => r.symbol)).toEqual(['ABL', 'OGDC']);
    expect(out[1]!.price).toBe(317.49);
  });

  it('carries nulls rather than zeros for the optional fields', () => {
    const [row] = parseBoard(wrap([{ symbol: 'FFC', price: 540.51 }]));
    expect(row).toEqual({ symbol: 'FFC', price: 540.51, change: null, changePercent: null, volume: null, at: null });
  });

  it('yields nothing for a payload that is not the documented envelope', () => {
    for (const bad of [null, undefined, 'nope', { response: 'not an array' }, []]) {
      expect(parseBoard(bad)).toEqual([]);
    }
  });
});

describe('msUntilNextRun', () => {
  const at = (iso: string) => new Date(iso);

  it('targets 02:00 Karachi, which is 21:00 UTC the day before', () => {
    // 09:00 UTC is 14:00 in Karachi: the next 02:00 Karachi is 21:00 UTC today.
    const now = at('2026-09-21T09:00:00.000Z');
    expect(msUntilNextRun(now, 2)).toBe(at('2026-09-21T21:00:00.000Z').getTime() - now.getTime());
  });

  it('rolls to the next day once the window has passed', () => {
    // 22:00 UTC is 03:00 Karachi the next day: 02:00 has already gone, so it is ~23 hours away.
    const now = at('2026-09-21T22:00:00.000Z');
    expect(msUntilNextRun(now, 2)).toBe(at('2026-09-22T21:00:00.000Z').getTime() - now.getTime());
  });

  it('never returns zero or a negative wait', () => {
    for (const iso of ['2026-09-21T20:59:59.000Z', '2026-09-21T21:00:00.000Z', '2026-09-21T21:00:01.000Z']) {
      expect(msUntilNextRun(at(iso), 2)).toBeGreaterThan(0);
    }
  });

  it('handles an hour that stays on the same UTC day', () => {
    const now = at('2026-09-21T00:00:00.000Z');
    expect(msUntilNextRun(now, 10)).toBe(at('2026-09-21T05:00:00.000Z').getTime() - now.getTime());
  });
});
