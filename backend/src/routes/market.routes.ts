import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { Router } from 'express';
import * as ctrl from '../controllers/market.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { calendarQuery, moversQuery } from '../validators/schemas';

const router = Router();

router.get('/overview', asyncHandler(ctrl.marketOverview));
router.get('/status', asyncHandler(ctrl.marketStatus));

/**
 * Shariah screening metadata: which published list, how many members, when it was last read, and —
 * when a symbol is given — whether that symbol is currently a member.
 *
 * This is index membership, not a fatwa and not financial advice. The response says so in `basis`
 * so a client cannot render the number without its provenance.
 */
router.get(
  '/shariah',
  asyncHandler(async (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : null;
    const [meta] = await prisma.$queryRaw<
      Array<{ count: bigint; updated_at: Date | null }>
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS count, MAX(ic.updated_at) AS updated_at
      FROM index_constituents ic
      JOIN market_indices mi ON mi.id = ic.index_id
      WHERE mi.symbol = 'KMIALLSHR'
    `);

    const member = symbol
      ? await prisma.indexConstituent.findFirst({
          where: { stock: { symbol }, index: { symbol: 'KMIALLSHR' } },
          select: { id: true },
        })
      : null;

    const updatedAt = meta?.updated_at ?? null;
    const ageDays = updatedAt ? Math.floor((Date.now() - updatedAt.getTime()) / 86_400_000) : null;

    res.json({
      index: 'KMIALLSHR',
      indexName: 'KMI All Shares (Shariah)',
      count: Number(meta?.count ?? 0),
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      ageDays,
      // Membership is refreshed weekly by the index sync; older than 30 days means the screen may
      // no longer reflect the published list, and the UI says so instead of hiding it.
      stale: ageDays == null || ageDays > 30,
      basis:
        'Membership of a published PSX Shariah index. Not a fatwa, not financial advice, and not a substitute for a scholar’s opinion.',
      ...(symbol ? { symbol, member: member !== null } : {}),
    });
  }),
);
router.get('/movers', validate(moversQuery, 'query'), asyncHandler(ctrl.movers));
router.get('/sectors', asyncHandler(ctrl.sectors));
// A single segment with the name in the query: several sector names contain a slash, which a path
// parameter would split.
router.get('/sector', asyncHandler(ctrl.sectorDetail));
router.get('/dividends', validate(calendarQuery, 'query'), asyncHandler(ctrl.dividends));

export default router;
