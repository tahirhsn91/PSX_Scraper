import { actionFactor, adjustSeries, factorAt, type ActionLike } from '../src/services/corporateActions.service';

/**
 * Hand-computed fixtures. Every number below is worked out by hand from the definition
 * ("a price before the ex-date is multiplied by ratioFrom / ratioTo") rather than from the code.
 */

const split: ActionLike = { type: 'SPLIT', exDate: '2025-06-02', ratioFrom: 1, ratioTo: 2, status: 'confirmed' };
const bonus: ActionLike = { type: 'BONUS', exDate: '2025-01-06', ratioFrom: 10, ratioTo: 11, status: 'confirmed' };

const candle = (time: string, close: number) => ({ time, open: close, high: close, low: close, close });

describe('corporate-action factors', () => {
  it('halves prices before a 2-for-1 split and leaves the ex-date alone', () => {
    const out = adjustSeries([candle('2025-06-01', 100), candle('2025-06-02', 51)], [split]);
    expect(out[0]!.close).toBe(50);
    expect(out[1]!.close).toBe(51);
  });

  it('applies a 1-for-10 bonus as 10/11', () => {
    const out = adjustSeries([candle('2025-01-03', 110), candle('2025-01-06', 100)], [bonus]);
    expect(out[0]!.close).toBeCloseTo(100, 10);
    expect(out[1]!.close).toBe(100);
  });

  it('chains two actions multiplicatively for a candle before both', () => {
    // 100 × (1/2) × (10/11) = 45.4545…
    expect(factorAt([split, bonus], '2024-12-31')).toBeCloseTo(5 / 11, 10);
    const out = adjustSeries([candle('2024-12-31', 100)], [split, bonus]);
    expect(out[0]!.close).toBeCloseTo(45.454545, 5);
  });

  it('does not apply an action to a price on or after its ex-date', () => {
    expect(factorAt([split], '2025-06-02')).toBe(1);
    expect(factorAt([split], '2025-06-03')).toBe(1);
  });

  it('never applies a proposed action', () => {
    const proposed = { ...split, status: 'proposed' };
    expect(actionFactor(proposed)).toBeNull();
    expect(factorAt([proposed], '2024-01-01')).toBe(1);
  });

  it('keeps an unknown action type without inventing a factor', () => {
    const rights: ActionLike = { type: 'RIGHTS', exDate: '2025-03-01', ratioFrom: null, ratioTo: null, status: 'confirmed' };
    expect(actionFactor(rights)).toBeNull();
    expect(factorAt([rights], '2025-01-01')).toBe(1);
  });

  it('ignores an action with no ex-date rather than guessing where it belongs', () => {
    const undated: ActionLike = { ...split, exDate: null };
    expect(factorAt([undated], '2024-01-01')).toBe(1);
  });

  it('scales open, high and low with the close', () => {
    const out = adjustSeries([{ time: '2025-06-01', open: 90, high: 105, low: 88, close: 100 }], [split]);
    expect(out[0]).toMatchObject({ open: 45, high: 52.5, low: 44, close: 50 });
  });

  it('returns the same series object when there is nothing to apply', () => {
    const series = [candle('2025-01-01', 10)];
    expect(adjustSeries(series, [])).toBe(series);
  });
});
