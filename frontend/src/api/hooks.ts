import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Paginated, StockListItem, StockDetail, SearchResult, PriceRow, SyncLog, SyncStatus,
  HistoryRange, HistoryJobStatus, StockSortField, SortOrder, CandleSeries,
} from '../types';

export const keys = {
  stocks: (page: number, limit: number, sort?: StockSortField, order: SortOrder = 'asc') =>
    ['stocks', page, limit, sort ?? 'symbol', order] as const,
  stock: (symbol: string) => ['stock', symbol] as const,
  search: (q: string) => ['search', q] as const,
  history: (symbol: string, range: HistoryRange) => ['history', symbol, range] as const,
  candles: (symbol: string, range: HistoryRange) => ['candles', symbol, range] as const,
  historyStatus: (symbol: string) => ['history-status', symbol] as const,
  syncStatus: ['sync', 'status'] as const,
  syncLogs: (params: unknown) => ['sync', 'logs', params] as const,
};

export const useStocks = (
  page = 1,
  limit = 20,
  poll = false,
  sort?: StockSortField,
  order: SortOrder = 'asc',
) =>
  useQuery({
    // The sort belongs in the key: a different order is a different page of data, not a
    // re-render of this one.
    queryKey: keys.stocks(page, limit, sort, order),
    queryFn: async () =>
      (await api.get<Paginated<StockListItem>>('/stocks', { params: { page, limit, sort, order } })).data,
    // Poll while a sync-all fan-out is in flight so prices / "last synced" update live.
    refetchInterval: poll ? 4000 : false,
  });

/**
 * Daily candles for the chart, for the selected range. The API resolves the preset to a
 * lower bound, so 1W really is one week rather than the whole decade we hold.
 */
export const useCandles = (symbol: string, range: HistoryRange) =>
  useQuery({
    queryKey: keys.candles(symbol, range),
    queryFn: async () =>
      (await api.get<CandleSeries>(`/stocks/${symbol}/candles`, { params: { range } })).data,
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
    mutationFn: async (symbol: string) => (await api.post('/stocks', { symbol })).data,
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
