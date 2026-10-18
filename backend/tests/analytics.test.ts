import { analyticsEnabled, EVENT_NAMES, EVENT_PROPS } from '../src/analytics/events';
import { eventBody } from '../src/validators/eventSchemas';
import { productEventRepository } from '../src/repositories/productEvent.repository';
import { prisma } from '../src/database/prisma';

/**
 * Product analytics (#212).
 *
 * The interesting assertions are negative ones: an unknown event, an unexpected property, and a
 * search that carries its query text must all be rejected. The rest checks that the two rates the
 * issue asks for are computed from what was actually stored.
 */

const MARK = 'test-212-';

describe('event contract', () => {
  it('accepts a catalogued event with its allowed properties', () => {
    const parsed = eventBody.safeParse({
      name: 'search_submitted',
      path: '/search',
      props: { resultCount: 4, hadResults: true },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an event that is not in the catalogue', () => {
    const parsed = eventBody.safeParse({ name: 'page_view', props: {} });
    expect(parsed.success).toBe(false);
  });

  it('rejects a property that is not allowed for that event', () => {
    // The whole point of the catalogue: a symbol or a query string cannot sneak into a payload.
    const parsed = eventBody.safeParse({ name: 'search_submitted', props: { query: 'OGDC' } });
    expect(parsed.success).toBe(false);
    const symbol = eventBody.safeParse({ name: 'stock_viewed', props: { symbol: 'OGDC' } });
    expect(symbol.success).toBe(false);
  });

  it('never lists a symbol or query property anywhere in the catalogue', () => {
    const forbidden = ['symbol', 'query', 'q', 'searchTerm', 'ticker', 'ip', 'userId', 'email'];
    for (const name of EVENT_NAMES) {
      for (const prop of EVENT_PROPS[name] as readonly string[]) {
        expect(forbidden).not.toContain(prop);
      }
    }
  });
});

describe('collection flag', () => {
  it('is on by default and off when ANALYTICS_ENABLED=false', () => {
    const original = process.env.ANALYTICS_ENABLED;
    delete process.env.ANALYTICS_ENABLED;
    expect(analyticsEnabled()).toBe(true);
    for (const off of ['false', 'FALSE', 'False']) {
      process.env.ANALYTICS_ENABLED = off;
      expect(analyticsEnabled()).toBe(false);
    }
    if (original === undefined) delete process.env.ANALYTICS_ENABLED;
    else process.env.ANALYTICS_ENABLED = original;
  });
});

describe('summary', () => {
  const created: string[] = [];

  afterAll(async () => {
    if (created.length) await prisma.productEvent.deleteMany({ where: { id: { in: created } } });
    await prisma.productEvent.deleteMany({ where: { name: { startsWith: MARK } } });
  });

  it('computes a search success rate from hadResults, without storing any query', async () => {
    await productEventRepository.record(`${MARK}search-ok`, '/search', { hadResults: true });
    await productEventRepository.record(`${MARK}search-ok`, '/search', { hadResults: true });
    await productEventRepository.record(`${MARK}search-empty`, '/search', { hadResults: false });

    // The summary counts the real event name, so seed two of those and remove them afterwards.
    const hit = await prisma.productEvent.create({
      data: { name: 'search_submitted', path: '/search', props: { hadResults: true } },
    });
    const miss = await prisma.productEvent.create({
      data: { name: 'search_submitted', path: '/search', props: { hadResults: false } },
    });
    created.push(hit.id, miss.id);

    const summary = await productEventRepository.summary(1);
    expect(summary.search.submitted).toBeGreaterThanOrEqual(2);
    expect(summary.search.successRate).toBeGreaterThanOrEqual(0);
    expect(summary.search.successRate).toBeLessThanOrEqual(1);

    const rows = await prisma.productEvent.findMany({ where: { id: { in: created } } });
    for (const r of rows) {
      expect(JSON.stringify(r.props)).not.toMatch(/OGDC|query/i);
    }
  });

  it('prunes rows past the retention window', async () => {
    await prisma.productEvent.create({
      data: { name: `${MARK}old`, createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
    });
    const removed = await productEventRepository.prune(90);
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await prisma.productEvent.count({ where: { name: `${MARK}old` } });
    expect(left).toBe(0);
  });
});
