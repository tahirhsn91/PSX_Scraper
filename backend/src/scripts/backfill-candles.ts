import { prisma } from '../database/prisma';
import { backfillSymbol, assertStampMatchesSessionRule } from '../services/candleBackfill.service';

/**
 * Fill in daily candle history for every tracked symbol.
 *
 *   npx tsx src/scripts/backfill-candles.ts                 # every tracked symbol
 *   npx tsx src/scripts/backfill-candles.ts --symbols=FFC,OGDC
 *   npx tsx src/scripts/backfill-candles.ts --limit=20 --pace=800
 *
 * One request per symbol against Yahoo, paced, and idempotent: sessions we already hold are
 * left alone, gaps are filled, everything already complete is skipped. Re-running is safe.
 */
const args = new Map(
  process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]),
);
const only = args.get('--symbols')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const limit = Number(args.get('--limit') ?? 0);
const paceMs = Number(args.get('--pace') ?? 1200);
/** Symbols already holding at least this many sessions are left alone entirely. */
const minSessions = Number(args.get('--min-sessions') ?? 1000);

async function main() {
  const symbols =
    only ??
    (await prisma.stock.findMany({ select: { symbol: true }, orderBy: { symbol: 'asc' } })).map(
      (s) => s.symbol,
    );
  const list = limit > 0 ? symbols.slice(0, limit) : symbols;

  // Fail fast if the two ways of keying a session ever disagree — a mismatch would create a
  // second row for a day the live poll already wrote.
  for (const d of ['2026-09-16', '2026-01-02', '2025-12-31']) assertStampMatchesSessionRule(d);

  console.log(`backfill: ${list.length} symbol(s), pace ${paceMs}ms`);
  const totals = { barsFetched: 0, inserted: 0, filled: 0, skipped: 0, failed: 0, alreadyDeep: 0 };
  const failures: string[] = [];
  const started = Date.now();

  for (let i = 0; i < list.length; i += 1) {
    const symbol = list[i]!;
    try {
      const s = await backfillSymbol(symbol, minSessions);
      if (s.alreadyDeep) {
        totals.alreadyDeep += 1;
        continue; // no request was made, so no pacing pause is needed either
      }
      totals.barsFetched += s.barsFetched;
      totals.inserted += s.inserted;
      totals.filled += s.filled;
      totals.skipped += s.skipped;
      if (i % 25 === 0 || i === list.length - 1) {
        console.log(
          `[${i + 1}/${list.length}] ${s.symbol.padEnd(10)} bars=${s.barsFetched} inserted=${s.inserted} filled=${s.filled} skipped=${s.skipped}`,
        );
      }
    } catch (e) {
      totals.failed += 1;
      failures.push(`${symbol}: ${(e as Error).message.slice(0, 90)}`);
      if (i % 25 === 0) console.log(`[${i + 1}/${list.length}] ${symbol.padEnd(10)} FAILED ${(e as Error).message.slice(0, 90)}`);
    }
    if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`SUMMARY ${JSON.stringify({ ...totals, minutes: mins })}`);
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('backfill failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
