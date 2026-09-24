import { indexMembersUrl, parseIndexMembers } from '../src/scrapers/sarmaayaIndexMembers.scraper';

/**
 * The ticker endpoint's member list is what fills a non-KSE100 index on the dashboard's filter, so
 * the rules pinned here are the ones that decide whether an index shows the right companies:
 *
 *  - a row is a constituent only if it has a symbol — everything else about it is optional;
 *  - the source publishes **no company name**, so a constituent's name is null and never invented
 *    from the symbol (or borrowed from a sibling source, which would be an unverifiable claim);
 *  - a payload that is not this shape is *refused*, because this list feeds a replace: a parser
 *    that quietly returned [] would wipe the index's members while logging a successful pass.
 *
 * The rows below are the real ones from `?index=KMI30`.
 */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  symbol: 'AIRLINK',
  volume: 150518,
  isShariah: true,
  changePercentage: -1.27,
  change: -1.62,
  price: 126.23,
  date: '2026-09-24T00:00:00.000Z',
  ...over,
});

const payload = (rows: unknown[]): unknown => ({ success: true, message: 'Success', response: rows });

describe('parseIndexMembers', () => {
  it('maps the published rows to constituents, in the source order, with no name invented', () => {
    const constituents = parseIndexMembers(
      payload([row(), row({ symbol: 'OGDC', price: 317.49 }), row({ symbol: 'PPL' })]),
    );

    expect(constituents).toEqual([
      { symbol: 'AIRLINK', name: null },
      { symbol: 'OGDC', name: null },
      { symbol: 'PPL', name: null },
    ]);
  });

  it('keeps only the symbol — a quote column never leaks into a constituent', () => {
    const [only] = parseIndexMembers(payload([row({ symbol: 'HBL', companyName: 'Habib Bank' })]));

    // The endpoint carries no company name; a payload that grows one must not silently become a
    // stored name we cannot attribute.
    expect(only).toEqual({ symbol: 'HBL', name: null });
  });

  it('upper-cases the symbol and de-duplicates it, keeping the first', () => {
    const constituents = parseIndexMembers(payload([row({ symbol: ' ogdc ' }), row({ symbol: 'OGDC' })]));

    expect(constituents).toEqual([{ symbol: 'OGDC', name: null }]);
  });

  it('drops a row with no usable symbol instead of guessing one, and keeps the rest', () => {
    for (const absent of [undefined, null, '', '   ', 42]) {
      const constituents = parseIndexMembers(payload([row({ symbol: absent }), row({ symbol: 'FFC' })]));
      expect(constituents).toEqual([{ symbol: 'FFC', name: null }]);
    }
    expect(parseIndexMembers(payload(['not-a-row', { price: 10 }]))).toEqual([]);
  });

  it('refuses a payload that is not this shape rather than reporting an empty index', () => {
    // An empty list here would replace the index's whole member set with nothing, so the parser
    // has to fail instead — the pass then leaves yesterday's membership in place.
    for (const bad of [null, undefined, 'nope', {}, { success: false, response: [row()] }, { response: [row()] }]) {
      expect(() => parseIndexMembers(bad)).toThrow(/sarmaaya-index-members/);
    }
    expect(() => parseIndexMembers({ success: true, response: 'not-an-array' })).toThrow(
      /sarmaaya-index-members/,
    );
  });
});

describe('indexMembersUrl', () => {
  it('asks for the index it was given, upper-cased', () => {
    expect(indexMembersUrl('KMI30')).toBe(
      'https://beta-restapi.sarmaaya.pk/api/stocks/ticker?index=KMI30',
    );
    expect(indexMembersUrl(' kmi30 ')).toContain('index=KMI30');
  });
});
