import { z } from 'zod';
import { HISTORY_RANGES } from '../utils/range';
import { MONITORED_QUEUES } from '../utils/queueNames';

export const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9]+$/, 'Symbol must be alphanumeric')
  .transform((s) => s.toUpperCase());

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
});

/**
 * The stocks list query: pagination plus sortable columns.
 *
 * `sort` is an enum, not a free string. The repository builds its ORDER BY from the value, so
 * anything that is not one of these names is refused here — with a 400 that names the field —
 * rather than reaching the query.
 */
export const stocksQuery = paginationQuery.extend({
  sort: z.enum(['symbol', 'price', 'week52Low', 'week52High', 'change', 'changePercent', 'volume', 'marketCap']).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  /**
   * Which half of the tracked universe to list: the index's member set (the dashboard's page one)
   * or everything else (page two onward, 50 a page). Absent means one sequence over the whole
   * universe, which is what every other client wants.
   *
   * A sort applies *within* the group — page one stays the KSE-100 whatever the column.
   */
  group: z.enum(['kse100', 'rest']).optional(),
  /**
   * Narrow the list to one published index's tracked members, by index symbol (KMI30, ALLSHR, …).
   * Validated with the same symbol rules as everywhere else — trimmed and upper-cased, so a caller
   * cannot miss an index on casing alone. Format only: whether the index exists is answered
   * against the database, which is the only place that can answer it, and an unknown symbol is a
   * 400 naming it rather than a silent 200 over the whole universe.
   *
   * `index` wins over `group` when both are sent (see buildListFilter).
   */
  index: symbolSchema.optional(),
});

/**
 * `force` is how an explicit add overrides a remembered removal: the dashboard sends it because a
 * human clicked Add, while a client that re-requests a symbol it got a 404 for does not — so an
 * automated retry cannot resurrect a symbol someone deleted.
 */
export const addStockBody = z.object({ symbol: symbolSchema, force: z.boolean().optional() });

export const symbolParam = z.object({ symbol: symbolSchema });

export const searchQuery = z.object({
  q: z.string().trim().default(''),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

// Derived from the single source of truth so the API and the jobs cannot drift apart.
export const rangeSchema = z.enum([...HISTORY_RANGES]);

export const historyQuery = z.object({
  range: rangeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(5000).default(2000),
});

export const historySyncBody = z.object({ range: rangeSchema });

/**
 * Candle query. Daily is the only interval PSX supports for us — one session per symbol per
 * day — so anything finer would be invented; `1D` is the enum's only member and the place to
 * extend when an intraday source lands.
 *
 * Omit both dates and you get every session we hold, oldest first, which is what the chart
 * asks for ("the past available date till now").
 */
export const candlesQuery = z.object({
  interval: z.enum(['1D']).default('1D'),
  // The same presets the line chart uses, so one range control drives both views. `range`
  // takes precedence over an explicit `from`, exactly as it does for /history.
  range: rangeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const logsQuery = z.object({
  symbol: z.string().trim().optional(),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/**
 * Clear one queue's failed set. The names come from the same list `GET /sync/status` reports,
 * so an unknown queue is a 400 naming it rather than an action that silently does nothing.
 */
export const clearFailedBody = z.object({ queue: z.enum(MONITORED_QUEUES) });
