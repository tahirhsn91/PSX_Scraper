import { RETURN_SESSIONS, hasReturnRequest } from '../src/repositories/stock.repository';

describe('period returns', () => {
  it('measures in sessions, not calendar days', () => {
    // A month of trading is 21 sessions — a calendar month can contain 19 to 23, and a fixed
    // calendar window would silently change what "1M" means from month to month.
    expect(RETURN_SESSIONS['1w']).toBe(5);
    expect(RETURN_SESSIONS['1m']).toBe(21);
    expect(RETURN_SESSIONS['3m']).toBe(63);
    expect(RETURN_SESSIONS['6m']).toBe(126);
    expect(RETURN_SESSIONS['1y']).toBe(252);
  });

  it('asks for the return lateral only when a return is actually used', () => {
    expect(hasReturnRequest(undefined, undefined)).toBe(false);
    expect(hasReturnRequest({ sector: 'BANKS' }, 'price')).toBe(false);
    expect(hasReturnRequest({ returnPeriod: '1m' }, undefined)).toBe(true);
    expect(hasReturnRequest({ minReturn: 10 }, undefined)).toBe(true);
    expect(hasReturnRequest(undefined, 'return')).toBe(true);
  });

  it('treats a zero bound as a filter, not as absent', () => {
    // `0` is a real threshold ("at least flat"); a truthiness check would drop it.
    expect(hasReturnRequest({ minReturn: 0 }, undefined)).toBe(true);
    expect(hasReturnRequest({ maxReturn: 0 }, undefined)).toBe(true);
  });
});
