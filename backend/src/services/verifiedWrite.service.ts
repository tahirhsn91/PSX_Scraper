import type { ScrapeResult } from '../types/dto';
import { persistScrapeResult } from '../repositories/scrapeResult.repository';
import { median, previousCloseBefore, recentVolumes } from '../repositories/stockPrice.repository';
import { env } from '../config';
import { childLogger } from '../utils/logger';
import {
  type ScrapedQuote,
  type VerificationContext,
  type VerificationResult,
  unwrittenVerdicts,
  verifyQuote,
} from './quoteVerification.service';

/**
 * Verify a scrape and write only what passed — the single door every write goes through.
 *
 * This used to live only on the universe path, and the difference showed up in the data: the
 * hourly sync-all wrote SHSML at 354.76 while its own 52-week range was 367–540, i.e. a price
 * *below* the 52-week low, which the checks reject. Two paths with two standards means the
 * dashboard quietly carries whatever the unverified one produced, so the policy lives here and
 * both callers use it.
 */

export interface UnwrittenField {
  field: string;
  status: 'absent' | 'rejected';
  rawValue: number | null;
  reason?: string;
}

export interface VerifiedWrite {
  /** False when the symbol is not a live listing: nothing is written, not even a row. */
  listed: boolean;
  notListedReason?: string;
  written: string[];
  unwritten: UnwrittenField[];
  /** Sync-log status this result implies. */
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

/** Map the orchestrator's price block onto the shape the verifier checks. */
export function toScrapedQuote(symbol: string, result: ScrapeResult): ScrapedQuote {
  const p = result.price;
  return {
    symbol,
    price: p?.currentPrice ?? null,
    change: p?.change ?? null,
    changePercent: p?.changePercent ?? null,
    volume: p?.volume ?? null,
    week52Low: p?.week52Low ?? null,
    week52High: p?.week52High ?? null,
    sessionDate: p?.lastTradeDate ?? null,
  };
}

async function buildContext(stockId: string | null, sessionDate: string | null, now: Date): Promise<VerificationContext> {
  const base: VerificationContext = {
    previousClose: null,
    volumeMedian: null,
    maxVolumeMultiple: env.UNIVERSE_MAX_VOLUME_MULTIPLE,
    maxQuoteAgeDays: env.UNIVERSE_MAX_QUOTE_AGE_DAYS,
    now,
  };
  if (!stockId || !sessionDate) return base;

  const [previousClose, volumes] = await Promise.all([
    previousCloseBefore(stockId, new Date(sessionDate)),
    recentVolumes(stockId),
  ]);
  return { ...base, previousClose, volumeMedian: median(volumes) };
}

/** Null out everything the verifier did not accept, so the write cannot carry a bad value. */
export function applyVerdicts(result: ScrapeResult, verification: VerificationResult): void {
  if (!result.price) return;
  for (const v of unwrittenVerdicts(verification)) {
    switch (v.field) {
      case 'price': result.price.currentPrice = null; break;
      case 'change': result.price.change = null; break;
      case 'changePercent': result.price.changePercent = null; break;
      case 'volume': result.price.volume = null; break;
      case 'week52Low': result.price.week52Low = null; break;
      case 'week52High': result.price.week52High = null; break;
    }
  }
}

/** One line for the sync log: which fields were rejected and why. */
export function rejectionSummary(verification: VerificationResult): string | undefined {
  const rejected = verification.verdicts.filter((v) => v.status === 'rejected');
  if (rejected.length === 0) return undefined;
  return rejected.map((v) => `${v.field}: ${v.reason ?? 'rejected'}`).join('; ');
}

export async function verifyAndPersist(
  result: ScrapeResult,
  opts: { stockId: string | null; now?: Date; log?: ReturnType<typeof childLogger> },
): Promise<VerifiedWrite> {
  const now = opts.now ?? new Date();
  const quote = toScrapedQuote(result.symbol, result);
  const verification = verifyQuote(quote, await buildContext(opts.stockId, quote.sessionDate, now));

  if (!verification.listed) {
    opts.log?.warn('write.not_listed', {
      reason: verification.notListedReason,
      sessionDate: quote.sessionDate,
      price: quote.price,
    });
    return {
      listed: false,
      notListedReason: verification.notListedReason,
      written: [],
      unwritten: [],
      status: 'FAILED',
    };
  }

  const unwritten = unwrittenVerdicts(verification);
  for (const v of unwritten) {
    opts.log?.warn('write.field_unwritten', {
      field: v.field,
      verdict: v.status,
      rawValue: v.rawValue ?? null,
      reason: v.reason,
      sessionDate: quote.sessionDate,
    });
  }

  applyVerdicts(result, verification);
  await persistScrapeResult(result);

  return {
    listed: true,
    written: verification.verdicts.filter((v) => v.status === 'ok').map((v) => v.field),
    unwritten: unwritten.map((v) => ({
      field: v.field,
      status: v.status === 'rejected' ? 'rejected' : 'absent',
      rawValue: v.rawValue ?? null,
      reason: v.reason,
    })),
    status: unwritten.some((v) => v.status === 'rejected') ? 'PARTIAL' : 'SUCCESS',
  };
}
