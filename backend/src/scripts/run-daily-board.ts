import { runDailyBoard } from '../services/dailyBoard.service';

/**
 * Run the daily board pass by hand — the same code the 02:00 timer runs, for verifying a change to
 * it or filling in a day the worker was down for. Idempotent: it registers what is missing and
 * queues refreshes, and a refresh writes under the session stamp.
 */
(async () => {
  const started = Date.now();
  const summary = await runDailyBoard();
  console.log('SUMMARY', JSON.stringify({ ...summary, minutes: ((Date.now() - started) / 60000).toFixed(2) }));
  console.log(summary.registered.length ? `  newly registered: ${summary.registered.join(' ')}` : '  newly registered: none');
  process.exit(0);
})();
