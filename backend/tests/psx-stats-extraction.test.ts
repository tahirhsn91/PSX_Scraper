import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The stats panel on dps.psx.com.pk/company/{SYMBOL} was read with a page-wide text search.
 *
 * The candidates included a bare `div`, so the first node whose text merely *contained* a label
 * was an outer container, and its whole concatenated `textContent` was parsed as the value. Every
 * symbol therefore stored the same figures — `high 48401`, `low 7`, `volume -74000`,
 * `marketCap 48401` — for BUXL (676), FFC (540) and NESTLE (7493) alike (issue #21). Market cap
 * was moved to a scoped read when that was fixed; these tests pin the same read for the other
 * four fields, and for the company name's status badge, so the defect cannot come back one field
 * at a time.
 *
 * Asserted against the source because the extractor is serialised into the page by Puppeteer and
 * cannot be imported into a test context — the same approach `market-cap-extraction.test.ts` uses
 * for market cap, and the reason `scraper-serialisation.test.ts` exists.
 */
describe('the PSX stats read is scoped to each labelled item (#21)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'scrapers', 'psx.scraper.ts'), 'utf8');

  it('reads high, low, open and volume from their own stats item', () => {
    for (const field of ['high', 'low', 'open', 'volume']) {
      expect(src).not.toContain(`byLabel('${field}')`);
    }
    expect(src).toContain('high: H.labelledValue(/high/i)');
    expect(src).toContain('low: H.labelledValue(/low/i)');
    expect(src).toContain('open: H.labelledValue(/open/i)');
    expect(src).toContain('volume: H.labelledValue(/volume/i)');
  });

  it('has no page-wide label sweep left anywhere', () => {
    // Not just the five fields: the helper itself is gone, so nothing can start using it again.
    expect(src).not.toContain('byLabel');
    expect(src).not.toContain("'.stats_item, .quote__item, .company__title, td, div'");
    // and the scoped helper really reads the labelled item's own subtree
    expect(src).toContain("document.querySelectorAll('.stats_item')");
    expect(src).toContain("item.querySelector('.stats_label')");
    expect(src).toContain("hit?.querySelector('.stats_value')");
  });

  it('strips PSX’s trailing status badge from the company name', () => {
    // `Engro Corporation LimitedDELISTED` is what the API served and the app displayed.
    expect(src).toContain('Engro Corporation LimitedDELISTED');
    expect(src).toContain('DELISTED|SUSPENDED|DEFAULTED|HALTED');
    expect(src).toContain("company: H.companyName('.quote__name')");
    // a name is never truncated to nothing: the fallback keeps the unstripped text
    expect(src).toContain('return stripped || raw;');
  });

  it('keeps the sector read scoped too, with its existing selector first', () => {
    expect(src).toContain("sector: H.text('.quote__sector') ?? H.labelledValue(/sector/i)");
  });
});
