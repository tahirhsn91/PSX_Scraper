import { betaService, type BetaResult } from './beta.service';
import { getSectorRatioRows } from '../repositories/fundamentals.repository';
import { mediansOf, type SectorMedians } from './fundamentals.service';
import { cacheGet, cacheSet } from './cache';
import { env } from '../config';

/**
 * Cache-aside for a sector's median ratios. The Fundamentals panel compares a stock against its
 * peers' medians, and every stock in a sector computes the *same* medians — so this is repeated
 * work per visitor with a result that changes only when a sync writes a new ratio row. The pure
 * median maths stays in `fundamentals.service.ts` (unit-tested without a cache or database).
 */
export async function getCachedSectorMedians(sector: string): Promise<SectorMedians> {
  const key = `sector-medians:v1:${sector.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const cached = await cacheGet<SectorMedians>(key);
  if (cached) return cached;
  const medians = mediansOf(await getSectorRatioRows(sector));
  await cacheSet(key, medians, env.SECTOR_MEDIANS_CACHE_TTL);
  return medians;
}

/**
 * Cache-aside for a symbol's beta on the read path. The write path (`betaService.refreshSymbol`)
 * still calls `forSymbol` directly and always recomputes, so a sync never stores a value read back
 * from this cache; only a detail view serves a cached value (up to `BETA_CACHE_TTL` stale).
 */
export async function getCachedBeta(symbol: string): Promise<BetaResult> {
  const key = `beta:v1:${symbol.toUpperCase()}`;
  const cached = await cacheGet<BetaResult>(key);
  if (cached) return cached;
  const beta = await betaService.forSymbol(symbol);
  await cacheSet(key, beta, env.BETA_CACHE_TTL);
  return beta;
}
