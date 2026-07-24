import winston from 'winston';
import { env } from '../config';

const REDACT = ['password', 'authorization', 'token', 'secret'];

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (REDACT.some((r) => key.toLowerCase().includes(r))) {
      info[key] = '[REDACTED]';
    }
  }
  return info;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'psx-scraper' },
  transports: [
    new winston.transports.Console({
      format:
        env.NODE_ENV === 'development'
          ? winston.format.combine(winston.format.colorize(), winston.format.simple())
          : winston.format.json(),
    }),
  ],
});

export type ContextLogger = winston.Logger;

/** Child logger carrying correlation context (requestId, jobId, symbol). */
export const childLogger = (meta: Record<string, unknown>): ContextLogger => logger.child(meta);
