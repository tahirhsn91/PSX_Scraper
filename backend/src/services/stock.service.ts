import { Prisma } from '@prisma/client';
import {
  stockRepository, StockSortField, SortOrder, StockListGroup,
} from '../repositories/stock.repository';
import { deletedSymbolRepository } from '../repositories/deletedSymbol.repository';
import { indexRepository } from '../repositories/index.repository';
import { kse100GroupCounts } from './kse100Membership.service';
import {
  getStockDetail, getPriceHistory, getCandles, type Candle,
} from '../repositories/stockDetail.repository';
import { scoreFundamentals } from './fundamentals.service';
import { getCachedSectorMedians, getCachedBeta } from './detailCache';
import { enqueueSync, cancelSyncJob } from '../jobs/queues';
import { ConflictError, NotFoundError, ValidationError } from '../types/errors';
import { rangeToFrom, HistoryRange } from '../utils/range';
import { logger } from '../utils/logger';

const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

export const stockService = {
  /**
   * A page of the tracked universe.
   *
   * `group` splits the universe for the dashboard: `kse100` is page one (the index's members) and
   * `rest` is everything else. `index` narrows the list to one named index's tracked members and
   * wins over `group` when both are sent — the two are different questions, and intersecting them
   * would answer an empty page for every index but KSE100.
   *
   * An index symbol we do not know is a 400 naming it. That matters more than it looks: before
   * this, `index=KMI30` was simply ignored and the endpoint answered 200 with all 508 rows, so a
   * selector built on it looked like it worked while showing the wrong data. There is no way to
   * tell that from the response, so it must not be a 200.
   *
   * When either filter is asked for, the response also carries both group counts, because the
   * dashboard's universe card sums them to the whole tracked universe whatever the list shows —
   * `total` is the *filtered* count, `groups` is the universe.
   */
  async list(
    page: number,
    limit: number,
    sort?: StockSortField,
    order: SortOrder = 'asc',
    group?: StockListGroup,
    index?: string,
  ) {
    const offset = (page - 1) * limit;
    if (index && !(await indexRepository.findBySymbol(index))) {
      throw new ValidationError(`Unknown index: ${index}`);
    }
    const [{ items, total }, groups] = await Promise.all([
      stockRepository.list(limit, offset, sort, order, group, index),
      index || group ? kse100GroupCounts() : Promise.resolve(undefined),
    ]);
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      ...(groups ? { groups: { kse100: groups.members, rest: groups.rest } } : {}),
    };
  },

  async getDetail(symbol: string) {
    const s = await getStockDetail(symbol);
    if (!s) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    // Beta (#79): measured from our own daily closes against the KSE-100, and computed *here*
    // rather than read back from the column so that the window printed beside the value is exactly
    // the window the value came from — the same function's output is what the sync stores in
    // `ratios.beta`. Below the minimum aligned sessions it is null with the reason attached: a dash,
    // never a figure derived from a handful of days.
    const beta = await getCachedBeta(s.symbol);
    const price = s.prices[0];
    const ratio = s.ratios[0];
    // `dividends` arrives newest announcement first, so the first row is the newest one the source
    // has published. The two top-level fields are that row spelled out for the valuation card
    // ("Next Dividend" and its date row); the `dividends` array below keeps its existing shape, so
    // nothing that already reads it changes.
    //
    // The date is the **announcement** date — no reachable source publishes an ex-date (#79), and
    // the card says so in a note rather than presenting one as the other. Both stay null for a
    // symbol with no dividend on record: a dash, never a zero and never a borrowed figure.
    const newestDividend = s.dividends[0];
    // Fundamentals insights (#131): score the stock's ratios against its sector's medians and the
    // fixed benchmarks. A stock with no ratios, or whose sector is missing or the data defect
    // `"undefined"`, gets `null` (the UI hides the block rather than inventing a score).
    const ratioMap: Record<string, number | null> | null = ratio
      ? {
          eps: num(ratio.eps), peRatio: num(ratio.peRatio), bookValue: num(ratio.bookValue),
          pbRatio: num(ratio.pbRatio), dividendYield: num(ratio.dividendYield),
          dps: num(ratio.dps), payoutRatio: num(ratio.payoutRatio), roe: num(ratio.roe),
          roa: num(ratio.roa), roic: num(ratio.roic), debtToEquity: num(ratio.debtToEquity),
          currentRatio: num(ratio.currentRatio), netProfitMargin: num(ratio.netProfitMargin),
          revenueGrowth: num(ratio.revenueGrowth), epsGrowth: num(ratio.epsGrowth),
          freeFloatShares: num(ratio.freeFloatShares), freeFloatPercent: num(ratio.freeFloatPercent),
        }
      : null;
    const insights =
      ratioMap && s.sector && s.sector !== 'undefined'
        ? scoreFundamentals(ratioMap, await getCachedSectorMedians(s.sector))
        : null;
    return {
      id: s.id,
      symbol: s.symbol,
      companyName: s.companyName,
      sector: s.sector,
      price: price
        ? {
            currentPrice: num(price.currentPrice),
            change: num(price.change),
            changePercent: num(price.changePercent),
            volume: price.volume != null ? Number(price.volume) : null,
            high: num(price.high),
            low: num(price.low),
            open: num(price.open),
            close: num(price.close),
            marketCap: num(price.marketCap),
            week52High: num(price.week52High),
            week52Low: num(price.week52Low),
            lastTradeDate: price.lastTradeDate,
          }
        : null,
      ratios: ratio
        ? {
            peRatio: num(ratio.peRatio), pbRatio: num(ratio.pbRatio), roe: num(ratio.roe),
            roa: num(ratio.roa), dividendYield: num(ratio.dividendYield),
            // Book value per share (#79): one column, read from the source's own ratio series.
            bookValue: num(ratio.bookValue),
            // Earnings per share: the source's own snapshot figure, which its stock page prints.
            eps: num(ratio.eps),
            // Beta: our own measurement (see `beta` below), so the card and the dedicated block
            // cannot disagree. Null — the dash — when the history is too thin to measure one.
            beta: beta.value,
            // Fundamentals (#131). Absent reads null — the dash, never a zero.
            netProfitMargin: num(ratio.netProfitMargin),
            freeFloatShares: num(ratio.freeFloatShares),
            freeFloatPercent: num(ratio.freeFloatPercent),
            dps: num(ratio.dps),
            payoutRatio: num(ratio.payoutRatio),
            roic: num(ratio.roic),
            debtToEquity: num(ratio.debtToEquity),
            currentRatio: num(ratio.currentRatio),
            revenueGrowth: num(ratio.revenueGrowth),
            epsGrowth: num(ratio.epsGrowth),
          }
        : null,
      // Beta, with the window it was measured over (#79, criterion 7). Reported here as its own
      // block so the value and the sessions behind it travel together: the UI can print
      // "0.8942 · 1Y · 250 sessions" without assuming a window, and `reason` explains the dash.
      beta: {
        value: beta.value,
        index: beta.window.index,
        method: beta.method,
        reason: beta.reason,
        window: beta.window,
      },
      // Book value per share (#79). Served top-level as the issue specifies, as well as inside
      // `ratios`: the app reads it at the top level, and a symbol whose source publishes none still
      // reads null (the dash), never 0.
      bookValue: ratio ? num(ratio.bookValue) : null,
      // Earnings per share, also served top-level so the app can read it without knowing which table
      // it lives in. A symbol whose source publishes none reads null (the dash), never 0.
      eps: ratio ? num(ratio.eps) : null,
      nextDividendDate: newestDividend?.announcementDate ?? null,
      nextDividendAmount: num(newestDividend?.dividend ?? null),
      financials: s.financials.map((f) => ({
        year: f.year, quarter: f.quarter, eps: num(f.eps), sales: num(f.sales),
        profitAfterTax: num(f.profitAfterTax), assets: num(f.assets),
        liabilities: num(f.liabilities), equity: num(f.equity),
      })),
      dividends: s.dividends.map((d) => ({
        announcementDate: d.announcementDate, bookClosure: d.bookClosure,
        paymentDate: d.paymentDate, dividend: num(d.dividend),
      })),
      // Fundamentals scoring (#131): 0-100 split into current and future, plus the outlook verdict.
      insights,
      lastSync: s.syncLogs[0]
        ? { status: s.syncLogs[0].status, completedAt: s.syncLogs[0].completedAt, startedAt: s.syncLogs[0].startedAt }
        : null,
    };
  },

  /**
   * Track a symbol — unless a human removed it and the caller has not said it means to override.
   *
   * This endpoint is what an automated client reaches for when it cannot find a symbol, and that is
   * indistinguishable from a person clicking Add: observed live, PSX_Portfolio_Manager answered its
   * own 404 with a `POST /api/v1/stocks` and put a delisted symbol back on the dashboard every time
   * the page was opened. A removal therefore only yields to a caller that asks for it explicitly.
   */
  async add(symbol: string, options: { force?: boolean } = {}) {
    const sym = symbol.toUpperCase();
    const existing = await stockRepository.findBySymbol(sym);
    if (existing) throw new ConflictError(`Stock already tracked: ${sym}`);
    if (!options.force && (await deletedSymbolRepository.isDeleted(sym))) {
      throw new ConflictError(`Stock was removed and is not re-added automatically: ${sym}`);
    }
    const stock = await stockRepository.create(sym);
    // Adding by hand overrides a previous removal: the operator is telling us it belongs here.
    await deletedSymbolRepository.forget(sym);
    const job = await enqueueSync(sym, 'add');
    return { stock, jobId: job.id };
  },

  async remove(symbol: string, reason?: string) {
    const sym = symbol.toUpperCase();
    const existing = await stockRepository.findBySymbol(symbol);
    if (!existing) throw new NotFoundError(`Stock not tracked: ${sym}`);
    // Cancel the symbol's sync job BEFORE dropping the row. The scraper persists through
    // `stock.upsert`, so a job still queued for this symbol re-creates the stock that was just
    // deleted — the reason a removed symbol kept coming back. Order matters: cancel, then
    // delete, so nothing can be in flight when the row goes.
    const cancelled = await cancelSyncJob(sym);
    if (cancelled === 'active') {
      logger.warn('stocks.remove_sync_still_running', { symbol: sym });
    }
    await stockRepository.delete(symbol);
    // Remember it. Order matters here too: record only once the row is actually gone, so a failed
    // delete cannot leave a tombstone denying a symbol that is still tracked.
    await deletedSymbolRepository.record(sym, reason);
  },

  /**
   * Daily candles for the chart, oldest first.
   *
   * No dates means "every session we hold" — the chart's default request, and what makes the
   * view open on the earliest day on record rather than a fixed window.
   */
  async candles(symbol: string, opts: { interval?: '1D'; range?: HistoryRange; from?: Date; to?: Date }) {
    // A range preset wins over an explicit from, matching how /history resolves it.
    const from = opts.range ? rangeToFrom(opts.range) : opts.from;
    const res = await getCandles(symbol, from, opts.to);
    if (res === null) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    const items: Candle[] = res.items;
    return {
      symbol: symbol.toUpperCase(),
      interval: opts.interval ?? '1D',
      range: opts.range ?? null,
      count: items.length,
      // Readings thrown away, and readings kept with implausible fields nulled (see
      // buildCandles). Both are reported so contaminated sessions are visible in the response
      // rather than quietly drawn as if they were real.
      skipped: res.skipped,
      sanitised: res.sanitised,
      // Nulls rather than omitted keys: the chart can then tell "this symbol has no history"
      // apart from "your range is outside our data".
      from: items[0]?.time ?? null,
      to: items[items.length - 1]?.time ?? null,
      items,
    };
  },

  async history(symbol: string, opts: { range?: HistoryRange; from?: Date; to?: Date; page?: number; limit?: number }) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 2000;
    // A range preset takes precedence over an explicit `from`.
    const from = opts.range ? rangeToFrom(opts.range) : opts.from;
    const offset = (page - 1) * limit;
    const res = await getPriceHistory(symbol, from, opts.to, limit, offset);
    if (res === null) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    return {
      items: res.items.map((p) => ({
        currentPrice: num(p.currentPrice), open: num(p.open), high: num(p.high),
        low: num(p.low), close: num(p.close), volume: p.volume != null ? Number(p.volume) : null,
        lastTradeDate: p.lastTradeDate,
      })),
      page, limit, total: res.total, totalPages: Math.ceil(res.total / limit),
    };
  },
};
