/**
 * Whether a reading still describes the present, or only the past.
 *
 * Index data has two time-like fields and they answer different questions: the *session* a value
 * belongs to, and *when we read it*. A board that has stopped reading keeps serving its last session,
 * so the session date alone cannot tell a live board from a dead one — an index level five days old
 * rendered as "as of 16:30" with nothing on screen to contradict it.
 *
 * The bar is a trading session plus the overnight gap, and it is deliberately generous: a weekend or
 * a holiday legitimately exceeds it, so the age is always shown as words ("updated 2 days ago") and
 * this flag only adds emphasis. Its job is to make a board that has *stopped* visible, not to guess
 * about one that is merely idle.
 */
export const READING_STALE_AFTER_MS = 26 * 60 * 60 * 1000;

/** True when a stored reading is older than a session, so the data on screen is not current. */
export function isStaleReading(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (value === null || value === undefined) return false;
  const at = value instanceof Date ? value : new Date(value);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms > READING_STALE_AFTER_MS;
}
