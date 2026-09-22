import { childLogger } from './logger';
import {
  NavigationTimeoutError,
  SiteUnavailableError,
  SourceCoolingDownError,
} from '../types/errors';

/**
 * Per-source back-off for sources that are refusing us.
 *
 * Why this exists (see #27): `dps.psx.com.pk` answers `http=000` — TLS completes, then the
 * connection is closed with no response — on its data paths, while `/` keeps answering 200.
 * That is a WAF/rate-limit rule, not an outage, and it is earned by request volume. Without a
 * breaker every tick and every scheduled job keeps sending doomed requests: on 2026-09-22 the
 * index cron alone had put 200 failures in `bull:index-sync:failed`, one per index per tick,
 * and each retry made the next refusal more likely.
 *
 * Semantics: count *consecutive availability failures* per source (a refusal or a timeout —
 * never a 404 or a parse error, those are not the source refusing). On the `threshold`-th
 * consecutive failure the breaker opens for `baseCooldownMs`, and every further trip doubles
 * that window up to `maxCooldownMs`. An open breaker makes `assertAvailable()` throw before a
 * request leaves the process. When the window elapses the next request is a probe: it is
 * allowed through, a failure re-trips at the next (longer) cooldown, and a success clears the
 * count.
 *
 * Deliberately in-process and dependency-free: the breaker protects one worker's request rate,
 * and it is rebuilt on restart. `/sync/status` reads `state()` to report it.
 */
export interface SourceBreakerOptions {
  /** Consecutive availability failures that trip the breaker. Default 5. */
  threshold?: number;
  /** First cooldown; doubles per further trip, capped at `maxCooldownMs`. Default 5 min. */
  baseCooldownMs?: number;
  /** Ceiling for the cooldown. Default 60 min. */
  maxCooldownMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export interface SourceBreakerState {
  source: string;
  /** Consecutive availability failures since the last success. */
  failures: number;
  coolingDown: boolean;
  /** How many times the breaker has opened for this source. */
  opens: number;
  /** ISO time the cooldown ends, or null when the source is not cooling down. */
  resumeAt: string | null;
  lastError: string | null;
}

interface Entry {
  failures: number;
  opens: number;
  openUntil: number;
  lastError: string | null;
}

export class SourceBreaker {
  private readonly entries = new Map<string, Entry>();
  private readonly threshold: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;
  private readonly log = childLogger({ op: 'source-breaker' });

  constructor(opts: SourceBreakerOptions = {}) {
    this.threshold = Math.max(1, opts.threshold ?? 5);
    this.baseCooldownMs = Math.max(0, opts.baseCooldownMs ?? 5 * 60_000);
    this.maxCooldownMs = Math.max(this.baseCooldownMs, opts.maxCooldownMs ?? 60 * 60_000);
    this.now = opts.now ?? (() => Date.now());
  }

  /** True while the source is serving its cooldown — no request may be sent to it. */
  isCoolingDown(source: string): boolean {
    const entry = this.entries.get(source);
    return entry !== undefined && entry.openUntil > this.now();
  }

  /** When the current cooldown ends, or null. */
  resumeAt(source: string): Date | null {
    const entry = this.entries.get(source);
    if (!entry || entry.openUntil <= this.now()) return null;
    return new Date(entry.openUntil);
  }

  /**
   * Guard for every request to the source. Throws instead of letting a doomed request out.
   * An elapsed cooldown is a probe: it is allowed through so the source can prove it recovered.
   */
  assertAvailable(source: string): void {
    const resumeAt = this.resumeAt(source);
    if (resumeAt) throw new SourceCoolingDownError(source, resumeAt);
  }

  /**
   * Record a refusal or a timeout. Returns true when this failure opened (or re-opened) the
   * breaker, so a caller can log the trip once instead of per symbol.
   */
  recordFailure(source: string, error: string): boolean {
    const now = this.now();
    const entry = this.entries.get(source) ?? { failures: 0, opens: 0, openUntil: 0, lastError: null };
    entry.failures += 1;
    entry.lastError = error;

    if (entry.openUntil > now || entry.failures < this.threshold) {
      this.entries.set(source, entry);
      return false;
    }

    entry.opens += 1;
    const cooldownMs = Math.min(this.baseCooldownMs * 2 ** (entry.opens - 1), this.maxCooldownMs);
    entry.openUntil = now + cooldownMs;
    this.entries.set(source, entry);
    this.log.warn('source.cooling_down', {
      source,
      failures: entry.failures,
      opens: entry.opens,
      cooldownMs,
      resumeAt: new Date(entry.openUntil).toISOString(),
      error,
    });
    return true;
  }

  /** Record a response the source actually served — clears the failure count. */
  recordSuccess(source: string): void {
    const entry = this.entries.get(source);
    if (!entry) return;
    if (entry.failures > 0) {
      this.log.info('source.recovered', {
        source,
        afterFailures: entry.failures,
        opens: entry.opens,
      });
    }
    // Keep `opens`: how often a source tripped is worth reporting; the failure run is what
    // recovery resets.
    this.entries.set(source, { failures: 0, opens: entry.opens, openUntil: 0, lastError: null });
  }

  /** Every source the breaker has seen, for `/sync/status`. */
  state(): SourceBreakerState[] {
    const now = this.now();
    return [...this.entries.entries()]
      .filter(([, e]) => e.failures > 0 || e.openUntil > now)
      .map(([source, e]) => ({
        source,
        failures: e.failures,
        coolingDown: e.openUntil > now,
        opens: e.opens,
        resumeAt: e.openUntil > now ? new Date(e.openUntil).toISOString() : null,
        lastError: e.lastError,
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  /** Drop all state (tests, and a manual reset if one is ever exposed). */
  reset(): void {
    this.entries.clear();
  }
}

export const sourceBreaker = new SourceBreaker();

/**
 * Count a request outcome against the source, if it was the source refusing us.
 *
 * Only an unavailable source or a timeout counts. A 404 means the symbol is wrong and a parse
 * error means our extractor is — neither is the source declining to serve us, and backing off
 * over them would hide a real bug behind a cooldown.
 */
export function recordSourceFailure(source: string, err: unknown): void {
  if (!(err instanceof SiteUnavailableError) && !(err instanceof NavigationTimeoutError)) return;
  sourceBreaker.recordFailure(source, err.message);
}
