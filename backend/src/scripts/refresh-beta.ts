import { prisma } from '../database/prisma';
import { betaService } from '../services/beta.service';

/**
 * Compute and store beta for the tracked universe, from our own daily history against the KSE-100
 * (#79, criterion 7).
 *
 *   npx tsx src/scripts/refresh-beta.ts                    # every tracked symbol
 *   npx tsx src/scripts/refresh-beta.ts --symbols=FFC,OGDC
 *   npx tsx src/scripts/refresh-beta.ts --limit=20
 *
 * Nothing leaves the process: the window is our own `stock_prices` and `index_values` series, so
 * this is a local computation over ~500 symbols (three statements each) with no source to pace and
 * no rate limit to earn. Re-running is safe and idempotent — the newest ratio row's `beta` is
 * overwritten with the same value the same window yields.
 */
const args = new Map(
  process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]),
);
const only = args.get('--symbols')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const limit = Number(args.get('--limit') ?? 0);

async function main() {
  const started = Date.now();
  // A `--symbols`/`--limit` run is for eyeballing a few rows; the real fill is the whole universe.
  if (only || limit > 0) {
    const symbols = only ?? (await prisma.stock.findMany({
      select: { symbol: true },
      orderBy: { symbol: 'asc' },
    })).map((s) => s.symbol).slice(0, limit);
    for (const symbol of symbols) {
      const { value, window, stored, reason } = await betaService.refreshSymbol(symbol);
      console.log(
        `${symbol.padEnd(10)} beta=${value === null ? '—' : value} stored=${stored} `
        + `observations=${window.observations} ${window.from ?? '—'} → ${window.to ?? '—'}`
        + (reason ? ` (${reason})` : ''),
      );
    }
    console.log(`SUMMARY ${JSON.stringify({ requested: symbols.length, minutes: ((Date.now() - started) / 60000).toFixed(2) })}`);
    await prisma.$disconnect();
    return;
  }

  const summary = await betaService.refreshAll();
  const dash = summary.belowMinimum;
  console.log(
    `SUMMARY ${JSON.stringify({
      tracked: summary.tracked,
      computed: summary.computed,
      dash: dash.length,
      updated: summary.written.updated,
      created: summary.written.created,
      skipped: summary.written.skipped,
      minutes: ((Date.now() - started) / 60000).toFixed(2),
    })}`,
  );
  // The symbols left as a dash, named: a thin window is a fact about the symbol (listed weeks ago),
  // and it should be readable without a query.
  if (dash.length) {
    console.log(`DASH (${dash.length}) — the column stays empty and the payload says why:`);
    for (const d of dash.slice(0, 20)) console.log(`  ${d.symbol.padEnd(10)} ${d.observations} aligned session(s): ${d.reason}`);
    if (dash.length > 20) console.log(`  … and ${dash.length - 20} more`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('beta refresh failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
