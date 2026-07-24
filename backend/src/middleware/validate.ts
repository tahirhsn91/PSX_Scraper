import { RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../types/errors';

type Part = 'body' | 'query' | 'params';

/** Validate and coerce a request part with a Zod schema; replaces it with parsed data. */
export const validate =
  (schema: ZodSchema, part: Part = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(new ValidationError('Request validation failed', result.error.flatten()));
    }
    // Store parsed result on a dedicated field (req.query is read-only in Express 5-safe way).
    (req as unknown as Record<string, unknown>)[`valid_${part}`] = result.data;
    next();
  };

export const valid = <T>(req: unknown, part: Part): T =>
  (req as Record<string, unknown>)[`valid_${part}`] as T;
