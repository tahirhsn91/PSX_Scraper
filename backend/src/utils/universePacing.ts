/**
 * Pacing arithmetic for the universe pass (#41).
 *
 * Kept separate from the runner so the sums can be tested without a queue or a database — the
 * runner's module graph connects to Redis on import, which a unit test should not have to do.
 */

/**
 * How long a pass may hold its lock: the time the queue needs to walk the board, plus slack for
 * a slow source.
 *
 * `symbols * pacingMs` is when the last job becomes due; the slack covers a symbol whose scrape
 * is slower than its schedule. Too short and a pass would be interrupted by the next tick (the
 * same symbols scraped twice over); too long and a dead pass delays the next one.
 */
export function passLockTtlSeconds(
  symbols: number,
  pacingMs: number,
  slackMs = 10 * 60 * 1000,
): number {
  return Math.ceil((symbols * pacingMs + slackMs) / 1000);
}
