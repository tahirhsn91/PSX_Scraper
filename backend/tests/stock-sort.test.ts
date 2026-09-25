import { buildOrderBy, SORTABLE_COLUMNS, STOCK_SORT_FIELDS } from '../src/repositories/stock.repository';
import { stocksQuery } from '../src/validators/schemas';

/**
 * Sorting reaches SQL as text (ORDER BY cannot take a bound parameter), so the safety of that
 * text is the thing worth testing: every clause must be assembled from the column whitelist
 * and the direction enum, and a hostile `sort` value must never get that far.
 */
describe('buildOrderBy', () => {
  it('sorts the requested column in the requested direction', () => {
    expect(buildOrderBy('price', 'asc')).toBe('p.current_price ASC NULLS LAST, s.symbol ASC');
    expect(buildOrderBy('volume', 'desc')).toBe('p.volume DESC NULLS LAST, s.symbol ASC');
    expect(buildOrderBy('change', 'desc')).toBe('p.change DESC NULLS LAST, s.symbol ASC');
    expect(buildOrderBy('changePercent', 'desc')).toBe('p.change_percent DESC NULLS LAST, s.symbol ASC');
    expect(buildOrderBy('week52Low', 'asc')).toBe('p.week52_low ASC NULLS LAST, s.symbol ASC');
    expect(buildOrderBy('week52High', 'asc')).toBe('p.week52_high ASC NULLS LAST, s.symbol ASC');
  });

  it('defaults to symbol ascending, which is what the dashboard showed before sorting existed', () => {
    expect(buildOrderBy(undefined, 'asc')).toBe('s.symbol ASC NULLS LAST, s.symbol ASC');
    expect(buildOrderBy('symbol', 'asc')).toBe('s.symbol ASC NULLS LAST, s.symbol ASC');
  });

  it('keeps rows with no value for the column last in *both* directions', () => {
    // A missing price is not the cheapest price: ascending must not open the table on dashes,
    // and descending must not hide five hundred real rows behind them.
    expect(buildOrderBy('price', 'asc')).toContain('NULLS LAST');
    expect(buildOrderBy('price', 'desc')).toContain('NULLS LAST');
  });

  it('breaks ties on symbol so a page is stable when many rows share a value', () => {
    expect(buildOrderBy('changePercent', 'desc').endsWith(', s.symbol ASC')).toBe(true);
  });

  it('never emits a column that is not on the whitelist', () => {
    const clause = buildOrderBy('volume', 'desc');
    expect(clause).toBe(`${SORTABLE_COLUMNS.volume} DESC NULLS LAST, s.symbol ASC`);
    // Every identifier in the clause is one of those two literals — nothing was interpolated.
    expect(clause.split(/\s+/).filter((t) => t.includes('.'))).toEqual(['p.volume', 's.symbol']);
    expect(STOCK_SORT_FIELDS).toEqual([
      'symbol', 'price', 'week52Low', 'week52High', 'change', 'changePercent', 'volume',
    ]);
  });
});

describe('the stocks list query accepts only sortable columns', () => {
  it('accepts each column the dashboard offers and defaults the direction', () => {
    for (const sort of STOCK_SORT_FIELDS) {
      expect(stocksQuery.parse({ sort }).sort).toBe(sort);
    }
    expect(stocksQuery.parse({ sort: 'price' }).order).toBe('asc');
    expect(stocksQuery.parse({ order: 'desc' }).order).toBe('desc');
    expect(stocksQuery.parse({}).sort).toBeUndefined();
  });

  it('rejects anything else — including SQL — before it can reach the query', () => {
    for (const bad of ['s.symbol; DROP TABLE stocks', 'current_price', 'SYMBOL', '', '1']) {
      expect(stocksQuery.safeParse({ sort: bad }).success).toBe(false);
      expect(stocksQuery.safeParse({ order: bad }).success).toBe(false);
    }
    // And the whitelist itself has no such key, so a builder call could not produce that text.
    expect((SORTABLE_COLUMNS as Record<string, string>)['s.symbol; DROP TABLE stocks']).toBeUndefined();
  });
});
