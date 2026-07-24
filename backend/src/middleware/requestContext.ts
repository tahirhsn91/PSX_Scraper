import { RequestHandler } from 'express';
import { v4 as uuid } from 'uuid';
import { childLogger } from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      log: ReturnType<typeof childLogger>;
    }
  }
}

/** Attach a correlation id + child logger, and log request completion with latency. */
export const requestContext: RequestHandler = (req, res, next) => {
  const id = (req.headers['x-request-id'] as string) || uuid();
  req.id = id;
  req.log = childLogger({ requestId: id });
  res.setHeader('x-request-id', id);
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Date.now() - start;
    req.log.http('request', { method: req.method, path: req.originalUrl, status: res.statusCode, ms });
  });
  next();
};
