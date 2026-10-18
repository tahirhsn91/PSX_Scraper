import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { valid, validate } from '../middleware/validate';
import { prisma } from '../database/prisma';
import { technicalUniverse } from '../services/technicalUniverse.service';
import {
  ALERT_KINDS,
  describeAlert,
  evaluateAlert,
  type AlertLike,
  type MarketContext,
} from '../services/alerts.service';

/**
 * Alerts owned by a device token.
 *
 * There are no accounts, so the token is the entire authorisation model: it is generated in the
 * browser, kept in localStorage, and sent as `X-Device-Token`. Every query is scoped by it, so one
 * device can never read or delete another's alerts. When accounts arrive, the token becomes a column
 * on a user row and these queries gain one more predicate — the alerts themselves do not change.
 */

const tokenOf = (req: { header: (n: string) => string | undefined }) => {
  const token = req.header('x-device-token');
  if (!token || token.length < 8 || token.length > 128) return null;
  return token;
};

const createBody = z.object({
  symbol: z.string().trim().min(1).max(20),
  kind: z.enum(ALERT_KINDS),
  threshold: z.number().finite().optional(),
  cooldownMinutes: z.number().int().min(5).max(10_080).default(60),
});

const patchBody = z.object({ paused: z.boolean() });

const router = Router();

/** 401 rather than an empty list: an empty list would read as "you have no alerts". */
router.use((req, res, next) => {
  if (!tokenOf(req)) {
    res.status(401).json({ error: { code: 'DEVICE_TOKEN_REQUIRED', message: 'X-Device-Token is required' } });
    return;
  }
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const token = tokenOf(req)!;
    const rows = await prisma.alert.findMany({
      where: { ownerToken: token },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, kind: true, threshold: true, cooldownMinutes: true, paused: true,
        lastFiredAt: true, createdAt: true,
        stock: { select: { symbol: true, companyName: true } },
        events: { orderBy: { firedAt: 'desc' }, take: 1, select: { firedAt: true, message: true, deliveryStatus: true, error: true } },
      },
    });
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        symbol: r.stock.symbol,
        companyName: r.stock.companyName,
        kind: r.kind,
        threshold: r.threshold != null ? Number(r.threshold) : null,
        description: describeAlert(r.kind, r.threshold != null ? Number(r.threshold) : null),
        cooldownMinutes: r.cooldownMinutes,
        paused: r.paused,
        lastFiredAt: r.lastFiredAt ? r.lastFiredAt.toISOString() : null,
        lastEvent: r.events[0]
          ? {
              firedAt: r.events[0].firedAt.toISOString(),
              message: r.events[0].message,
              deliveryStatus: r.events[0].deliveryStatus,
              error: r.events[0].error,
            }
          : null,
      })),
    });
  }),
);

router.post(
  '/',
  validate(createBody, 'body'),
  asyncHandler(async (req, res) => {
    const token = tokenOf(req)!;
    const body = valid<z.infer<typeof createBody>>(req, 'body');
    const stock = await prisma.stock.findUnique({ where: { symbol: body.symbol.toUpperCase() }, select: { id: true } });
    if (!stock) {
      res.status(404).json({ error: { code: 'UNKNOWN_SYMBOL', message: `Not tracked: ${body.symbol}` } });
      return;
    }
    const row = await prisma.alert.create({
      data: {
        ownerToken: token,
        stockId: stock.id,
        kind: body.kind,
        threshold: body.threshold ?? null,
        cooldownMinutes: body.cooldownMinutes,
      },
      select: { id: true },
    });
    res.status(201).json({ id: row.id });
  }),
);

router.patch(
  '/:id',
  validate(patchBody, 'body'),
  asyncHandler(async (req, res) => {
    const token = tokenOf(req)!;
    const { paused } = valid<z.infer<typeof patchBody>>(req, 'body');
    const existing = await prisma.alert.findFirst({ where: { id: req.params.id, ownerToken: token }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such alert for this device' } });
      return;
    }
    await prisma.alert.update({ where: { id: existing.id }, data: { paused } });
    res.json({ id: existing.id, paused });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const token = tokenOf(req)!;
    const deleted = await prisma.alert.deleteMany({ where: { id: req.params.id, ownerToken: token } });
    if (deleted.count === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such alert for this device' } });
      return;
    }
    res.status(204).end();
  }),
);

/**
 * Evaluates every alert this device owns and stores what fired.
 *
 * The app has no scheduler, so this runs when the alerts page opens (and while it stays open). That
 * is stated in the UI rather than implied — an alert that says "evaluated 4 minutes ago" is honest
 * about when it was actually checked.
 */
router.post(
  '/evaluate',
  asyncHandler(async (req, res) => {
    const token = tokenOf(req)!;
    const alerts = await prisma.alert.findMany({
      where: { ownerToken: token, paused: false },
      select: { id: true, kind: true, threshold: true, paused: true, lastFiredAt: true, cooldownMinutes: true, stockId: true },
    });
    if (alerts.length === 0) {
      res.json({ checked: 0, fired: [] });
      return;
    }

    const stockIds = [...new Set(alerts.map((a) => a.stockId))];
    const stocks = await prisma.stock.findMany({ where: { id: { in: stockIds } }, select: { id: true, symbol: true } });
    const symbolById = new Map(stocks.map((s) => [s.id, s.symbol]));

    // Last two sessions per symbol: today's close and the previous one.
    const prices = await prisma.$queryRaw<Array<{ symbol: string; close: string | null; prev_close: string | null }>>`
      SELECT symbol, close::text, prev_close::text FROM (
        SELECT s.symbol,
               (array_agg(sp.close ORDER BY sp.last_trade_date DESC))[1] AS close,
               (array_agg(sp.close ORDER BY sp.last_trade_date DESC))[2] AS prev_close
        FROM stock_prices sp
        JOIN stocks s ON s.id = sp.stock_id
        WHERE sp.stock_id = ANY(${stockIds}::text[])
        GROUP BY s.symbol
      ) t
    `;
    const priceBySymbol = new Map(
      prices.map((p) => [p.symbol, { close: p.close != null ? Number(p.close) : null, prev: p.prev_close != null ? Number(p.prev_close) : null }]),
    );

    const universe = await technicalUniverse();
    const techBySymbol = universe.rows;

    const now = new Date();
    const fired: { id: string; message: string }[] = [];

    for (const a of alerts) {
      const symbol = symbolById.get(a.stockId);
      if (!symbol) continue;
      const price = priceBySymbol.get(symbol);
      const tech = techBySymbol.get(symbol);
      const ctx: MarketContext = {
        symbol,
        price: price?.close ?? null,
        prevClose: price?.prev ?? null,
        rsi: tech?.rsi ?? null,
        sma50: tech?.sma50 ?? null,
        prevSma50: null,
        sma200: tech?.sma200 ?? null,
        prevSma200: null,
      };
      const like: AlertLike = {
        id: a.id,
        kind: a.kind,
        threshold: a.threshold != null ? Number(a.threshold) : null,
        paused: a.paused,
        lastFiredAt: a.lastFiredAt,
        cooldownMinutes: a.cooldownMinutes,
      };
      const ev = evaluateAlert(like, ctx, now);
      if (!ev) continue;
      try {
        await prisma.$transaction([
          prisma.alertEvent.create({
            data: { alertId: a.id, value: ev.value, message: ev.message, channel: 'in-app', deliveryStatus: 'stored' },
          }),
          prisma.alert.update({ where: { id: a.id }, data: { lastFiredAt: now } }),
        ]);
        fired.push({ id: a.id, message: ev.message });
      } catch (err) {
        // A delivery failure is recorded, not swallowed: an alert that never arrived is worse than a late one.
        await prisma.alertEvent.create({
          data: {
            alertId: a.id,
            value: ev.value,
            message: ev.message,
            channel: 'in-app',
            deliveryStatus: 'failed',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    res.json({ checked: alerts.length, fired });
  }),
);

export default router;
