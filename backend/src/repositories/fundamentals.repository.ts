import { prisma } from '../database/prisma';

/** A newest-ratio row per stock, each metric as a plain number or null. */
export type RatioRow = Record<string, number | null>;

const num = (v: unknown): number | null => (v == null ? null : Number(v));

const FIELDS = [
  'peRatio', 'pbRatio', 'roe', 'roa', 'dividendYield', 'bookValue', 'eps', 'beta',
  'netProfitMargin', 'freeFloatShares', 'freeFloatPercent', 'dps', 'payoutRatio',
  'roic', 'debtToEquity', 'currentRatio', 'revenueGrowth', 'epsGrowth',
] as const;

/**
 * The newest ratio row for every tracked stock in one sector, as flat numeric maps.
 *
 * Fed to `mediansOf` in the fundamentals service. The `created_at DESC` order means the first row
 * seen per stock is its newest — the same "newest wins" rule the rest of the read path uses — and
 * a sector with one or two stocks yields a noisy median, which the caller must tolerate rather than
 * hide (the issue records that several sectors have 1–3 peers).
 */
export async function getSectorRatioRows(sector: string): Promise<RatioRow[]> {
  const rows = await prisma.ratio.findMany({
    where: { stock: { sector } },
    orderBy: { createdAt: 'desc' },
    select: {
      stockId: true,
      peRatio: true, pbRatio: true, roe: true, roa: true, dividendYield: true,
      bookValue: true, eps: true, beta: true,
      netProfitMargin: true, freeFloatShares: true, freeFloatPercent: true,
      dps: true, payoutRatio: true, roic: true, debtToEquity: true,
      currentRatio: true, revenueGrowth: true, epsGrowth: true,
    },
  });

  const seen = new Set<string>();
  const newest: RatioRow[] = [];
  for (const row of rows) {
    if (seen.has(row.stockId)) continue;
    seen.add(row.stockId);
    const flat: RatioRow = {};
    for (const f of FIELDS) flat[f] = num(row[f]);
    newest.push(flat);
  }
  return newest;
}
