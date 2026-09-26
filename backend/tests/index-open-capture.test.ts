import {
  OPEN_CAPTURE_CLOSE_MINUTES,
  OPEN_CAPTURE_OPEN_MINUTES,
  openingLevelFor,
} from '../src/services/indexScrape.service';

/** An instant on the Karachi wall clock, written the way it is spoken: date + time + PKT. */
const pkt = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);

const MONDAY = '2026-09-28';
const SATURDAY = '2026-09-26';
const SUNDAY = '2026-09-27';
const LEVEL = 170_765.22;

const capture = (now: Date, existingOpen: number | null = null) =>
  openingLevelFor({ now, level: LEVEL, existingOpen });

describe('openingLevelFor', () => {
  it('takes the reading taken at the session open as the day’s opening level', () => {
    expect(capture(pkt(MONDAY, '09:31'))).toBe(LEVEL);
  });

  it('holds the window at both ends', () => {
    expect(capture(pkt(MONDAY, '09:29'))).toBeNull();
    expect(capture(pkt(MONDAY, '09:30'))).toBe(LEVEL);
    expect(capture(pkt(MONDAY, '09:36'))).toBe(LEVEL);
    expect(capture(pkt(MONDAY, '09:37'))).toBeNull();
  });

  it('never overwrites an opening level the row already carries', () => {
    // A real open from the DPS series (when that source answers) always wins over our first
    // reading, and a re-run of the same pass may not append one.
    expect(capture(pkt(MONDAY, '09:31'), 169_399.99)).toBeNull();
    expect(capture(pkt(MONDAY, '09:33'), 170_000)).toBeNull();
  });

  it('records nothing when a session’s first pass is late', () => {
    // A worker that comes up at 11:00 must not label an 11:00 level as the open: the row keeps
    // the dash, which is honest, rather than a number the exchange never published.
    expect(capture(pkt(MONDAY, '11:00'))).toBeNull();
    expect(capture(pkt(MONDAY, '15:29'))).toBeNull();
  });

  it('records nothing over a weekend, when the carousel still serves Friday’s level', () => {
    expect(capture(pkt(SATURDAY, '09:31'))).toBeNull();
    expect(capture(pkt(SUNDAY, '09:31'))).toBeNull();
  });

  it('judges the window on Karachi time, not UTC', () => {
    expect(capture(new Date('2026-09-28T04:31:00Z'))).toBe(LEVEL); // 09:31 PKT
    expect(capture(new Date('2026-09-28T05:37:00Z'))).toBeNull(); // 10:37 PKT
  });

  it('always has a pass inside the window, at the production cadence', () => {
    // The scrape fires every 5 minutes from wherever the worker's clock sits, and its own guard
    // opens at 09:25, so its first pass of a session lands in 09:25–09:29. The one after that is
    // the reading this rule captures — which is why the window is six minutes wide.
    const firstPassFloor = 9 * 60 + 25;
    for (let first = firstPassFloor; first < firstPassFloor + 5; first += 1) {
      const next = first + 5;
      expect(next).toBeGreaterThanOrEqual(OPEN_CAPTURE_OPEN_MINUTES);
      expect(next).toBeLessThanOrEqual(OPEN_CAPTURE_CLOSE_MINUTES);
    }
  });
});
