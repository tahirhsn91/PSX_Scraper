import { prisma } from '../src/database/prisma';
import {
  dedupeKeyFor,
  mapCategory,
  upsertAnnouncements,
  type IncomingAnnouncement,
} from '../src/services/announcements.service';

const SOURCE = 'test-fixture';

const item = (over: Partial<IncomingAnnouncement> = {}): IncomingAnnouncement => ({
  symbol: null,
  category: 'Board Meeting',
  title: 'Board meeting to consider the annual accounts',
  publishedAt: new Date('2026-10-01T05:00:00Z'),
  source: SOURCE,
  sourceUrl: 'https://example.invalid/notice/1',
  sourceId: 'notice-1',
  ...over,
});

afterAll(async () => {
  await prisma.announcement.deleteMany({ where: { source: SOURCE } });
  await prisma.$disconnect();
});

describe('category mapping', () => {
  it.each([
    ['Dividend', 'DIVIDEND'],
    ['BOARD MEETING', 'BOARD_MEETING'],
    ['Financial Results for the year ended June 30, 2026', 'RESULTS'],
    ['Book Closure', 'CORPORATE_ACTION'],
    ['Material Information', 'MATERIAL_DISCLOSURE'],
    ['Notice of Extraordinary General Meeting', 'OTHER'],
    [null, 'OTHER'],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapCategory(raw as string | null)).toBe(expected);
  });

  it('keeps an unrecognised category instead of dropping the notice', () => {
    expect(mapCategory('Something the exchange invented in 2027')).toBe('OTHER');
  });
});

describe('dedupe keys', () => {
  it('uses the source id when there is one', () => {
    expect(dedupeKeyFor(item({ sourceId: 'abc' }))).toBe('abc');
  });

  it('is stable for the same notice and different for a different day', () => {
    const a = dedupeKeyFor(item({ sourceId: null }));
    const b = dedupeKeyFor(item({ sourceId: null }));
    const c = dedupeKeyFor(item({ sourceId: null, publishedAt: new Date('2026-10-02T05:00:00Z') }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('ingestion is idempotent', () => {
  it('stores each notice once across two runs and updates rather than duplicating', async () => {
    await prisma.announcement.deleteMany({ where: { source: SOURCE } });

    const batch = [
      item({ sourceId: 'n1', title: 'Board meeting' }),
      item({ sourceId: 'n2', title: 'Dividend announcement', category: 'Dividend' }),
      item({ sourceId: 'n3', title: 'Material information', category: 'Material Information' }),
    ];

    const first = await upsertAnnouncements(batch);
    expect(first).toEqual({ inserted: 3, updated: 0, skipped: 0 });

    const second = await upsertAnnouncements([{ ...batch[0]!, title: 'Board meeting (corrected)' }, batch[1]!, batch[2]!]);
    expect(second).toEqual({ inserted: 0, updated: 3, skipped: 0 });

    const rows = await prisma.announcement.findMany({ where: { source: SOURCE } });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.dedupeKey === 'n1')?.title).toBe('Board meeting (corrected)');
  });

  it('stores a notice for an untracked symbol rather than discarding it', async () => {
    await prisma.announcement.deleteMany({ where: { source: SOURCE } });
    const res = await upsertAnnouncements([item({ sourceId: 'ghost', symbol: 'NOTATICKER' })]);
    expect(res.inserted).toBe(1);
    const row = await prisma.announcement.findFirst({ where: { dedupeKey: 'ghost' } });
    expect(row?.stockId).toBeNull();
  });
});
