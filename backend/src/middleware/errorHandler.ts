import { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../types/errors';
import { logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}`, requestId: req.id },
  });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.id;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error('app.error', { code: err.code, message: err.message, requestId });
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined, requestId },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate record', requestId } });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found', requestId } });
    }
  }

  logger.error('unhandled.error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    requestId,
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } });
};

/** Wrap async handlers so rejections reach the error middleware. */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
