import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  ScreenerPreset, SectorDetail, IndicatorsResponse, PerformanceResponse, CompareResponse, Paginated, StocksPage, StockListGroup, StockDetail, SearchResult, PriceRow,
  SyncLog, SyncStatus, HistoryRange, HistoryJobStatus, StockSortField, SortOrder, CandleSeries,
  IndexSummary, StockFilters, MarketOverview, SectorSummary, DividendData,
  StockProfileResponse, MarketStatus, MoversPayload, MoverType, MoverPeriod, AnnouncementList, DividendLedger,
} from '../types';

/** Stable string for a filters object, so the query key changes only when the criteria change. */
const filtersKey = (f?: StockFilters): string =>
  f ? JSON.stringify(f, Object.keys(f).sort()) : 'none';

export const keys = {
  // The group and the index belong in the key: page one (the KSE-100) and page two (everything
  // else) are different row sets at the same page number, and so are KMI30's members and ALLSHR's.
  // Without them the second request would be served from the first one's cache — page two showing
  // the index, or KMI30's rows under ALLSHR's name.
  stocks: (
    page: number,
    limit: number,
    sort?: StockSortField,
    order: SortOrder = 'asc',
    group?: StockListGroup,
    index?: string,
    filters?: StockFilters,
  ) => ['stocks', page, limit, sort ?? 'symbol', order, group ?? 'all', index ?? 'none', filtersKey(filters)] as const,
  stock: (symbol: string) => ['stock', symbol] as const,
  stockProfile: (symbol: string) => ['stock', symbol, 'profile'] as const,
  search: (q: string) => ['search', q] as const,
  history: (symbol: string, range: HistoryRange) => ['history', symbol, range] as const,
  candles: (symbol: string) => ['candles', symbol] as const,
  historyStatus: (symbol: string) => ['history-status', symbol] as const,
  syncStatus: ['sync', 'status'] as const,
  syncLogs: (params: unknown) => ['sync', 'logs', params] as const,
  indices: ['indices'] as const,
  index: (symbol: string) => ['index', symbol] as const,
  indexCandles: (symbol: string) => ['index-candles', symbol] as const,
  // The window size belongs in the key: a 40-session card chart and a 252-session detail chart are
  // different series at the same symbol, and without it one would be served the other's cache.
  indexHistory: (symbol: string, limit: number) => ['index-history', symbol, limit] as const,
  marketOverview: ['market', 'overview'] as const,
  marketStatus: ['market', 'status'] as const,
  movers: (type: MoverType, period: MoverPeriod) => ['market', 'movers', type, period] as const,
  sectors: ['market', 'sectors'] as const,
  dividends: ['market', 'dividends'] as const,
};

/**
 * The tracked-stock list. `group` splits the universe in two (the KSE-100 and the rest); `index`
 * filters it to one PSX index's tracked constituents — the API 400s on a symbol it does not know,
 * which is why callers pass symbols the index board actually returned rather than typed text.
 */
export const useStocks = (
  page = 1,
  limit = 20,
  /**
   * How often to re-read: `false` for a one-off read, `true` for the fast 4s cadence a sync fan-out
   * wants, or a number of milliseconds for a slower live cadence — the dashboard passes one while the
   * exchange is open, so a `points` order keeps up with contributions that are still moving.
   */
  poll: boolean | number = false,
  sort?: StockSortField,
  order: SortOrder = 'asc',
  group?: StockListGroup,
  index?: string,
  filters?: StockFilters,
  /**
   * A named screen. When set, the server supplies the criteria, the ordering and each row's
   * reason, so the client must not also send a sort — it would fight the preset.
   */
  preset?: string,
) =>
  useQuery({
    // The sort belongs in the key: a different order is a different page of data, not a
    // re-render of this one.
    queryKey: [...keys.stocks(page, limit, sort, order, group, index, filters), preset ?? ''],
    queryFn: async () => {
      // Undefined params are dropped from the query string by axios, so "no scope" really is
      // no `group` / `index` on the wire rather than an empty one. Screener/watchlist filters are
      // spread in, with `symbols` joined back to a comma string.
      const params: Record<string, unknown> = { page, limit, sort, order, group, index, preset };
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v != null) params[k] = k === 'symbols' ? (v as string[]).join(',') : v;
        }
      }
      return (await api.get<StocksPage>('/stocks', { params })).data;
    },
    // Poll while a sync-all fan-out is in flight so prices / "last synced" update live, or at the
    // slower live cadence the caller asks for (a number) while there is something to keep up with.
    refetchInterval: typeof poll === 'number' ? poll : poll ? 4000 : false,
    // A live cadence needs `staleTime: 0`: React Query skips a scheduled refetch while the cached data
    // is still fresh, so the app-wide 30s stale time silently halves a 30s interval — measured as 2
    // refreshes over 2 minutes instead of 4 (the timer fires at the stale boundary and is skipped,
    // then takes the next tick). Everything else keeps the provider's default.
    ...(typeof poll === 'number' ? { staleTime: 0 } : {}),
  });

/**
 * The index board: every index PSX publishes, scraped from the exchange's market-summary page
 * (see the backend's indexScrape service). Polls alongside a sync so the board moves with it.
 */
export const useIndices = (poll = false) =>
  useQuery({
    queryKey: keys.indices,
    queryFn: async () => (await api.get<Paginated<IndexSummary>>('/indices', { params: { limit: 50 } })).data,
    refetchInterval: poll ? 30000 : false,
  });

/** One index's board figures. */
export const useIndex = (symbol: string) =>
  useQuery({
    queryKey: keys.index(symbol),
    queryFn: async () => (await api.get<IndexSummary>(`/indices/${symbol}`)).data,
    enabled: !!symbol,
  });

/** One index's daily candles — same shape as a stock's, so the same chart draws it. */
export const useIndexCandles = (symbol: string) =>
  useQuery({
    queryKey: keys.indexCandles(symbol),
    queryFn: async () => (await api.get<CandleSeries>(`/indices/${symbol}/candles`)).data,
    enabled: !!symbol,
  });

/**
 * A bounded window of one index's sessions, newest first — what a card's mini chart draws.
 *
 * Deliberately not `useIndexCandles`: that returns every session we hold for the index (KSE100 is
 * 4,000+ rows), and seventeen of those on the dashboard would be megabytes of JSON to draw forty
 * candles' worth of ink. The card asks for the last N sessions instead.
 */
export const useIndexHistory = (symbol: string, limit = 40) =>
  useQuery({
    queryKey: keys.indexHistory(symbol, limit),
    queryFn: async () =>
      (await api.get<Paginated<PriceRow>>(`/indices/${symbol}/history`, { params: { limit } })).data,
    enabled: !!symbol,
  });

/**
 * Daily candles for the chart: every session we hold for the symbol, oldest first.
 *
 * Deliberately *not* range-filtered. The range buttons move the visible window instead, so
 * dragging or scrolling backwards keeps showing real candles rather than running off the end of
 * a truncated series into empty space. It also means switching a range refetches nothing.
 * (The API still accepts `range` for callers that genuinely want a bounded window.)
 */
export const useCandles = (symbol: string, adjusted = false) =>
  useQuery({
    queryKey: [...keys.candles(symbol), { adjusted }],
    queryFn: async () =>
      (await api.get<CandleSeries>(`/stocks/${symbol}/candles${adjusted ? '?adjusted=true' : ''}`)).data,
    enabled: !!symbol,
  });

export const useStock = (symbol: string) =>
  useQuery({
    queryKey: keys.stock(symbol),
    queryFn: async () => (await api.get<StockDetail>(`/stocks/${symbol}`)).data,
    enabled: !!symbol,
  });

/**
 * The stock page's Company Description section (#180).
 *
 * Its own query rather than part of `useStock`: the content is editorial and below the fold, and it
 * is absent for most symbols — so the page paints the price and the chart without waiting on it,
 * and a stock nobody has written up resolves to `profile: null` rather than to an error. The
 * section renders nothing in that case.
 *
 * `retry: false` because the only failure worth retrying is a network blip: a 404 here is a
 * definitive "not a tracked symbol" and asking again changes nothing.
 */
export const useStockProfile = (symbol: string) =>
  useQuery({
    queryKey: keys.stockProfile(symbol),
    queryFn: async () => (await api.get<StockProfileResponse>(`/stocks/${symbol}/profile`)).data,
    enabled: Boolean(symbol),
    retry: false,
    // Editorial content changes when someone edits a file and re-runs the loader, not on a timer.
    staleTime: 5 * 60 * 1000,
  });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: async () => (await api.get<{ query: string; results: SearchResult[] }>('/search', { params: { q } })).data,
    enabled: q.trim().length > 0,
  });

export const useHistory = (symbol: string, range: HistoryRange) =>
  useQuery({
    queryKey: keys.history(symbol, range),
    queryFn: async () =>
      (await api.get<Paginated<PriceRow>>(`/stocks/${symbol}/history`, { params: { range } })).data,
    enabled: !!symbol,
  });

/** Poll a symbol's history-fetch job while it is running. */
export const useHistoryStatus = (symbol: string, active: boolean) =>
  useQuery({
    queryKey: keys.historyStatus(symbol),
    queryFn: async () => (await api.get<HistoryJobStatus>(`/stocks/${symbol}/history/status`)).data,
    enabled: !!symbol && active,
    refetchInterval: active ? 1200 : false,
  });

export const useFetchHistory = (symbol: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (range: HistoryRange) =>
      (await api.post(`/stocks/${symbol}/history/sync`, { range })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.historyStatus(symbol) }),
  });
};

export const useSyncStatus = (poll = false) =>
  useQuery({
    queryKey: keys.syncStatus,
    queryFn: async () => (await api.get<SyncStatus>('/sync/status')).data,
    refetchInterval: poll ? 3000 : false,
  });

export const useSyncLogs = (
  params: { page?: number; limit?: number; status?: string; symbol?: string },
  /** `refetchInterval` keeps a live view live; the logs page polls only while it is switched on. */
  options?: { refetchInterval?: number | false },
) =>
  useQuery({
    queryKey: keys.syncLogs(params),
    queryFn: async () => (await api.get<Paginated<SyncLog>>('/sync/logs', { params })).data,
    refetchInterval: options?.refetchInterval ?? false,
  });

export const useAddStock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (symbol: string) =>
      // A human clicked Add, so this one is allowed to override a remembered removal; the API
      // refuses an unforced add of a symbol that was deleted (any automated client).
      (await api.post('/stocks', { symbol, force: true })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      qc.invalidateQueries({ queryKey: ['sync'] });
    },
  });
};

export const useDeleteStock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (symbol: string) => (await api.delete(`/stocks/${symbol}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stocks'] }),
  });
};

export const useSyncStock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (symbol: string) => (await api.post(`/stocks/${symbol}/sync`)).data,
    onSuccess: (_d, symbol) => {
      qc.invalidateQueries({ queryKey: keys.stock(symbol) });
      qc.invalidateQueries({ queryKey: ['sync'] });
    },
  });
};

export const useSyncAll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post('/sync/all')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync'] }),
  });
};

/**
 * Empty one queue's failed set.
 *
 * Not just a convenience: an entry whose job payload is gone cannot be removed through BullMQ
 * at all, so this endpoint is the only way to clear it from the app.
 */
export const useClearFailed = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (queue: string) =>
      (await api.post<{ queue: string; removed: number; orphans: number }>('/sync/failed/clear', { queue })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.syncStatus }),
  });
};

/**
 * Market breadth plus the top gainers / losers / most active — the dashboard's summary strip.
 *
 * `poll` follows `useIndices`: a number re-reads on that cadence, `true` uses the index board's 30s,
 * `false` reads once. The header ticker is the caller that wants a cadence; the dashboard settles for
 * once, because its own sync fan-out already re-reads what it shows.
 *
 * A live cadence needs `staleTime: 0` for the same reason `useStocks` sets it: React Query skips a
 * scheduled refetch while the cached data is still fresh, so the app-wide stale time would silently
 * stretch the interval instead of honouring it.
 */
export const useMarketOverview = (poll: boolean | number = false) =>
  useQuery({
    queryKey: keys.marketOverview,
    queryFn: async () => (await api.get<MarketOverview>('/market/overview')).data,
    refetchInterval: typeof poll === 'number' ? poll : poll ? 30000 : false,
    ...(poll ? { staleTime: 0 } : {}),
  });

/**
 * Session state and dataset freshness, for the small "as of" line under a page title.
 *
 * Polled on the minute: it can only change at a session boundary or when a sync lands, the payload
 * is four indexed lookups, and an open tab that never polls would go on claiming "live" long after
 * the feed stopped.
 */
export const useMarketStatus = () =>
  useQuery({
    queryKey: keys.marketStatus,
    queryFn: async () => (await api.get<MarketStatus>('/market/status')).data,
    refetchInterval: 60000,
    staleTime: 30000,
  });

/**
 * The movers ranking. Keyed on both the list and the window: gainers over a day and gainers over a
 * month are different rows, and a shared key would serve one as the other.
 */
export const useMovers = (type: MoverType, period: MoverPeriod, limit = 50) =>
  useQuery({
    queryKey: keys.movers(type, period),
    queryFn: async () =>
      (await api.get<MoversPayload>('/market/movers', { params: { type, period, limit } })).data,
  });

/** One aggregate row per sector, for the sector browser. */
export const useSectors = () =>
  useQuery({
    queryKey: keys.sectors,
    queryFn: async () => (await api.get<{ items: SectorSummary[] }>('/market/sectors')).data,
  });

/** Normalised comparison of 2–5 symbols over one shared window. */
export const useCompare = (symbols: string[], period: string) =>
  useQuery({
    queryKey: ['compare', symbols.join(','), period],
    queryFn: async () =>
      (await api.get<CompareResponse>('/compare', { params: { symbols: symbols.join(','), period } })).data,
    enabled: symbols.length >= 2,
    staleTime: 60 * 1000,
  });

/** Period returns plus a rebased index comparison. */
export const usePerformance = (symbol: string, range: string, index = 'KSE100') =>
  useQuery({
    queryKey: ['performance', symbol, range, index],
    queryFn: async () =>
      (await api.get<PerformanceResponse>(`/stocks/${symbol}/performance`, { params: { range, index } })).data,
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });

/** Technical indicators for a symbol's current range (cached server-side for five minutes). */
export const useIndicators = (symbol: string, range: string) =>
  useQuery({
    queryKey: ['indicators', symbol, range],
    queryFn: async () =>
      (await api.get<IndicatorsResponse>(`/stocks/${symbol}/indicators`, { params: { range } })).data,
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });

/** One sector's drill-down by name (the name is a query parameter — several contain a slash). */
export const useSectorDetail = (sector: string) =>
  useQuery({
    queryKey: ['market', 'sector', sector],
    queryFn: async () =>
      (await api.get<SectorDetail>('/market/sector', { params: { sector } })).data,
    enabled: Boolean(sector),
  });

/** Upcoming dividend events plus the highest current yields. */
export const useDividends = () =>
  useQuery({
    queryKey: keys.dividends,
    queryFn: async () => (await api.get<DividendData>('/market/dividends')).data,
  });

/**
 * The named screens the screener offers. The definitions come from the server so the chips, the
 * criteria they apply and the reason printed on each row cannot drift apart between clients.
 */
export const useScreenerPresets = () =>
  useQuery({
    queryKey: ['screener', 'presets'],
    queryFn: async () => (await api.get<{ items: ScreenerPreset[] }>('/stocks/presets')).data,
    staleTime: 60 * 60 * 1000,
  });

/** Official notices, newest first. An empty list is a valid answer — see the page's empty state. */
export const useAnnouncements = (params: {
  symbol?: string;
  category?: string;
  page?: number;
  limit?: number;
} = {}) =>
  useQuery({
    queryKey: ['announcements', params],
    queryFn: async () =>
      (
        await api.get<AnnouncementList>('/announcements', {
          params: { symbol: params.symbol || undefined, category: params.category || undefined, page: params.page ?? 1, limit: params.limit ?? 50 },
        })
      ).data,
  });

/** The dividend ledger. Filters are part of the query key, so a filtered view is a shareable URL. */
export const useDividendLedger = (params: {
  symbol?: string;
  from?: string;
  to?: string;
  minYield?: number;
  page?: number;
  limit?: number;
} = {}) =>
  useQuery({
    queryKey: ['dividends', 'ledger', params],
    queryFn: async () =>
      (await api.get<DividendLedger>('/dividends', { params: { ...params, limit: params.limit ?? 100 } })).data,
  });

/** Data-source registry + per-source health (#214). */
export interface DataSourceView {
  id: string;
  name: string;
  category: string;
  provides: string[];
  hosts: string[];
  files: string[];
  licence: { status: string; notes: string };
  rateLimit: string | null;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  successCount: number;
  failureCount: number;
  attempts: number;
  errorRate: number;
}

export const useDataSources = () =>
  useQuery({
    queryKey: ['sync', 'sources'],
    queryFn: async () => (await api.get<{ sources: DataSourceView[]; disabled: string[]; unknownDisabledIds: string[]; unlicensedCount: number }>('/sync/sources')).data,
    staleTime: 30_000,
  });
