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
});
