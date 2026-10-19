import { betaService, type BetaResult } from './beta.service';
import { getSectorRatioRows } from '../repositories/fundamentals.repository';
import { peerStatsOf, type PeerStats } from './fundamentals.service';
import { cacheGet, cacheSet } from './cache';
import { env } from '../config';

/**
 * Cache-aside for a sector's peer statistics (each metric's sorted values, used for percentile
 * ranking). Every stock in a sector scores against the *same* distribution — repeated work per
 * visitor with a result that changes only when a sync writes a new ratio row. The pure maths stays
 * in `fundamentals.service.ts` (unit-tested without a cache or database).
 */
export async function getCachedSectorPeerStats(sector: string): Promise<PeerStats> {
  const key = `sector-peers:v2:${sector.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const cached = await cacheGet<PeerStats>(key);
  if (cached) return cached;
  const peer = peerStatsOf(sector, await getSectorRatioRows(sector));
  await cacheSet(key, peer, env.SECTOR_MEDIANS_CACHE_TTL);
  return peer;
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
