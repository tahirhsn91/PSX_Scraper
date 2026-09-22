import { SourceBreaker, recordSourceFailure, sourceBreaker } from '../src/utils/sourceBreaker';
import {
  InvalidSymbolError,
  NavigationTimeoutError,
  ParseError,
  SiteUnavailableError,
  SourceCoolingDownError,
} from '../src/types/errors';

/**
 * The back-off that keeps us from hammering a source that is refusing us (#27). Time is
 * injected, so every test drives the clock instead of waiting on one.
 */
const MINUTE = 60_000;

describe('SourceBreaker', () => {
  let clock: number;
  let breaker: SourceBreaker;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    breaker = new SourceBreaker({
      threshold: 3,
      baseCooldownMs: 5 * MINUTE,
      maxCooldownMs: 20 * MINUTE,
      now: () => clock,
    });
  });

  it('stays closed while failures are below the threshold', () => {
    breaker.recordFailure('psx-eod', 'Source site unavailable: psx-eod');
    breaker.recordFailure('psx-eod', 'Source site unavailable: psx-eod');

    expect(breaker.isCoolingDown('psx-eod')).toBe(false);
    expect(() => breaker.assertAvailable('psx-eod')).not.toThrow();
  });

  it('opens on the threshold-th consecutive failure and reports when it ends', () => {
    breaker.recordFailure('psx-eod', 'boom');
    breaker.recordFailure('psx-eod', 'boom');
    const tripped = breaker.recordFailure('psx-eod', 'boom');

    expect(tripped).toBe(true);
    expect(breaker.isCoolingDown('psx-eod')).toBe(true);
    expect(breaker.resumeAt('psx-eod')?.toISOString()).toBe(new Date(clock + 5 * MINUTE).toISOString());

    const err = (() => {
      try {
        breaker.assertAvailable('psx-eod');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(SourceCoolingDownError);
    expect((err as SourceCoolingDownError).source).toBe('psx-eod');
    expect((err as SourceCoolingDownError).resumeAt.toISOString()).toBe(
      new Date(clock + 5 * MINUTE).toISOString(),
    );
  });

  it('lets a probe through once the cooldown elapses, and re-trips longer on its failure', () => {
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('psx-eod', 'boom');
    expect(breaker.isCoolingDown('psx-eod')).toBe(true);

    clock += 5 * MINUTE;
    expect(breaker.isCoolingDown('psx-eod')).toBe(false);
    expect(() => breaker.assertAvailable('psx-eod')).not.toThrow();

    const tripped = breaker.recordFailure('psx-eod', 'boom again');
    expect(tripped).toBe(true);
    expect(breaker.resumeAt('psx-eod')?.toISOString()).toBe(
      new Date(clock + 10 * MINUTE).toISOString(),
    );
  });

  it('caps the cooldown at maxCooldownMs however many times it trips', () => {
    // Each round waits the window out, so the next failure is a probe that re-trips.
    for (let round = 0; round < 4; round += 1) {
      breaker.recordFailure('psx-eod', 'boom');
      clock += 60 * MINUTE;
    }

    breaker.recordFailure('psx-eod', 'boom');
    const resume = breaker.resumeAt('psx-eod');
    expect(resume).not.toBeNull();
    expect((resume as Date).getTime() - clock).toBe(20 * MINUTE);
  });

  it('does not re-trip from failures inside an open window', () => {
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('psx-eod', 'boom');
    const resumeAt = breaker.resumeAt('psx-eod')?.getTime();

    // A tick that failed 25 symbols while cooling must not extend or escalate the window.
    for (let i = 0; i < 25; i += 1) breaker.recordFailure('psx-eod', 'boom');
    expect(breaker.resumeAt('psx-eod')?.getTime()).toBe(resumeAt);
    expect(breaker.state().find((s) => s.source === 'psx-eod')?.opens).toBe(1);
  });

  it('clears the failure run on a served response', () => {
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('psx-eod', 'boom');
    breaker.recordSuccess('psx-eod');

    expect(breaker.isCoolingDown('psx-eod')).toBe(false);
    expect(breaker.state()).toEqual([]);
    // The run restarted, so the source is not one failure away from a cooldown again.
    breaker.recordFailure('psx-eod', 'boom');
    breaker.recordFailure('psx-eod', 'boom');
    expect(breaker.isCoolingDown('psx-eod')).toBe(false);
  });

  it('keeps sources independent', () => {
    for (let i = 0; i < 3; i += 1) breaker.recordFailure('psx-eod', 'boom');

    expect(breaker.isCoolingDown('psx-eod')).toBe(true);
    expect(breaker.isCoolingDown('psx-quotes')).toBe(false);
    expect(() => breaker.assertAvailable('psx-quotes')).not.toThrow();
  });

  it('reports only sources that have something to report', () => {
    expect(breaker.state()).toEqual([]);
    breaker.recordFailure('psx-quotes', 'boom');
    breaker.recordSuccess('unused-source');

    expect(breaker.state().map((s) => s.source)).toEqual(['psx-quotes']);
    expect(breaker.state()[0]).toMatchObject({
      source: 'psx-quotes',
      failures: 1,
      coolingDown: false,
      opens: 0,
      resumeAt: null,
      lastError: 'boom',
    });
  });
});

describe('recordSourceFailure', () => {
  beforeEach(() => sourceBreaker.reset());

  it('counts a refusal and a timeout', () => {
    recordSourceFailure('psx-eod', new SiteUnavailableError('psx-eod'));
    recordSourceFailure('psx-eod', new NavigationTimeoutError('psx-eod'));

    expect(sourceBreaker.state()[0]).toMatchObject({ source: 'psx-eod', failures: 2 });
  });

  it('ignores a bad symbol and a parse error — neither is the source refusing us', () => {
    recordSourceFailure('psx-eod', new InvalidSymbolError('NOTREAL'));
    recordSourceFailure('psx-eod', new ParseError('psx-eod', 'data-array'));

    expect(sourceBreaker.state()).toEqual([]);
  });

  it('does not count a cooldown as a refusal of a request we never sent', () => {
    recordSourceFailure('psx-eod', new SourceCoolingDownError('psx-eod', new Date()));

    expect(sourceBreaker.state()).toEqual([]);
  });
});
