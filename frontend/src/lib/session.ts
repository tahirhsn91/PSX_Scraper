/**
 * Whether the exchange is in session right now.
 *
 * The dashboard's `POINTS` column is a *live* figure: the backend re-reads every constituent's
 * contribution every couple of minutes through the session, and the table's default order is "biggest
 * contributor first". For that order to stay true the table has to re-read itself — but only when the
 * numbers can actually move. Polling all day would be the blanket-poll mistake the rest of this app
 * avoids, so this is the gate: refresh while the market is open, leave it alone when it is closed
 * (last night's close is still the close).
 *
 * Read in **Pakistan time**, whatever the visitor's clock says: `Intl` resolves the zone from the
 * platform's own database rather than a hard-coded offset, so it stays right across Pakistan's
 * history of DST (it had one, 2002-2009) and any future change. The window is the exchange's own
 * 09:30-15:30, Monday to Friday.
 *
 * It deliberately knows nothing about market holidays — the backend keeps that calendar
 * (`market_holidays`), and duplicating it here would be a second copy to get out of step. On a
 * holiday the worst case is a handful of refreshes that find the same numbers.
 */
const PSX_TIME_ZONE = 'Asia/Karachi';
const SESSION_OPENS_AT = 9 * 60 + 30;
const SESSION_CLOSES_AT = 15 * 60 + 30;

export function isPsxSessionOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PSX_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    // `h23`, not `hour12: false`: the latter renders midnight as `24` in some locales, and 24:00 is
    // 1440 minutes — a value that would sail past every comparison below.
    hourCycle: 'h23',
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const weekday = value('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  return Number.isFinite(minutes) && minutes >= SESSION_OPENS_AT && minutes <= SESSION_CLOSES_AT;
}
