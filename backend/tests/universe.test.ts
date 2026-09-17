import { parseUniverseSitemap } from '../src/scrapers/universe.scraper';
import { isClosingPassDue, isMarketOpen, resolvePassKind } from '../src/utils/marketHours';
import { median } from '../src/repositories/stockPrice.repository';
import { passLockTtlSeconds } from '../src/utils/universePacing';

describe('parseUniverseSitemap', () => {
  // A real excerpt of https://sarmaaya.pk/sitemap.xml (2026-09-17), trimmed to the parts that
  // matter: security pages, a non-symbol page, and other sections that must not be mistaken
  // for tickers.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://sarmaaya.pk/stocks</loc></url>
<url><loc>https://sarmaaya.pk/stocks/compare</loc></url>
<url><loc>https://sarmaaya.pk/stocks/FFC</loc></url>
<url><loc>https://sarmaaya.pk/stocks/aglNCPS</loc></url>
<url><loc>https://sarmaaya.pk/stocks/786</loc></url>
<url><loc>https://sarmaaya.pk/etf/MZNPETF</loc></url>
<url><loc>https://sarmaaya.pk/etf/ACIETF</loc></url>
<url><loc>https://sarmaaya.pk/stocks/ACIETF</loc></url>
<url><loc>https://sarmaaya.pk/crypto/bitcoin</loc></url>
<url><loc>https://sarmaaya.pk/mutual-funds/abc-fund</loc></url>
<url><loc>https://sarmaaya.pk/sector/fertilizer</loc></url>
</urlset>`;

  it('collects the security pages and nothing else', () => {
    // sorted() is lexicographic: digits before letters, so '786' heads the list.
    expect(parseUniverseSitemap(sitemap)).toEqual(['786', 'ACIETF', 'AGLNCPS', 'FFC', 'MZNPETF']);
  });

  it('drops the non-symbol page and dedupes symbols listed in two sections', () => {
    const symbols = parseUniverseSitemap(sitemap);
    expect(symbols).not.toContain('COMPARE');
    expect(symbols.filter((s) => s === 'ACIETF')).toHaveLength(1);
  });

  it('is empty for a document with no security pages', () => {
    expect(parseUniverseSitemap('<urlset><url><loc>https://sarmaaya.pk/about-us</loc></url></urlset>')).toEqual([]);
  });
});

describe('closing pass window', () => {
  // PKT is UTC+5, so 10:36Z is 15:36 in Karachi.
  const wed = '2026-09-16'; // Wednesday
  const sat = '2026-09-19'; // Saturday

  it('is open during the session and closed just after it', () => {
    expect(isMarketOpen(new Date(`${wed}T05:00:00.000Z`))).toBe(true); // 10:00 PKT
    expect(isMarketOpen(new Date(`${wed}T10:34:00.000Z`))).toBe(true); // 15:34 PKT
    expect(isMarketOpen(new Date(`${wed}T10:36:00.000Z`))).toBe(false); // 15:36 PKT
  });

  it('owes a closing pass after the close on a trading day, and not before it', () => {
    expect(isClosingPassDue(new Date(`${wed}T10:34:00.000Z`))).toBe(false); // still in session
    expect(isClosingPassDue(new Date(`${wed}T10:36:00.000Z`))).toBe(true);
    expect(isClosingPassDue(new Date(`${wed}T18:00:00.000Z`))).toBe(true); // 23:00 PKT
  });

  it('owes no closing pass at the weekend', () => {
    expect(isClosingPassDue(new Date(`${sat}T10:36:00.000Z`))).toBe(false);
  });
});

describe('resolvePassKind — which pass the schedule should run', () => {
  const wed = '2026-09-16';
  const sat = '2026-09-19';

  it('runs an in-hours pass during the session', () => {
    expect(resolvePassKind(new Date(`${wed}T05:00:00.000Z`))).toBe('intraday'); // 10:00 PKT
    expect(resolvePassKind(new Date(`${wed}T10:30:00.000Z`))).toBe('intraday'); // 15:30 PKT
  });

  it('runs the closing pass after the close and the in-hours one no longer applies', () => {
    expect(resolvePassKind(new Date(`${wed}T10:40:00.000Z`))).toBe('close'); // 15:40 PKT
  });

  it('owes nothing pre-open or at the weekend', () => {
    expect(resolvePassKind(new Date(`${wed}T03:00:00.000Z`))).toBeNull(); // 08:00 PKT
    expect(resolvePassKind(new Date(`${sat}T05:00:00.000Z`))).toBeNull();
  });
});

describe('pass lock lifetime', () => {
  it('covers the walk plus slack, so a pass cannot expire mid-flight', () => {
    // 508 symbols at 1.5s pacing = ~13 min of queue time, + 10 min slack.
    expect(passLockTtlSeconds(508, 1500)).toBe(Math.ceil((508 * 1500 + 600_000) / 1000));
    expect(passLockTtlSeconds(0, 1500)).toBe(600);
  });
});

describe('median', () => {
  it('is null until there are at least three readings', () => {
    expect(median([])).toBeNull();
    expect(median([10, 20])).toBeNull();
  });

  it('handles odd and even samples', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});
