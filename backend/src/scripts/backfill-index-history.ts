import { backfillAllIndices } from '../services/indexHistoryBackfill.service';

/**
 * One-off: fill every index's stored history from Sarmaaya's public series (KSE100 back to 2010).
 * Safe to re-run — it only inserts sessions we do not already hold, so a level collected live from
 * the exchange is never replaced by a historical reading.
 */
(async () => {
  const started = Date.now();
  const summary = await backfillAllIndices();
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log('SUMMARY', JSON.stringify({ indices: summary.indices, fetched: summary.fetched, inserted: summary.inserted, failed: summary.failed, minutes }));
  for (const r of summary.results) {
    console.log(`  ${r.symbol.padEnd(11)} fetched=${String(r.fetched).padStart(5)} inserted=${String(r.inserted).padStart(5)} held=${String(r.alreadyHeld).padStart(5)}${r.error ? ' ERROR=' + r.error : ''}`);
  }
  process.exit(0);
})();
