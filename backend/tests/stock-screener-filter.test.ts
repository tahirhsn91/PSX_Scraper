import { buildWhereClause, hasRatioFilters } from '../src/repositories/stock.repository';

/** Collapse a Prisma.Sql fragment to its text so a test can assert on the SQL it produced. */
const text = (f: ReturnType<typeof buildWhereClause>): string => f.strings.join('');

describe('buildWhereClause (screener + membership composition)', () => {
  it('answers empty when there is nothing to filter on', () => {
    expect(text(buildWhereClause())).toBe('');
    expect(text(buildWhereClause(undefined, undefined, {}))).toBe('');
  });

  it('keeps membership filters working exactly as before', () => {
    expect(text(buildWhereClause('kse100'))).toContain('WHERE');
    expect(text(buildWhereClause('kse100'))).toContain('index_constituents');
    expect(text(buildWhereClause(undefined, 'KMI30'))).toContain('WHERE');
  });

  it('binds a sector criterion as a parameter, never interpolates it', () => {
    const where = buildWhereClause(undefined, undefined, { sector: 'BANKS' });
    expect(text(where)).toContain('s.sector =');
    expect(where.values).toEqual(['BANKS']);
    expect(text(where)).not.toContain('BANKS');
  });

  it('composes price and ratio criteria with AND, each on its own table alias', () => {
    const where = buildWhereClause(undefined, undefined, {
      minPe: 5,
      minDividendYield: 3,
      minMarketCap: 1_000_000_000,
    });
    const t = text(where);
    expect(t).toContain('r.pe_ratio >=');
    expect(t).toContain('r.dividend_yield >=');
    expect(t).toContain('p.market_cap >=');
    expect(t).toContain('AND');
  });

  it('keeps a hostile sector out of the text (it is a bound value)', () => {
    const hostile = "BANKS' OR '1'='1";
    const where = buildWhereClause(undefined, undefined, { sector: hostile });
    expect(text(where)).not.toContain(hostile);
    expect(where.values).toEqual([hostile]);
  });
});

describe('hasRatioFilters', () => {
  it('is true only when a ratio criterion is present', () => {
    expect(hasRatioFilters({ minPe: 5 })).toBe(true);
    expect(hasRatioFilters({ maxPe: 20 })).toBe(true);
    expect(hasRatioFilters({ minDividendYield: 3 })).toBe(true);
    expect(hasRatioFilters({ minRoe: 10 })).toBe(true);
    expect(hasRatioFilters({ maxDebtToEquity: 50 })).toBe(true);
    expect(hasRatioFilters({ minPb: 1 })).toBe(true);
  });

  it('is false for price, sector and empty filters', () => {
    expect(hasRatioFilters({ minPrice: 5 })).toBe(false);
    expect(hasRatioFilters({ minMarketCap: 1 })).toBe(false);
    expect(hasRatioFilters({ sector: 'BANKS' })).toBe(false);
    expect(hasRatioFilters({})).toBe(false);
    expect(hasRatioFilters(undefined)).toBe(false);
  });
});
