import { symbolSchema, addStockBody } from '../src/validators/schemas';

describe('validators', () => {
  it('uppercases and accepts valid symbols', () => {
    expect(symbolSchema.parse('ffc')).toBe('FFC');
  });
  it('rejects non-alphanumeric symbols', () => {
    expect(() => symbolSchema.parse('FF-C')).toThrow();
    expect(() => symbolSchema.parse('')).toThrow();
  });
  it('validates add-stock body', () => {
    expect(addStockBody.parse({ symbol: 'ogdc' })).toEqual({ symbol: 'OGDC' });
    expect(() => addStockBody.parse({})).toThrow();
  });
  it('accepts force only as a boolean', () => {
    // `force` is the human override for a remembered removal — a string "true" must not slip through
    // as a truthy value and quietly override a deletion.
    expect(addStockBody.parse({ symbol: 'ogdc', force: true })).toEqual({ symbol: 'OGDC', force: true });
    expect(() => addStockBody.parse({ symbol: 'OGDC', force: 'true' })).toThrow();
  });
});
