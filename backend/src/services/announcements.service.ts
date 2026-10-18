import { createHash } from 'node:crypto';
import { prisma } from '../database/prisma';

/**
 * Official notices.
 *
 * Two rules shape this module:
 *
 * 1. **A notice is stored by its source identity, never by its contents.** The dedupe key is unique
 *    with `source`, so re-running the ingestor updates a row instead of adding a second copy. A
 *    running sync that re-reads yesterday's page must not double the archive.
 * 2. **Category is mapped, not trusted.** Sources name categories inconsistently ("Board Meeting",
 *    "board meeting (other than financial results)"); the mapper normalises to a small vocabulary and
 *    keeps anything it does not recognise as `OTHER` rather than dropping the notice.
 */

export const ANNOUNCEMENT_CATEGORIES = [
  'RESULTS',
  'DIVIDEND',
  'BOARD_MEETING',
  'MATERIAL_DISCLOSURE',
  'CORPORATE_ACTION',
  'OTHER',
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

const CATEGORY_RULES: { match: RegExp; category: AnnouncementCategory }[] = [
  { match: /dividend|payout|bonus share/i, category: 'DIVIDEND' },
  { match: /board meeting/i, category: 'BOARD_MEETING' },
  { match: /financial result|results|earnings|profit/i, category: 'RESULTS' },
  { match: /split|rights|bonus issue|book closure|corporate action/i, category: 'CORPORATE_ACTION' },
  { match: /material|disclosure|insider|acquisition|merger/i, category: 'MATERIAL_DISCLOSURE' },
];

/** Maps a source's free-text category onto the vocabulary above. Unknown text becomes OTHER. */
export function mapCategory(raw: string | null | undefined): AnnouncementCategory {
  const text = (raw ?? '').trim();
  if (!text) return 'OTHER';
  for (const rule of CATEGORY_RULES) if (rule.match.test(text)) return rule.category;
  return 'OTHER';
}

export interface IncomingAnnouncement {
  /** Ticker, or null for a market-wide notice. */
  symbol: string | null;
  category: string | null;
  title: string;
  summary?: string | null;
  body?: string | null;
  publishedAt: Date;
  source: string;
  sourceUrl: string;
  /** The source's own id for the notice, when it has one. */
  sourceId?: string | null;
}

/** A stable identity for a notice, used when the source has no id of its own. */
export function dedupeKeyFor(a: IncomingAnnouncement): string {
  if (a.sourceId) return a.sourceId;
  return createHash('sha1')
    .update([a.symbol ?? '', a.title.trim(), a.publishedAt.toISOString().slice(0, 10)].join('|'))
    .digest('hex');
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Stores notices idempotently. A row whose (source, dedupeKey) already exists is updated in place —
 * a corrected headline replaces the old one instead of appearing twice.
 *
 * Rows whose symbol is not tracked are stored with `stockId = null` **and kept**: the notice is real
 * even when the symbol is one we do not follow, and discarding it would quietly lose the archive.
 */
export async function upsertAnnouncements(items: IncomingAnnouncement[]): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, skipped: 0 };
  if (items.length === 0) return result;

  const symbols = [...new Set(items.map((i) => i.symbol).filter((s): s is string => !!s))];
  const stocks = symbols.length
    ? await prisma.stock.findMany({ where: { symbol: { in: symbols } }, select: { id: true, symbol: true } })
    : [];
  const idBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));

  for (const item of items) {
    const dedupeKey = dedupeKeyFor(item);
    const data = {
      stockId: item.symbol ? (idBySymbol.get(item.symbol) ?? null) : null,
      category: mapCategory(item.category),
      title: item.title.trim(),
      summary: item.summary ?? null,
      body: item.body ?? null,
      publishedAt: item.publishedAt,
      source: item.source,
      sourceUrl: item.sourceUrl,
      dedupeKey,
    };
    try {
      const existing = await prisma.announcement.findUnique({
        where: { source_dedupeKey: { source: item.source, dedupeKey } },
        select: { id: true },
      });
      if (existing) {
        await prisma.announcement.update({ where: { id: existing.id }, data });
        result.updated += 1;
      } else {
        await prisma.announcement.create({ data });
        result.inserted += 1;
      }
    } catch {
      // One bad row must not abort the batch; it is counted and the rest continue.
      result.skipped += 1;
    }
  }
  return result;
}

export interface AnnouncementQuery {
  symbol?: string;
  category?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export async function listAnnouncements(q: AnnouncementQuery) {
  const where = {
    ...(q.symbol ? { stock: { symbol: q.symbol.toUpperCase() } } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.from || q.to
      ? { publishedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true,
        title: true,
        summary: true,
        category: true,
        publishedAt: true,
        source: true,
        sourceUrl: true,
        stock: { select: { symbol: true, companyName: true } },
      },
    }),
  ]);

  return {
    total,
    page: q.page,
    limit: q.limit,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      category: r.category,
      publishedAt: r.publishedAt.toISOString(),
      source: r.source,
      sourceUrl: r.sourceUrl,
      symbol: r.stock?.symbol ?? null,
      companyName: r.stock?.companyName ?? null,
    })),
  };
}
