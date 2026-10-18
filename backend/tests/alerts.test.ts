import {
  describeAlert,
  evaluateAlert,
  isCool,
  isTriggered,
  type AlertLike,
  type MarketContext,
} from '../src/services/alerts.service';

const now = new Date('2026-10-18T10:00:00Z');

const ctx = (over: Partial<MarketContext> = {}): MarketContext => ({
  symbol: 'OGDC',
  price: 100,
  prevClose: 95,
  rsi: 55,
  sma50: 98,
  prevSma50: 99,
  sma200: 90,
  prevSma200: 89,
  ...over,
});

const alert = (over: Partial<AlertLike> = {}): AlertLike => ({
  id: 'a1',
  kind: 'PRICE_ABOVE',
  threshold: 99,
  paused: false,
  lastFiredAt: null,
  cooldownMinutes: 60,
  ...over,
});

describe('conditions', () => {
  it('fires a price-above alert at or above the level', () => {
    expect(isTriggered('PRICE_ABOVE', 100, ctx())).toBe(true);
    expect(isTriggered('PRICE_ABOVE', 100.01, ctx())).toBe(false);
  });

  it('fires a price-below alert at or below the level', () => {
    expect(isTriggered('PRICE_BELOW', 100, ctx())).toBe(true);
    expect(isTriggered('PRICE_BELOW', 99.99, ctx())).toBe(false);
  });

  it('measures a daily move against the previous close, in either direction', () => {
    expect(isTriggered('PCT_MOVE', 5, ctx())).toBe(true); // +5.26%
    expect(isTriggered('PCT_MOVE', 6, ctx())).toBe(false);
    expect(isTriggered('PCT_MOVE', 5, ctx({ price: 90 }))).toBe(true); // −5.26%
  });

  it('does not fire when the reading it needs is missing', () => {
    expect(isTriggered('RSI_ABOVE', 50, ctx({ rsi: null }))).toBe(false);
    expect(isTriggered('PRICE_ABOVE', 50, ctx({ price: null }))).toBe(false);
    expect(isTriggered('CROSS_ABOVE_SMA', null, ctx({ sma50: null }))).toBe(false);
  });

  it('fires a cross only when the previous close was on the other side', () => {
    // prevClose 95 < prevSma50 99, price 100 >= sma50 98 → crossed up
    expect(isTriggered('CROSS_ABOVE_SMA', null, ctx())).toBe(true);
    // already above yesterday → no cross
    expect(isTriggered('CROSS_ABOVE_SMA', null, ctx({ prevClose: 99.5, prevSma50: 98 }))).toBe(false);
    // crossed down
    expect(isTriggered('CROSS_BELOW_SMA', null, ctx({ price: 97, sma50: 98, prevClose: 99, prevSma50: 98 }))).toBe(true);
  });

  it('never fires an unknown kind, which is still storable', () => {
    expect(isTriggered('SOMETHING_NEW', 1, ctx())).toBe(false);
  });
});

describe('cooldown', () => {
  it('is cool when it has never fired', () => {
    expect(isCool(alert(), now)).toBe(true);
  });

  it('stays quiet inside the window and opens again after it', () => {
    const fired30 = alert({ lastFiredAt: new Date('2026-10-18T09:30:00Z') });
    const fired61 = alert({ lastFiredAt: new Date('2026-10-18T08:59:00Z') });
    expect(isCool(fired30, now)).toBe(false);
    expect(isCool(fired61, now)).toBe(true);
  });

  it('is not cool when paused, however long ago it fired', () => {
    expect(isCool(alert({ paused: true, lastFiredAt: null }), now)).toBe(false);
  });
});

describe('events', () => {
  it('returns one event with a message that states the reading', () => {
    const ev = evaluateAlert(alert(), ctx(), now);
    expect(ev).not.toBeNull();
    expect(ev!.alertId).toBe('a1');
    expect(ev!.message).toContain('OGDC');
    expect(ev!.message).toContain('100.00');
  });

  it('reports the move itself for a percentage alert', () => {
    const ev = evaluateAlert(alert({ kind: 'PCT_MOVE', threshold: 5 }), ctx(), now);
    expect(ev!.value).toBeCloseTo(5.263, 2);
    expect(ev!.message).toContain('5.26%');
  });

  it('does not fire twice inside the cooldown', () => {
    const first = evaluateAlert(alert(), ctx(), now);
    expect(first).not.toBeNull();
    const again = evaluateAlert(alert({ lastFiredAt: now }), ctx(), new Date(now.getTime() + 30_000));
    expect(again).toBeNull();
  });

  it('never uses advice language', () => {
    const messages = [
      evaluateAlert(alert(), ctx(), now)!.message,
      evaluateAlert(alert({ kind: 'PRICE_BELOW', threshold: 101 }), ctx(), now)!.message,
      evaluateAlert(alert({ kind: 'RSI_ABOVE', threshold: 50 }), ctx(), now)!.message,
      evaluateAlert(alert({ kind: 'CROSS_ABOVE_SMA' }), ctx(), now)!.message,
      evaluateAlert(alert({ kind: 'PCT_MOVE', threshold: 5 }), ctx(), now)!.message,
    ];
    for (const m of messages) {
      expect(m).not.toMatch(/\b(buy|sell|recommend|opportunit|should)\b/i);
    }
  });
});

describe('plain-language descriptions', () => {
  it('describes each condition without advice', () => {
    expect(describeAlert('PRICE_ABOVE', 295)).toBe('Price at or above 295.00');
    expect(describeAlert('CROSS_BELOW_SMA', null)).toBe('Price crossed below its 50-session average');
    for (const kind of ['PRICE_ABOVE', 'PRICE_BELOW', 'PCT_MOVE', 'RSI_ABOVE', 'RSI_BELOW', 'CROSS_ABOVE_SMA', 'CROSS_BELOW_SMA']) {
      expect(describeAlert(kind, 50)).not.toMatch(/\b(buy|sell)\b/i);
    }
  });
});
