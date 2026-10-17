import {
  classifyDaily,
  classifyEvent,
  classifyIntraday,
  LIVE_WITHIN_MS,
  STALE_AFTER_MS,
} from '../src/utils/datasetFreshness';
import { pktMinutes, sessionPhase } from '../src/utils/marketHours';

/** PKT is UTC+5 with no DST, so every instant can be written in UTC and read as Karachi time. */
const at = (iso: string): Date => new Date(iso);
const dayOf = (d: Date): string => {
  const pkt = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toISOString().slice(0, 10);
};

describe('classifyIntraday', () => {
  const now = at('2026-10-16T05:30:00Z'); // Fri 10:30 PKT, mid-session
  const base = { now, open: true, lastSessionDate: '2026-10-16', dayOf };

  it('is unavailable with no reading at all', () => {
    expect(classifyIntraday({ ...base, asOf: null })).toBe('unavailable');
  });

  it('is live inside the live window', () => {
    expect(classifyIntraday({ ...base, asOf: new Date(now.getTime() - 60_000) })).toBe('live');
    expect(classifyIntraday({ ...base, asOf: new Date(now.getTime() - LIVE_WITHIN_MS) })).toBe('live');
  });

  it('is delayed between the live window and the stale one', () => {
    expect(
      classifyIntraday({ ...base, asOf: new Date(now.getTime() - LIVE_WITHIN_MS - 60_000) }),
    ).toBe('delayed');
    expect(classifyIntraday({ ...base, asOf: new Date(now.getTime() - STALE_AFTER_MS) })).toBe(
      'delayed',
    );
  });

  it('is stale past the stale window while the market is open', () => {
    expect(
      classifyIntraday({ ...base, asOf: new Date(now.getTime() - STALE_AFTER_MS - 60_000) }),
    ).toBe('stale');
  });

  it('is end-of-day when closed and the reading is from the last session', () => {
    expect(
      classifyIntraday({
        ...base,
        now: at('2026-10-16T11:30:00Z'), // Fri 16:30 PKT — an hour after the close
        open: false,
        asOf: at('2026-10-16T10:30:00Z'), // Fri 15:30 PKT, the close
      }),
    ).toBe('end-of-day');
  });

  it('is stale when closed and the reading predates the last session', () => {
    expect(
      classifyIntraday({
        ...base,
        open: false,
        lastSessionDate: '2026-10-16',
        asOf: at('2026-10-15T10:30:00Z'), // Thursday's close, Friday's session missing
      }),
    ).toBe('stale');
  });

  it('is stale on a later day when the newest session we hold is older', () => {
    expect(
      classifyIntraday({
        now: at('2026-10-19T05:00:00Z'), // Monday 10:00 PKT
        open: true,
        lastSessionDate: '2026-10-16',
        asOf: at('2026-10-16T10:30:00Z'),
        dayOf,
      }),
    ).toBe('stale');
  });

  it('does not paint the board red over clock skew', () => {
    expect(classifyIntraday({ ...base, asOf: new Date(now.getTime() + 5_000) })).toBe('live');
  });
});

describe('classifyDaily', () => {
  const dayOfDate = dayOf;

  it('is unavailable with no series', () => {
    expect(classifyDaily({ asOf: null, lastSessionDate: '2026-10-16', dayOf: dayOfDate })).toBe(
      'unavailable',
    );
  });

  it('is current when it covers the newest session', () => {
    expect(
      classifyDaily({
        asOf: at('2026-10-16T10:00:00Z'),
        lastSessionDate: '2026-10-16',
        dayOf: dayOfDate,
      }),
    ).toBe('end-of-day');
  });

  it('is stale when it stops short of the newest session', () => {
    expect(
      classifyDaily({
        asOf: at('2026-10-14T10:00:00Z'),
        lastSessionDate: '2026-10-16',
        dayOf: dayOfDate,
      }),
    ).toBe('stale');
  });
});

describe('classifyEvent', () => {
  const now = at('2026-10-17T09:00:00Z');

  it('is unavailable with no rows', () => {
    expect(classifyEvent(null, now)).toBe('unavailable');
  });

  it('is current for a week', () => {
    expect(classifyEvent(new Date(now.getTime() - 2 * 24 * 3600_000), now)).toBe('end-of-day');
  });

  it('is stale after a week', () => {
    expect(classifyEvent(new Date(now.getTime() - 10 * 24 * 3600_000), now)).toBe('stale');
  });
});

describe('sessionPhase', () => {
  it('reports before the 09:25 window', () => {
    expect(sessionPhase(at('2026-09-16T04:20:00Z'))).toBe('pre'); // 09:20 PKT
  });

  it('reports the session window inclusive', () => {
    expect(sessionPhase(at('2026-09-16T04:25:00Z'))).toBe('open'); // 09:25 PKT
    expect(sessionPhase(at('2026-09-16T10:35:00Z'))).toBe('open'); // 15:35 PKT
  });

  it('reports after the close', () => {
    expect(sessionPhase(at('2026-09-16T10:36:00Z'))).toBe('post');
  });

  it('counts minutes on the Karachi clock, not UTC', () => {
    expect(pktMinutes(at('2026-09-16T04:30:00Z'))).toBe(9 * 60 + 30);
  });
});
