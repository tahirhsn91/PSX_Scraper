/** Shapes returned by `GET /api/v1/roi`, mirrored from `backend/src/services/roi.service.ts`. */

export type RoiMode = 'single' | 'dca' | 'compare';

export interface RoiWarning {
  code:
    | 'CORPORATE_ACTION_SUSPECTED'
    | 'ZERO_VOLUME_SESSION'
    | 'STALE_CLOSE'
    | 'DIVIDEND_TIMING_APPROXIMATED'
    | 'SHORT_HOLDING'
    | 'BENCHMARK_LIMITED'
    | 'SURVIVORSHIP';
  message: string;
  date?: string;
  symbol?: string;
}

export interface RoiPoint {
  date: string;
  value: number;
}

export interface RoiHolding {
  symbol: string;
  name: string | null;
  buy: { requested: string; session: string; price: number; movedFromRequest: boolean };
  sell: { requested: string; session: string; price: number; movedFromRequest: boolean };
  sessions: number;
  quantity: number;
  /** Cash the reader paid in; `returnPct` is measured against this. */
  paidIn: number;
  invested: number;
  buyFees: number;
  leftover: number;
  dividends: { count: number; gross: number; tax: number; net: number; items: { date: string; perShare: number }[] };
  proceeds: { gross: number; sellFees: number; tax: number; net: number };
  profit: number;
  returnPct: number;
  /** The same return with recorded dividends removed. */
  dividendFreePct: number;
  annualisedPct: number | null;
  holdingDays: number;
  maxDrawdownPct: number;
  series: RoiPoint[];
}

export interface RoiRow {
  symbol: string;
  name: string | null;
  returnPct: number;
  annualisedPct: number | null;
  maxDrawdownPct: number | null;
  terminalValue: number | null;
  note?: string;
}

export interface RoiDca {
  symbol: string;
  name: string | null;
  contributions: { date: string; amount: number; price: number; quantity: number; fees: number; unspent: number }[];
  months: number;
  totalContributed: number;
  totalInvested: number;
  leftover: number;
  quantity: number;
  averageCost: number;
  sell: { requested: string; session: string; price: number };
  terminalValue: number;
  dividends: { count: number; gross: number; tax: number; net: number };
  profit: number;
  returnPct: number;
  dividendFreePct: number;
  annualisedPct: number | null;
  holdingDays: number;
  maxDrawdownPct: number;
  lumpSum: { returnPct: number; annualisedPct: number | null; terminalValue: number };
  benchmark: RoiRow | null;
  series: RoiPoint[];
}

export interface RoiResponse {
  meta: {
    mode: RoiMode;
    latestSession: string;
    window: { start: string; end: string; sessions: number };
    assumptions: string[];
    warnings: RoiWarning[];
  };
  holding?: RoiHolding;
  dca?: RoiDca;
  compare?: { start: string; end: string; rows: RoiRow[]; excluded: { symbol: string; reason: string }[] };
  benchmark: RoiRow | null;
}

export interface RoiParams {
  mode: RoiMode;
  symbol?: string;
  symbols?: string[];
  start: string;
  end?: string;
  amount: number;
  dayOfMonth?: number;
  feePct: number;
  feeFlat: number;
  divTax: number;
  cgt: number;
}
