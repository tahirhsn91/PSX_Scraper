import { DATA_SOURCES, disabledSourceIds, isSourceEnabled, unknownDisabledIds } from '../data-sources';
import { sourceHealthRepository, SourceHealthRow } from '../repositories/sourceHealth.repository';

/**
 * The registry as an operator sees it: every source, whether it is enabled, what it is licensed for,
 * and how it has actually behaved.
 *
 * A source that has never been attempted returns `null` timestamps and a zero error rate rather than
 * being hidden — "no data yet" and "healthy" must not look the same.
 */
export function listDataSources(health: SourceHealthRow[]) {
  const byId = new Map(health.map((h) => [h.source, h]));

  const sources = DATA_SOURCES.map((s) => {
    const h = byId.get(s.id);
    const attempts = (h?.successCount ?? 0) + (h?.failureCount ?? 0);
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      provides: s.provides,
      hosts: s.hosts,
      files: s.files,
      licence: s.licence,
      rateLimit: s.rateLimit ?? null,
      enabled: isSourceEnabled(s.id),
      lastSuccessAt: h?.lastSuccessAt ?? null,
      lastFailureAt: h?.lastFailureAt ?? null,
      lastError: h?.lastError ?? null,
      successCount: h?.successCount ?? 0,
      failureCount: h?.failureCount ?? 0,
      attempts,
      // Rounded to 4 dp; a source with no attempts is 0, and `attempts` says whether to trust it.
      errorRate: attempts === 0 ? 0 : Math.round((h!.failureCount / attempts) * 10000) / 10000,
    };
  });

  return {
    sources,
    disabled: disabledSourceIds(),
    // A typo in DATA_SOURCES_DISABLED disables nothing; say so instead of failing quietly.
    unknownDisabledIds: unknownDisabledIds(),
    unlicensedCount: sources.filter((s) => s.licence.status === 'unconfirmed').length,
  };
}

export async function getDataSourcesView() {
  return listDataSources(await sourceHealthRepository.list());
}
