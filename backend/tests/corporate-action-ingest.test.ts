import {
  exDateFor,
  parseActionCell,
  parseAnnouncementTable,
  parseClosure,
  parseDdMmYyyy,
} from '../src/scrapers/psxCorporateActions.scraper';
import {
  aggregate,
  buildSymbolIndex,
  resolveSymbol,
} from '../src/services/corporateActionIngest.service';
import type { CorporateActionAnnouncement } from '../src/scrapers/psxCorporateActions.scraper';

/**
 * The register's markup, as captured. Every expectation below is worked out by hand from the
 * published page rather than from the parser: the ex-date is the second trading day before the
 * closure starts, and a p% bonus is `100 : 100 + p`.
 */

const row = (company: string, action: string, closure: string, period = '30/09/2026(IIIQ)') =>
  `<tr><td>${company}</td><td>16:01:32</td><td>${period}</td><td>${action}</td>` +
  `<td>-</td><td>-</td><td>-</td><td>-</td><td>${closure}</td></tr>`;

const page = `<table><thead><tr><td>Company</td><td>Time</td><td>Year ended</td><td>Dividend / Bonus / Right </td>` +
  `<td>Profit</td><td>Profit</td><td>EPS</td><td>AGM</td><td>Closure Of Share Transfer Books </td></tr></thead><tbody>` +
  row('Fauji Fertilizer Company Limited', '185%(iii) (D)', '09/11/2026 - 11/11/2026') +
  row('Bank AL Habib Limited', '50% (B) - 30%(i) (D)', '10/11/2026 - 12/11/2026') +
  row('Shell Pakistan Limited', '100% AT A DISCOUNT OF RS. 5/= PER SHARES (R)', '05/11/2026 - 05/11/2026') +
  row('Haleon Pakistan Limited', '-', '-') +
  row('Mughal Energy Limited(GEM)', '15%(i) (D)', '06/11/2026 - 10/11/2026') +
  `</tbody></table>`;

describe('corporate-action register parser', () => {
  it('reads the three action markers', () => {
    expect(parseActionCell('185%(iii) (D)')).toEqual([
      { type: 'CASH_DIVIDEND', percent: 185, ratioFrom: null, ratioTo: null },
    ]);
    expect(parseActionCell('10% (B)')).toEqual([
      { type: 'BONUS', percent: 10, ratioFrom: 100, ratioTo: 110 },
    ]);
    expect(parseActionCell('100% AT A DISCOUNT OF RS. 5/= PER SHARES (R)')).toEqual([
      { type: 'RIGHTS', percent: 100, ratioFrom: null, ratioTo: null },
    ]);
  });

  it('splits a cell that carries two actions', () => {
    expect(parseActionCell('50% (B) - 30%(i) (D)')).toEqual([
      { type: 'BONUS', percent: 50, ratioFrom: 100, ratioTo: 150 },
      { type: 'CASH_DIVIDEND', percent: 30, ratioFrom: null, ratioTo: null },
    ]);
  });

  it('turns nothing into nothing', () => {
    expect(parseActionCell('-')).toEqual([]);
    expect(parseActionCell('')).toEqual([]);
    expect(parseActionCell('20%')).toEqual([]); // no marker: never guessed
  });

  it('reads a closure range and a single-day closure', () => {
    expect(parseClosure('10/11/2026 - 12/11/2026')).toEqual({ start: '2026-11-10', end: '2026-11-12' });
    expect(parseClosure('05/11/2026 - 05/11/2026')).toEqual({ start: '2026-11-05', end: '2026-11-05' });
    expect(parseClosure('-')).toBeNull();
  });

  it('rejects a date that does not exist', () => {
    expect(parseDdMmYyyy('31/02/2026')).toBeNull();
    expect(parseDdMmYyyy('10/11/2026')).toBe('2026-11-10');
  });

  it('puts the ex-date two trading days before the closure, skipping weekends and holidays', () => {
    // 9 Nov 2026 is a Monday: the two trading days before it are Friday 6th and Thursday 5th.
    expect(exDateFor('2026-11-09')).toBe('2026-11-05');
    // With the 5th published as a holiday, the count walks past it to the 4th.
    expect(exDateFor('2026-11-09', new Set(['2026-11-05']))).toBe('2026-11-04');
  });

  it('parses the page into actions and skips rows with nothing to report', () => {
    const parsed = parseAnnouncementTable(page);
    expect(parsed).toHaveLength(4);
    expect(parsed.map((a) => a.company)).not.toContain('Haleon Pakistan Limited');
    const ffc = parsed.find((a) => a.company.startsWith('Fauji'))!;
    expect(ffc.actions).toEqual([{ type: 'CASH_DIVIDEND', percent: 185, ratioFrom: null, ratioTo: null }]);
    expect(ffc.exDate).toBe('2026-11-05'); // closure starts Monday 9 Nov
    expect(ffc.closureEnd).toBe('2026-11-11');
    const gem = parsed.find((a) => a.ticker === 'GEM')!;
    expect(gem.ticker).toBe('GEM');
  });
});

describe('company-name resolution', () => {
  const stocks = [
    { id: 'id-ffc', symbol: 'FFC', companyName: 'Fauji Fertilizer Company Limited' },
    { id: 'id-hbl', symbol: 'HBL', companyName: 'Habib Bank Limited' },
    { id: 'id-bahl', symbol: 'BAHL', companyName: 'Bank AL Habib Limited' },
    { id: 'id-set', symbol: 'SETL', companyName: 'Settlement Company Limited' },
    { id: 'id-set2', symbol: 'SETX', companyName: 'Settlement Company Limited' },
  ];
  const index = buildSymbolIndex(stocks);

  it('prefers the ticker printed in the row', () => {
    expect(resolveSymbol(index, 'Mughal Energy Limited(GEM)', 'GEM')).toBeNull(); // GEM is not tracked
    expect(resolveSymbol(index, 'Fauji Fertilizer Company Limited(FFC)', 'FFC')).toBe('id-ffc');
  });

  it('falls back to the exact company name, then to the legal-form-stripped name', () => {
    expect(resolveSymbol(index, 'Fauji Fertilizer Company Limited', null)).toBe('id-ffc');
    expect(resolveSymbol(index, 'Habib Bank Ltd.', null)).toBe('id-hbl');
  });

  it('refuses a name two tracked stocks share', () => {
    expect(resolveSymbol(index, 'Settlement Company Limited', null)).toBeNull();
  });
});

describe('aggregation', () => {
  const announcement = (actions: CorporateActionAnnouncement['actions'], exDate = '2026-11-05'): CorporateActionAnnouncement => ({
    company: 'Fauji Fertilizer Company Limited',
    ticker: null,
    rawAction: '',
    actions,
    closureStart: '2026-11-09',
    closureEnd: '2026-11-11',
    exDate,
    period: '30/09/2026(IIIQ)',
  });

  it('sums two announcements that land on the same ex-date', () => {
    const rows = aggregate([
      { stockId: 's1', announcement: announcement([{ type: 'CASH_DIVIDEND', percent: 20, ratioFrom: null, ratioTo: null }]) },
      { stockId: 's1', announcement: announcement([{ type: 'CASH_DIVIDEND', percent: 20, ratioFrom: null, ratioTo: null }]) },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.percent).toBe(40);
  });

  it('recomputes the bonus ratio from the summed percentage', () => {
    const rows = aggregate([
      { stockId: 's1', announcement: announcement([{ type: 'BONUS', percent: 10, ratioFrom: 100, ratioTo: 110 }]) },
      { stockId: 's1', announcement: announcement([{ type: 'BONUS', percent: 10, ratioFrom: 100, ratioTo: 110 }]) },
    ]);
    expect(rows[0]!.ratioTo).toBe(120);
  });

  it('keeps different types on the same day apart', () => {
    const rows = aggregate([
      {
        stockId: 's1',
        announcement: announcement([
          { type: 'BONUS', percent: 50, ratioFrom: 100, ratioTo: 150 },
          { type: 'CASH_DIVIDEND', percent: 30, ratioFrom: null, ratioTo: null },
        ]),
      },
    ]);
    expect(rows.map((r) => r.type).sort()).toEqual(['BONUS', 'CASH_DIVIDEND']);
  });
});
