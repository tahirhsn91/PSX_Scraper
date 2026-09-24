import { buildListFilter, DASHBOARD_GROUP_INDEX } from '../src/repositories/stock.repository';
import { stocksQuery } from '../src/validators/schemas';

/**
 * The `index=` filter reaches SQL as a raw fragment, so two things are worth pinning: that the
 * named index travels as a **bound parameter** (never assembled into the query text), and that the
 * dashboard's own `group` path still asks for the KSE-100 — generalising the filter must not move
 * page one to another index.
 *
 * `filter.values` is what Prisma binds; `filter.strings` is the SQL text. A symbol appearing in the
 * text but not in the values would mean it had been interpolated.
 */
const sql = (filter: ReturnType<typeof buildListFilter>): string => filter.strings.join('');

describe('buildListFilter', () => {
  it('filters on the index the caller named, as a bound parameter', () => {
    const filter = buildListFilter(undefined, 'KMI30');

    expect(filter.values).toEqual(['KMI30']);
    expect(sql(filter)).toContain('index_constituents');
    expect(sql(filter)).toContain('market_indices');
    // Bound, not interpolated: the symbol is not in the query text at all.
    expect(sql(filter)).not.toContain('KMI30');
  });

  it('keeps the dashboard group path on the KSE-100 member list', () => {
    const members = buildListFilter('kse100');
    const rest = buildListFilter('rest');

    expect(members.values).toEqual([DASHBOARD_GROUP_INDEX]);
    expect(rest.values).toEqual([DASHBOARD_GROUP_INDEX]);
    expect(sql(members)).not.toContain('NOT');
    expect(sql(rest)).toContain('NOT');
  });

  it('lets the named index win over the group, so the two are never intersected', () => {
    const filter = buildListFilter('rest', 'KMI30');

    // A caller that named an index is not asking for "the rest of the universe": intersecting the
    // two would answer an empty page for every index but the KSE-100.
    expect(filter.values).toEqual(['KMI30']);
    expect(sql(filter)).not.toContain('NOT');
    expect(filter.values).not.toContain(DASHBOARD_GROUP_INDEX);
  });

  it('asks for no filter at all when neither is given', () => {
    const filter = buildListFilter();

    expect(filter.values).toEqual([]);
    expect(sql(filter)).toBe('');
  });
});

describe('the stocks list query accepts an index symbol', () => {
  it('upper-cases and trims the symbol, so casing cannot miss an index', () => {
    expect(stocksQuery.parse({ index: 'kmi30' }).index).toBe('KMI30');
    expect(stocksQuery.parse({ index: ' kmi30 ' }).index).toBe('KMI30');
    expect(stocksQuery.parse({}).index).toBeUndefined();
    // The filter coexists with the group and the sort, and defaults are untouched.
    expect(stocksQuery.parse({ index: 'ALLSHR', group: 'rest' })).toMatchObject({
      index: 'ALLSHR',
      group: 'rest',
      page: 1,
      limit: 20,
    });
  });

  it('rejects a value that is not a symbol, before it can reach the query', () => {
    for (const bad of ['BAD-INDEX', '', '   ', 'KMI 30', 'TOOLONGLONGSYMBOL', 'KMI30;DROP TABLE stocks']) {
      expect(stocksQuery.safeParse({ index: bad }).success).toBe(false);
    }
  });
});
