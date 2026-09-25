import { prisma } from '../database/prisma';

/**
 * Null out stored market caps that were never a symbol's own figure.
 *
 *   npx tsx src/scripts/cleanup-market-cap.ts            # report only, changes nothing
 *   npx tsx src/scripts/cleanup-market-cap.ts --apply    # write the nulls
 *
 * Background (#71): before the cap was read from its labelled element and scaled, the scraper swept
 * a whole page and stored one figure for every symbol of a session —
 *
 *   session    | rows | distinct values
 *   2026-09-22 |   21 |  1  (48945.08 for DFSM, AGIL, 786, AABS …)
 *   2026-09-15 |  312 |  8
 *   2026-09-14 |  127 |  1  (48131.13)
 *
 * Those 460 rows are still in `stock_prices`; fixing the scraper stops new ones but does not clean
 * these, and they surface in any history or chart view.
 *
 * The signature is unambiguous rather than heuristic: a computed market cap cannot be identical
 * across companies trading at different prices, so a value shared by **three or more** symbols in one
 * session is page-level, not per-symbol. Two-symbol groups are reported but deliberately left alone —
 * a security and its rights/convertible share a figure legitimately (ANL/ANLNV, MUGHAL/MUGHALC).
 *
 * Only rows *before today* are considered: today's rows belong to the refresh, which has its own
 * collision rule (`dropSharedGapValues`) and is not this script's business. Idempotent — a second
 * run finds nothing.
 */
const apply = process.argv.includes('--apply');
/** Below this many symbols sharing one value, leave the row alone (sibling lines share two). */
const MIN_GROUP = 3;

interface GroupRow {
  session: Date;
  market_cap: string;
  members: number;
  symbols: string;
}

async function main() {
  const groups = await prisma.$queryRaw<GroupRow[]>`
    SELECT sp.last_trade_date::date AS session,
           sp.market_cap::text       AS market_cap,
           count(*)::int             AS members,
           string_agg(s.symbol, ', ' ORDER BY s.symbol) AS symbols
    FROM stock_prices sp
    JOIN stocks s ON s.id = sp.stock_id
    WHERE sp.market_cap IS NOT NULL
      AND sp.last_trade_date < current_date
    GROUP BY 1, 2
    HAVING count(*) >= ${MIN_GROUP}
    ORDER BY 1 DESC, 3 DESC
  `;

  if (groups.length === 0) {
    console.log('No page-level market-cap groups found — nothing to clean.');
    return;
  }

  let rows = 0;
  console.log(`Page-level groups (${MIN_GROUP}+ symbols sharing one value):\n`);
  for (const g of groups) {
    const day = g.session.toISOString().slice(0, 10);
    rows += g.members;
    console.log(`  ${day}  ${Number(g.market_cap).toLocaleString('en-PK').padStart(20)}`);
    console.log(`      ${g.members} rows: ${g.symbols.slice(0, 90)}${g.symbols.length > 90 ? ' …' : ''}`);
  }
  console.log(`\n  ${groups.length} groups · ${rows} rows would be set to NULL.`);

  // A two-symbol group is reported, never touched: it may be a genuine sibling pair.
  const pairs = await prisma.$queryRaw<{ pairs: bigint }[]>`
    SELECT count(*)::bigint AS pairs FROM (
      SELECT 1 FROM stock_prices
      WHERE market_cap IS NOT NULL AND last_trade_date < current_date
      GROUP BY last_trade_date::date, market_cap HAVING count(*) = 2
    ) t
  `;
  console.log(`  ${Number(pairs[0]?.pairs ?? 0)} two-symbol groups left alone (possible sibling lines).`);

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to write the nulls.');
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE stock_prices sp
    SET market_cap = NULL
    WHERE sp.id IN (
      SELECT id FROM (
        SELECT sp2.id,
               count(*) OVER (PARTITION BY sp2.last_trade_date::date, sp2.market_cap) AS members
        FROM stock_prices sp2
        WHERE sp2.market_cap IS NOT NULL AND sp2.last_trade_date < current_date
      ) g
      WHERE g.members >= ${MIN_GROUP}
    )
  `;
  console.log(`\nApplied: ${updated} rows set to NULL.`);
}

void main()
  .catch((err) => {
    console.error('cleanup-market-cap failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
