import { isClosingPassDue } from '../src/utils/marketHours';
import {
  isPostCloseReading,
  pktSessionKey,
  repairedValueFor,
  runIndexClosingPass,
  sessionCloseAt,
  type IndexScrapeResult,
} from '../src/services/indexScrape.service';

/** An instant on the Karachi wall clock, written the way it is spoken: date + time + PKT. */
const pkt = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);

const MONDAY = '2026-09-28';
const FRIDAY = '2026-09-25';
const SATURDAY = '2026-10-03';
const SUNDAY = '2026-10-04';

/** A session's row key: the session's own day stamped at 16:00 PKT. */
const stamp = (date: string) => new Date(`${date}T16:00:00+05:00`);

const emptyResult = (): IndexScrapeResult => ({
  symbols: 0,
  created: 0,
  updated: 0,
  valuesWritten: 0,
  namesResolved: 0,
  repaired: 0,
});

describe('when the closing pass is due', () => {
  it('is not due while the session is still open', () => {
    expect(isClosingPassDue(pkt(MONDAY, '09:31'))).toBe(false);
    expect(isClosingPassDue(pkt(MONDAY, '15:00'))).toBe(false);
    expect(isClosingPassDue(pkt(MONDAY, '15:35'))).toBe(false); // the settle moment itself
  });

  it('is due after 15:35 PKT on a trading day', () => {
    expect(isClosingPassDue(pkt(MONDAY, '15:36'))).toBe(true);
    expect(isClosingPassDue(pkt(MONDAY, '18:00'))).toBe(true);
  });

  it('is never due over a weekend, when the carousel still serves Friday', () => {
    expect(isClosingPassDue(pkt(SATURDAY, '15:40'))).toBe(false);
    expect(isClosingPassDue(pkt(SUNDAY, '15:40'))).toBe(false);
  });

  it('judges Karachi wall-clock time, not UTC', () => {
    expect(isClosingPassDue(new Date('2026-09-28T10:36:00Z'))).toBe(true); // 15:36 PKT
    expect(isClosingPassDue(new Date('2026-09-28T10:34:00Z'))).toBe(false); // 15:34 PKT
    expect(isClosingPassDue(new Date('2026-09-28T20:00:00Z'))).toBe(false); // 01:00 PKT on Tuesday
  });
});

describe('runIndexClosingPass', () => {
  const dueNow = pkt(MONDAY, '15:40');

  it('runs once per session however often the timer fires', async () => {
    const claimed = new Set<string>();
    const claim = async (now: Date) => {
      const key = pktSessionKey(now);
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    };
    let scrapedAt: Date | null = null;
    let scrapeCount = 0;
    const scrape = async (now: Date) => {
      scrapedAt = now;
      scrapeCount += 1;
      return emptyResult();
    };

    const results = [];
    for (let tick = 0; tick < 50; tick += 1) {
      results.push(await runIndexClosingPass({ now: dueNow, claim, scrape }));
    }

    // The timer keeps firing every INDEX_SCRAPE_INTERVAL_MS after the close; the claim, not the
    // clock, is what makes this one read.
    expect(scrapeCount).toBe(1);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(results[0]?.reason).toBe('ran');
    expect(results.slice(1).every((r) => r.reason === 'already-claimed')).toBe(true);
    // And the reading it stamps is the pass's own time, which is after the close — the whole point.
    expect(scrapedAt).not.toBeNull();
    expect(isPostCloseReading(scrapedAt, stamp(MONDAY))).toBe(true);
  });

  it('refuses, and says why, rather than running anyway', async () => {
    for (const now of [pkt(MONDAY, '11:00'), pkt(SATURDAY, '15:40')]) {
      let claims = 0;
      let scrapes = 0;
      const result = await runIndexClosingPass({
        now,
        claim: async () => {
          claims += 1;
          return true;
        },
        scrape: async () => {
          scrapes += 1;
          return emptyResult();
        },
      });
      expect(result).toEqual({ ran: false, reason: 'not-due' });
      expect(claims).toBe(0); // not even claimed, let alone scraped
      expect(scrapes).toBe(0);
    }
  });

  it('claims a session by its Karachi day, so a pass after midnight belongs to the next one', () => {
    expect(pktSessionKey(dueNow)).toBe(MONDAY);
    expect(pktSessionKey(new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-29'); // 01:00 PKT Tuesday
    expect(pktSessionKey(new Date('2026-09-28T10:36:00Z'))).toBe(MONDAY);
  });
});

describe('isPostCloseReading', () => {
  it('is true only for a reading taken after that session’s close', () => {
    expect(isPostCloseReading(pkt(MONDAY, '09:25'), stamp(MONDAY))).toBe(false); // the pre-open reading
    expect(isPostCloseReading(pkt(MONDAY, '11:00'), stamp(MONDAY))).toBe(false);
    expect(isPostCloseReading(pkt(MONDAY, '15:35'), stamp(MONDAY))).toBe(false); // the settle moment
    expect(isPostCloseReading(pkt(MONDAY, '15:36'), stamp(MONDAY))).toBe(true);
    expect(isPostCloseReading(null, stamp(MONDAY))).toBe(false); // no reading to point at
  });

  it('reads the close moment from the row’s own session, not from the clock', () => {
    expect(sessionCloseAt(stamp(FRIDAY)).toISOString()).toBe('2026-09-25T10:35:00.000Z');
    // Friday evening's reading is post-close for Friday, and says nothing about Monday.
    expect(isPostCloseReading(pkt(FRIDAY, '16:00'), stamp(FRIDAY))).toBe(true);
    expect(isPostCloseReading(pkt(FRIDAY, '16:00'), stamp(MONDAY))).toBe(false);
  });
});

describe('repairedValueFor', () => {
  // 25 Sep as it stands in the database: written at 09:25 PKT, 0.17% below the session's close.
  const stale = {
    storedValue: 170473.69,
    valueAt: pkt(FRIDAY, '09:25'),
    tradeDate: stamp(FRIDAY),
    impliedClose: 170765.22,
  };

  it('corrects a row whose close was never captured, to the exchange’s own implied close', () => {
    expect(repairedValueFor(stale)).toBe(170765.22);
  });

  it('leaves a row that already holds a post-close reading alone', () => {
    expect(repairedValueFor({ ...stale, valueAt: pkt(FRIDAY, '15:40') })).toBeNull();
  });

  it('leaves a row alone when the page published no change to derive it from', () => {
    expect(repairedValueFor({ ...stale, impliedClose: null })).toBeNull();
  });

  it('does not rewrite a row that already agrees, to the paisa', () => {
    expect(repairedValueFor({ ...stale, storedValue: 170765.22 })).toBeNull();
    expect(repairedValueFor({ ...stale, storedValue: 170765.224 })).toBeNull();
  });

  it('judges the row against its own session, so a repair cannot land on the wrong day', () => {
    expect(
      repairedValueFor({
        storedValue: 170000,
        valueAt: pkt(MONDAY, '09:25'),
        tradeDate: stamp(MONDAY),
        impliedClose: 170500,
      }),
    ).toBe(170500);
  });
});
