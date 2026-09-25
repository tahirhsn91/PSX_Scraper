import { readFileSync } from 'fs';
import { join } from 'path';
import { toMarketCapRupees, toNumber } from '../src/scrapers/parse.utils';

/**
 * Market cap has three ways to be wrong, and this file pins all three so it cannot go quiet
 * again (issue #71).
 *
 *   1. It was read from a page-wide sweep, so every symbol stored the SAME number
 *      (48,945.08 on 2026-09-22 for DFSM, AGIL, 786, AABS, ABOT … — a whole-page figure).
 *   2. PSX publishes the figure as `Market Cap (000's)` — thousands — and nothing scaled it,
 *      so even a correct read was 1000x small.
 *   3. The orchestrator merged the price block wholesale, so the losing provider's market cap
 *      was discarded on every run where the other provider's block won.
 */
describe('market cap, in rupees', () => {
  it('multiplies a thousands-scaled read by 1000', () => {
    // PSX's label is `Market Cap (000's)`: 1,234,567 thousands is 1.234567 trillion rupees.
    expect(toMarketCapRupees('1,234,567')).toBe(1_234_567_000);
    expect(toMarketCapRupees('745000')).toBe(745_000_000);
  });

  it('reads a published band like "Rs. 1,234.50 (000\'s)" without inventing digits', () => {
    expect(toMarketCapRupees("Rs. 1,234.50 (000's)")).toBe(1_234_500);
  });

  it('treats a missing or placeholder read as no value, never as zero', () => {
    expect(toMarketCapRupees(null)).toBeNull();
    expect(toMarketCapRupees(undefined)).toBeNull();
    expect(toMarketCapRupees('')).toBeNull();
    expect(toMarketCapRupees('—')).toBeNull();
    expect(toMarketCapRupees('0')).toBeNull();
    expect(toMarketCapRupees('0.0')).toBeNull();
    expect(toMarketCapRupees('-5')).toBeNull();
  });

  it('stays in step with toNumber for the digits it does read', () => {
    expect(toMarketCapRupees('98,765')).toBe(toNumber('98,765')! * 1000);
  });
});

describe('the market-cap read is scoped, and merged field-by-field', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('reads the labelled stats item, not a page-wide sweep', () => {
    const psx = read('src/scrapers/psx.scraper.ts');
    // The defect: byLabel() matches the first node whose text merely *contains* the label, so a
    // container's concatenated text was parsed as the symbol's market cap.
    expect(psx).not.toContain("byLabel('market cap')");
    expect(psx).toContain('labelledValue(/market cap/i)');
    // and the scoped helper really is scoped to the labelled item's own subtree
    expect(psx).toContain("document.querySelectorAll('.stats_item')");
    expect(psx).toContain("item.querySelector('.stats_label')");
  });

  it('scales the thousands label on the way in', () => {
    const psx = read('src/scrapers/psx.scraper.ts');
    expect(psx).toContain('marketCap: toMarketCapRupees(data.marketCap)');
    expect(psx).not.toContain('marketCap: toNumber(data.marketCap)');
  });

  it('merges marketCap field-by-field, so one provider blanking it cannot erase the other', () => {
    const orch = read('src/scrapers/orchestrator.ts');
    expect(orch).toContain('marketCap: pick(psx?.price?.marketCap, sarmaaya?.price?.marketCap)');
  });
});
