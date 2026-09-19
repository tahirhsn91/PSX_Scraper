import { z } from 'zod';

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
  sort: z.enum(['symbol', 'price', 'week52Low', 'week52High', 'changePercent', 'volume']).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const addStockBody = z.object({ symbol: symbolSchema });

export const symbolParam = z.object({ symbol: symbolSchema });

export const searchQuery = z.object({
  q: z.string().trim().default(''),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const rangeSchema = z.enum(['1W', '1M', '1Y', '2Y', '3Y', '5Y', 'MAX']);

export const historyQuery = z.object({
  range: rangeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(5000).default(2000),
});

export const historySyncBody = z.object({ range: rangeSchema });

export const logsQuery = z.object({
  symbol: z.string().trim().optional(),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
