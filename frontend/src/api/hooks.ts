import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Paginated, StocksPage, StockListGroup, StockDetail, SearchResult, PriceRow,
  SyncLog, SyncStatus, HistoryRange, HistoryJobStatus, StockSortField, SortOrder, CandleSeries,
  IndexSummary,
} from '../types';

export const keys = {
  // The group belongs in the key: page one (the KSE-100) and page two (everything else) are
  // different row sets at the same page number, and without it the second request would be served
  // from the first one's cache — page two showing the index.
  stocks: (
    page: number,
    limit: number,
    sort?: StockSortField,
    order: SortOrder = 'asc',
    group?: StockListGroup,
  ) => ['stocks', page, limit, sort ?? 'symbol', order, group ?? 'all'] as const,
  stock: (symbol: string) => ['stock', symbol] as const,
  search: (q: string) => ['search', q] as const,
  history: (symbol: string, range: HistoryRange) => ['history', symbol, range] as const,
  candles: (symbol: string) => ['candles', symbol] as const,
  historyStatus: (symbol: string) => ['history-status', symbol] as const,
  syncStatus: ['sync', 'status'] as const,
  syncLogs: (params: unknown) => ['sync', 'logs', params] as const,
  indices: ['indices'] as const,
  index: (symbol: string) => ['index', symbol] as const,
  indexCandles: (symbol: string) => ['index-candles', symbol] as const,
};

export const useStocks = (
  page = 1,
  limit = 20,
  poll = false,
  sort?: StockSortField,
  order: SortOrder = 'asc',
  group?: StockListGroup,
) =>
  useQuery({
    // The sort belongs in the key: a different order is a different page of data, not a
    // re-render of this one.
    queryKey: keys.stocks(page, limit, sort, order, group),
    queryFn: async () =>
      (
        await api.get<StocksPage>('/stocks', {
          params: { page, limit, sort, order, group },
        })
      ).data,
    // Poll while a sync-all fan-out is in flight so prices / "last synced" update live.
    refetchInterval: poll ? 4000 : false,
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
 * Daily candles for the chart: every session we hold for the symbol, oldest first.
 *
 * Deliberately *not* range-filtered. The range buttons move the visible window instead, so
 * dragging or scrolling backwards keeps showing real candles rather than running off the end of
 * a truncated series into empty space. It also means switching a range refetches nothing.
 * (The API still accepts `range` for callers that genuinely want a bounded window.)
 */
export const useCandles = (symbol: string) =>
  useQuery({
    queryKey: keys.candles(symbol),
    queryFn: async () => (await api.get<CandleSeries>(`/stocks/${symbol}/candles`)).data,
    enabled: !!symbol,
  });

export const useStock = (symbol: string) =>
  useQuery({
    queryKey: keys.stock(symbol),
    queryFn: async () => (await api.get<StockDetail>(`/stocks/${symbol}`)).data,
    enabled: !!symbol,
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

export const useSyncLogs = (params: { page?: number; limit?: number; status?: string; symbol?: string }) =>
  useQuery({
    queryKey: keys.syncLogs(params),
    queryFn: async () => (await api.get<Paginated<SyncLog>>('/sync/logs', { params })).data,
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
