import { parseIndices } from '../src/scrapers/psxIndices.scraper';
import { buildIndexSummary, liveReading } from '../src/services/indexSummary';

/**
 * The index parser, exercised against the markup the exchange actually serves — including the
 * carousel repeating a block, which the real page does.
 */
const block = (symbol: string, level: string, change: string, cls: string, pct: string, pctCls = cls) => `
  <div class="item indices-single">
    <div class="col-xs-6"><h3>${symbol}</h3><h4>${level}</h4></div>
    <div class="col-xs-6"><h5 class="${cls}">${change}</h5><h6 class="${pctCls}">(${pct})</h6></div>
  </div>`;

const PAGE = `
  <div class="indices-wrap"><h2><span class="td-hd">Indices</span></h2>
    <div class="indices-slide owl-carousel owl-theme" style="display: none;">
      ${block('KSE100', '171153.16', '268.58', 'up', '0.16%')}
      ${block('BKTI', '47614.71', '-27.39', 'dwn', '-0.06%')}
      ${block('KSE100', '171153.16', '268.58', 'up', '0.16%')}
    </div>
  </div>`;

describe('parseIndices', () => {
  it('reads symbol, level, change and percent off the index carousel', () => {
    expect(parseIndices(PAGE)).toEqual([
      { symbol: 'KSE100', level: 171153.16, change: 268.58, changePercent: 0.16, direction: 'up' },
      { symbol: 'BKTI', level: 47614.71, change: -27.39, changePercent: -0.06, direction: 'down' },
    ]);
  });

  it('deduplicates: the carousel repeats a block and the index must appear once', () => {
    expect(parseIndices(PAGE)).toHaveLength(2);
  });

  it('takes direction from the page class, not from the sign of the number', () => {
    // A red block with a positive reading is still a decline as far as the page is concerned.
    const html = block('X', '100.5', '2.5', 'dwn', '0.5%');
    expect(parseIndices(html)[0]).toMatchObject({ direction: 'down', change: 2.5 });
  });

  it('falls back to the sign when the page gives no class', () => {
    const html = `
      <div class="item indices-single"><h3>NEUTRAL</h3><h4>5000.25</h4><h5>-12.5</h5><h6>(-0.25%)</h6></div>`;
    expect(parseIndices(html)[0]).toMatchObject({ symbol: 'NEUTRAL', change: -12.5, direction: 'down' });
  });

  it('skips a block with no level rather than inventing one', () => {
    const html = block('GOOD', '100', '1', 'up', '1%') + '<div class="item indices-single"><h3>BROKEN</h3><h4></h4></div>';
    expect(parseIndices(html).map((i) => i.symbol)).toEqual(['GOOD']);
  });

  it('reports a missing change as null, never as zero', () => {
    const html = '<div class="item indices-single"><h3>NOPCT</h3><h4>1234.5</h4><h5></h5><h6></h6></div>';
    const [only] = parseIndices(html);
    expect(only).toMatchObject({ symbol: 'NOPCT', level: 1234.5, change: null, changePercent: null, direction: 'flat' });
  });

  it('returns nothing for a page with no index blocks (a parse failure, not an empty market)', () => {
    expect(parseIndices('<html><body><p>no indices here</p></body></html>')).toEqual([]);
  });
});

describe('the index summary', () => {
  const day = new Date('2026-09-21T11:00:00.000Z');
  const today = { tradeDate: day, value: 171153.16, open: null, volume: null };
  const friday = { tradeDate: new Date('2026-09-18T11:00:00.000Z'), value: 168000, open: null, volume: null };

  it('prefers the move the exchange published', () => {
    const s = buildIndexSummary({
      symbol: 'KSE100', name: 'KSE-100 Index', daily: [today],
      live: liveReading(171153.16, new Date('2026-09-21T16:00:00.000Z'), 268.58, 0.16),
    });
    expect(s.change).toBeCloseTo(268.58);
    expect(s.changePercent).toBeCloseTo(0.16);
    // We still do not claim a previous close we do not hold.
    expect(s.previousClose).toBeNull();
  });

  it('derives the move when the exchange reported none', () => {
    const s = buildIndexSummary({
      symbol: 'KSE100', name: 'KSE-100 Index', daily: [today, friday],
      live: liveReading(171153.16, new Date('2026-09-21T16:00:00.000Z')),
    });
    expect(s.change).toBeCloseTo(3153.16, 2);
    expect(s.changePercent).toBeCloseTo(1.8769, 3);
  });

  it('reports an unknown move as null, never as zero', () => {
    const s = buildIndexSummary({ symbol: 'NEWIDX', name: 'New', daily: [today], live: null });
    expect(s.change).toBeNull();
    expect(s.changePercent).toBeNull();
    expect(s.value).toBeCloseTo(171153.16, 2);
  });
});
