import { parseKse100 } from '../src/scrapers/scstradeKse100.scraper';

/**
 * The KSE-100 membership comes off an ASP.NET page method, so its payload has two layers: the
 * transport wraps the body in `{d: "<json>"}`, and the body holds the rows under `dt`. Both are
 * pinned here — a parser that only handled one of them would report an empty index instead of
 * failing, which is the failure mode that silently empties a page of the dashboard.
 *
 * The rows are the real ones from the page, including the trailing padding the source prints in
 * `Name` ("Abbott Laboratories (Pak) Ltd.       ").
 */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  Symbol: 'ABL',
  Name: 'Allied Bank Ltd.',
  Price: 170.06,
  EPS_Annual: 30.72,
  EPS_Latest: '13.72 6M',
  'P_/_E': 5.54,
  'Expected_P_/_E': 6.2,
  Price_to_BV: 0.76,
  ROE: 13.36,
  ROA: 1.04,
  Dividend_Yield: 9.41,
  Avg_52_Weeks_Vol: '129521.448000',
  ...over,
});

/** The transport shape the page itself uses: the body as a string inside `d`. */
const wrapped = (rows: unknown[]): unknown => ({ d: JSON.stringify({ dt: rows }) });

describe('parseKse100', () => {
  it('unwraps the double-encoded body and maps the rows to constituents', () => {
    const constituents = parseKse100(
      wrapped([row(), row({ Symbol: 'ABOT', Name: 'Abbott Laboratories (Pak) Ltd.       ' })]),
    );

    expect(constituents).toEqual([
      { symbol: 'ABL', name: 'Allied Bank Ltd.' },
      // The source pads the name; a padded name in a table cell reads as a gap.
      { symbol: 'ABOT', name: 'Abbott Laboratories (Pak) Ltd.' },
    ]);
  });

  it('accepts an already-decoded body as well, so a caller cannot get the layers wrong', () => {
    const constituents = parseKse100({ dt: [row()] });

    expect(constituents).toEqual([{ symbol: 'ABL', name: 'Allied Bank Ltd.' }]);
  });

  it('upper-cases the symbol and de-duplicates it, keeping the first', () => {
    const constituents = parseKse100(wrapped([row({ Symbol: ' abl ' }), row({ Symbol: 'ABL' })]));

    expect(constituents).toEqual([{ symbol: 'ABL', name: 'Allied Bank Ltd.' }]);
  });

  it('drops a row with no symbol instead of guessing one, and keeps the rest', () => {
    const constituents = parseKse100(
      wrapped([
        row({ Symbol: '   ' }),
        row({ Symbol: null }),
        'not-a-row',
        row({ Symbol: 'FFC', Name: null }),
      ]),
    );

    // A missing name is stored as absent — never as the symbol, never as an empty string.
    expect(constituents).toEqual([{ symbol: 'FFC', name: null }]);
  });

  it('refuses a payload that is not this shape rather than reporting an empty index', () => {
    expect(() => parseKse100({ d: 'not json' })).toThrow(/scstrade-kse100/);
    expect(() => parseKse100({ d: JSON.stringify({ rows: [] }) })).toThrow(/scstrade-kse100/);
    expect(() => parseKse100({})).toThrow(/scstrade-kse100/);
  });
});
