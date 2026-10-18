import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_SOURCES, disabledSourceIds, isSourceEnabled, unknownDisabledIds } from '../src/data-sources';
import { scraperRegistry } from '../src/scrapers/registry';
import { listDataSources } from '../src/services/dataSources.service';
import { sourceHealthRepository } from '../src/repositories/sourceHealth.repository';

/**
 * The data-source registry (#214).
 *
 * The test that matters is the coverage one: a scraper file that no registry row claims is a source
 * nobody has recorded a licence position for, and that is exactly how this goes wrong.
 */

const SCRAPERS_DIR = join(__dirname, '..', 'src', 'scrapers');

/** Files under src/scrapers that are infrastructure rather than a source. */
const INFRASTRUCTURE = new Set([
  'browserPool.ts',
  'orchestrator.ts',
  'parse.utils.ts',
  'registry.ts',
  'result.schema.ts',
]);

describe('registry coverage', () => {
  it('maps every scraper file to exactly one source', () => {
    const claimed = new Map<string, string[]>();
    for (const s of DATA_SOURCES) {
      for (const f of s.files) {
        claimed.set(f, [...(claimed.get(f) ?? []), s.id]);
      }
    }

    const files = readdirSync(SCRAPERS_DIR).filter((f) => f.endsWith('.ts') && !INFRASTRUCTURE.has(f));
    const unclaimed = files.filter((f) => !claimed.has(f));
    const doubleClaimed = [...claimed.entries()].filter(([, ids]) => ids.length > 1);
    const missing = [...claimed.keys()].filter((f) => !existsSync(join(SCRAPERS_DIR, f)));

    // An unclaimed scraper means nobody wrote down where that data comes from.
    expect(unclaimed).toEqual([]);
    expect(doubleClaimed).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('records a licence position for every source, even if unconfirmed', () => {
    for (const s of DATA_SOURCES) {
      expect(s.licence.status).toBeTruthy();
      expect(s.licence.notes.length).toBeGreaterThan(10);
    }
    // Nothing in this repo is licensed for redistribution; the view must not pretend otherwise.
    const confirmed = DATA_SOURCES.filter((s) => s.licence.status === 'permitted');
    expect(confirmed.map((s) => s.id)).toEqual([]);
  });

  it('has unique source ids', () => {
    const ids = DATA_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('disabling a source', () => {
  const original = process.env.DATA_SOURCES_DISABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.DATA_SOURCES_DISABLED;
    else process.env.DATA_SOURCES_DISABLED = original;
  });

  it('takes the provider out of the pipeline without a code change', () => {
    process.env.DATA_SOURCES_DISABLED = 'psx';
    expect(isSourceEnabled('psx')).toBe(false);
    expect(isSourceEnabled('sarmaaya')).toBe(true);
    const running = scraperRegistry.enabled().map((s) => s.source);
    expect(running).not.toContain('psx');
    expect(running).toContain('sarmaaya');
  });

  it('parses a comma-separated list with spaces', () => {
    process.env.DATA_SOURCES_DISABLED = ' psx , sarmaaya-fundamentals ';
    expect(disabledSourceIds()).toEqual(['psx', 'sarmaaya-fundamentals']);
  });

  it('reports a typo instead of silently disabling nothing', () => {
    process.env.DATA_SOURCES_DISABLED = 'psx,not-a-source';
    expect(unknownDisabledIds()).toEqual(['not-a-source']);
  });
});

describe('operator view', () => {
  it('shows a never-attempted source as unattempted, not healthy', () => {
    const view = listDataSources([]);
    const row = view.sources.find((s) => s.id === 'psx')!;
    expect(row.attempts).toBe(0);
    expect(row.errorRate).toBe(0);
    expect(row.lastSuccessAt).toBeNull();
    expect(view.unlicensedCount).toBe(DATA_SOURCES.length);
  });

  it('computes an error rate from recorded attempts', () => {
    const view = listDataSources([
      {
        source: 'psx',
        lastSuccessAt: new Date('2026-10-18T00:00:00Z'),
        lastFailureAt: new Date('2026-10-18T01:00:00Z'),
        lastError: 'timeout',
        successCount: 3,
        failureCount: 1,
        updatedAt: new Date('2026-10-18T01:00:00Z'),
      },
    ]);
    const row = view.sources.find((s) => s.id === 'psx')!;
    expect(row.attempts).toBe(4);
    expect(row.errorRate).toBe(0.25);
    expect(row.lastError).toBe('timeout');
  });
});

describe('health persistence', () => {
  afterAll(async () => {
    await sourceHealthRepository.clear('psx');
  });

  it('counts successes and failures per source', async () => {
    await sourceHealthRepository.clear('psx');
    await sourceHealthRepository.record([
      { source: 'psx', ok: true },
      { source: 'psx', ok: true },
      { source: 'psx', ok: false, error: 'boom' },
    ]);

    const rows = await sourceHealthRepository.list();
    const psx = rows.find((r) => r.source === 'psx')!;
    expect(psx.successCount).toBe(2);
    expect(psx.failureCount).toBe(1);
    expect(psx.lastError).toBe('boom');
    expect(psx.lastSuccessAt).toBeInstanceOf(Date);
    expect(psx.lastFailureAt).toBeInstanceOf(Date);
  });
});
