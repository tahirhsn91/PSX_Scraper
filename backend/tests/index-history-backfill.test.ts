import { parseIndexHistory, planIndexInserts, storedDay } from '../src/services/indexHistoryBackfill.service';
import { sessionStampFor } from '../src/services/candleBackfill.service';

const wrap = (rows: unknown[]) => ({ success: true, message: 'Success', response: rows });
const at = (d: string) => `${d}T00:00:00.000Z`;

describe('parseIndexHistory', () => {
  it('joins the price and volume series into one point per session, oldest first', () => {
    const prices = wrap([
      { symbol: 'KSE100', price: 171153.17, date: at('2026-09-21') },
      { symbol: 'KSE100', price: 169392.32, date: at('2026-09-18') },
      { symbol: 'KSE100', price: 10669.88, date: at('2010-04-19') },
    ]);
    const volumes = wrap([
      { symbol: 'KSE100', volume: 162516073, date: at('2026-09-21') },
      { symbol: 'KSE100', volume: 900, date: at('2010-04-19') },
    ]);
    expect(parseIndexHistory(prices, volumes)).toEqual([
      { date: '2010-04-19', value: 10669.88, volume: 900 },
      { date: '2026-09-18', value: 169392.32, volume: null },
      { date: '2026-09-21', value: 171153.17, volume: 162516073 },
    ]);
  });

  it('drops a point with no usable price rather than fabricating a bar', () => {
    const out = parseIndexHistory(
      wrap([
        { price: null, date: at('2026-09-21') },
        { price: 'not a number', date: at('2026-09-20') },
        { price: 169392.32, date: at('2026-09-18') },
        { date: at('2026-09-17') },
      ]),
      wrap([]),
    );
    expect(out.map((p) => p.date)).toEqual(['2026-09-18']);
  });

  it('never coerces an absent price into a level of zero', () => {
    // Number(null) is 0, so a null price is the trap this guards: it must be dropped, not stored.
    for (const absent of [null, undefined, '']) {
      const out = parseIndexHistory(wrap([{ price: absent, date: at('2026-09-21') }, { price: 5, date: at('2026-09-20') }]), wrap([]));
      expect(out.map((p) => p.date)).toEqual(['2026-09-20']);
      expect(out.every((p) => p.value !== 0)).toBe(true);
    }
  });

  it('keeps one point per date, first reading winning', () => {
    const out = parseIndexHistory(wrap([{ price: 100, date: at('2026-09-21') }, { price: 999, date: at('2026-09-21') }]), wrap([]));
    expect(out).toEqual([{ date: '2026-09-21', value: 100, volume: null }]);
  });

  it('yields nothing for a payload that is not the documented envelope', () => {
    for (const bad of [null, undefined, 'nope', { response: 'not an array' }, []]) {
      expect(parseIndexHistory(bad, bad)).toEqual([]);
    }
  });

  it('does not invent volume when the volume series is missing or unreadable', () => {
    const prices = wrap([{ price: 100, date: at('2026-09-21') }]);
    expect(parseIndexHistory(prices, wrap([{ volume: 'abc', date: at('2026-09-21') }]))[0]!.volume).toBeNull();
    expect(parseIndexHistory(prices, null)[0]!.volume).toBeNull();
  });
});

describe('planIndexInserts', () => {
  const points = [
    { date: '2010-04-19', value: 10669.88, volume: null },
    { date: '2021-09-15', value: 46716.72, volume: null },
    { date: '2026-09-21', value: 171153.17, volume: null },
  ];

  it('returns only the sessions we do not already hold', () => {
    expect(planIndexInserts(['2021-09-15'], points).map((p) => p.date)).toEqual(['2010-04-19', '2026-09-21']);
  });

  it('returns everything when nothing is held, and nothing when all are held', () => {
    expect(planIndexInserts([], points)).toHaveLength(3);
    expect(planIndexInserts(points.map((p) => p.date), points)).toEqual([]);
  });
});

describe('storedDay', () => {
  it('reads a session-stamped row back as its exchange calendar day', () => {
    expect(storedDay(sessionStampFor('2013-01-02'))).toBe('2013-01-02');
    expect(sessionStampFor('2013-01-02').toISOString()).toBe('2013-01-02T11:00:00.000Z');
  });

  it('reads a midnight-stamped row as the same day, not the day before', () => {
    expect(storedDay(new Date('2013-01-02T00:00:00.000Z'))).toBe('2013-01-02');
  });
});
