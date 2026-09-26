import { derivedIndexVolume } from '../src/services/indexSummary';

/**
 * The rule that decides when a derived index volume may be shown.
 *
 * Index volume has had no reachable publisher since 2026-09-22, so the sum of an index's
 * constituents is the only figure available. It is a *sum*, not the exchange's arithmetic, so it
 * equals PSX's own number only where the membership is complete and every member reported that day
 * — and where it does not, the card must keep its dash rather than show a number that quietly means
 * something else. Every figure below is a real one measured on 22 Sep 2026, the last day PSX
 * published index volumes and therefore the last day this rule can be checked against.
 */
describe('derivedIndexVolume', () => {
  it('returns the constituents sum where it is exactly the published figure', () => {
    // KMI30 and KSE30: derived and published agree to the rupee.
    expect(derivedIndexVolume(69_199_731n, 69_199_731n, 69_199_731n)).toBe(69_199_731);
    expect(derivedIndexVolume(52_615_357n, 52_615_357n, 52_615_357n)).toBe(52_615_357);
  });

  it('refuses a sum that falls short of what the exchange published', () => {
    // KSE100 that day: 94,179,871 derived against 123,439,837 published, because three members
    // (ABOT, CNERGY, DCR) had a price and no volume. JSMFI is 38% short for the same reason.
    expect(derivedIndexVolume(94_179_871n, 123_439_837n, 94_179_871n)).toBeNull();
    expect(derivedIndexVolume(48_082_691n, 77_116_831n, 48_082_691n)).toBeNull();
  });

  it('says nothing when there is no published day to check against', () => {
    // An index we have never seen a published volume for has no way to prove its sum: stay null.
    expect(derivedIndexVolume(1_000_000n, null, null)).toBeNull();
    expect(derivedIndexVolume(1_000_000n, null, 1_000_000n)).toBeNull();
  });

  it('says nothing when the members contributed no volume at all', () => {
    expect(derivedIndexVolume(null, 69_199_731n, 69_199_731n)).toBeNull();
    expect(derivedIndexVolume(undefined, undefined, undefined)).toBeNull();
  });
});
