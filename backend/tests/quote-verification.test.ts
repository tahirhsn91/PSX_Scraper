import {
  acceptedValues,
  unwrittenVerdicts,
  verifyQuote,
  type ScrapedQuote,
  type VerificationContext,
} from '../src/services/quoteVerification.service';

const NOW = new Date('2026-09-17T14:00:00.000Z'); // 19:00 PKT, Thursday

const quote = (over: Partial<ScrapedQuote> = {}): ScrapedQuote => ({
  symbol: 'FFC',
  price: 531.01,
  change: -0.74,
  changePercent: -0.14,
  volume: 494913,
  week52Low: 441.7,
  week52High: 685,
  sessionDate: '2026-09-17T11:00:00.000Z', // this session's marker
  ...over,
});

const ctx = (over: Partial<VerificationContext> = {}): VerificationContext => ({
  previousClose: 531.75, // -0.14% from 531.01
  volumeMedian: 500_000,
  maxVolumeMultiple: 100,
  maxQuoteAgeDays: 4,
  now: NOW,
  ...over,
});

describe('verifyQuote', () => {
  it('accepts a clean quote and writes every field', () => {
    const v = verifyQuote(quote(), ctx());

    expect(v.listed).toBe(true);
    expect(v.verdicts.every((x) => x.status === 'ok')).toBe(true);
    expect(acceptedValues(v)).toEqual({
      price: 531.01,
      change: -0.74,
      changePercent: -0.14,
      volume: 494913,
      week52Low: 441.7,
      week52High: 685,
    });
  });

  it('does not treat a delisted symbol as a listing (the ENGRO case)', () => {
    // A page that outlived the listing still renders its last quote, months old.
    const v = verifyQuote(quote({ sessionDate: '2025-02-25T11:00:00.000Z' }), ctx());

    expect(v.listed).toBe(false);
    expect(v.notListedReason).toMatch(/quote is \d+ days old/);
  });

  it('refuses a quote with no timestamp at all', () => {
    const v = verifyQuote(quote({ sessionDate: null }), ctx());
    expect(v.listed).toBe(false);
    expect(v.notListedReason).toMatch(/no quote timestamp/);
  });

  it.each([0, -1, null, Number.NaN])('refuses when the price is %p', (price) => {
    const v = verifyQuote(quote({ price }), ctx());
    expect(v.listed).toBe(false);
    expect(v.notListedReason).toMatch(/price not usable/);
  });

  it('accepts 0 volume, because a session with no trades is a reading', () => {
    const v = verifyQuote(quote({ volume: 0 }), ctx());
    expect(v.listed).toBe(true);
    expect(acceptedValues(v).volume).toBe(0);
  });

  it('rejects an absurd volume but keeps the rest of the reading', () => {
    // 100x the symbol's own median: what a concatenated or truncated number looks like.
    const v = verifyQuote(quote({ volume: 500_000 * 101 }), ctx());

    const volume = v.verdicts.find((x) => x.field === 'volume')!;
    expect(volume.status).toBe('rejected');
    expect(volume.value).toBeNull();
    expect(volume.rawValue).toBe(50_500_000);
    expect(volume.reason).toMatch(/recent\s+median/);
    expect(acceptedValues(v).price).toBe(531.01); // price survives
  });

  it('rejects a change% that disagrees with the previous close', () => {
    const v = verifyQuote(quote({ changePercent: 9.5 }), ctx({ previousClose: 531.75 }));

    for (const field of ['changePercent', 'change']) {
      const verdict = v.verdicts.find((x) => x.field === field)!;
      expect(verdict.status).toBe('rejected');
      expect(verdict.value).toBeNull();
    }
    expect(v.verdicts.find((x) => x.field === 'changePercent')!.reason).toMatch(/implied by\s+previous close/);
    expect(acceptedValues(v).price).toBe(531.01);
  });

  it('tolerates a small basis difference in change% (the source disagrees with itself)', () => {
    // 531.01 against a stored previous close of 531.75 implies -0.14%; the source's own reading
    // for the same session can sit a point away, and that is not evidence of a bad value.
    const v = verifyQuote(quote({ changePercent: -1.1 }), ctx({ previousClose: 531.75 }));
    expect(v.verdicts.find((x) => x.field === 'changePercent')!.status).toBe('ok');
  });

  it('takes change% as-is when there is no previous close to check it against', () => {
    const v = verifyQuote(quote({ changePercent: 9.5 }), ctx({ previousClose: null }));
    expect(v.verdicts.find((x) => x.field === 'changePercent')!.status).toBe('ok');
  });

  it('drops the 52-week pair when the price sits outside it, and keeps the price', () => {
    const v = verifyQuote(quote({ price: 900 }), ctx({ previousClose: 531.75 }));

    for (const field of ['week52Low', 'week52High']) {
      const verdict = v.verdicts.find((x) => x.field === field)!;
      expect(verdict.status).toBe('rejected');
      expect(verdict.reason).toMatch(/outside 52W range/);
    }
    expect(acceptedValues(v).price).toBe(900);
  });

  it('treats a missing 52-week block as absent, not as a failure', () => {
    const v = verifyQuote(quote({ week52Low: null, week52High: null }), ctx());
    const statuses = v.verdicts.filter((x) => x.field.startsWith('week52')).map((x) => x.status);

    expect(statuses).toEqual(['absent', 'absent']);
    expect(unwrittenVerdicts(v).every((x) => x.status !== 'rejected')).toBe(true);
  });

  it('checks the range as a pair: a low above the high is not usable', () => {
    const v = verifyQuote(quote({ week52Low: 700, week52High: 441.7 }), ctx());
    expect(unwrittenVerdicts(v).filter((x) => x.field.startsWith('week52')).every((x) => x.status === 'absent')).toBe(true);
  });
});
