import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { env } from './config';
import { openapiSpec } from './config/openapi';
import { requestContext } from './middleware/requestContext';
import { notFoundHandler, errorHandler, asyncHandler } from './middleware/errorHandler';
import apiRoutes from './routes';
import { prisma } from './database/prisma';
import { redis } from './services/cache';

/** Parses TRUST_PROXY into whatever type Express's `app.set('trust proxy', ...)` expects. */
function parseTrustProxy(value: string): number | boolean | string {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // e.g. 'loopback', a specific IP, or a CIDR range
}

export function createApp(): Express {
  const app = express();

  // Must be set before any request-handling middleware (esp. the rate limiters,
  // which read X-Forwarded-For via req.ip). Without this, Express ignores
  // X-Forwarded-For and express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
  // whenever the app runs behind a reverse proxy (Render, or any load balancer).
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const checks: Record<string, string> = {};
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = 'up';
      } catch {
        checks.database = 'down';
      }
      try {
        await redis.ping();
        checks.redis = 'up';
      } catch {
        checks.redis = 'down';
      }
      const healthy = Object.values(checks).every((v) => v === 'up');
      res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
    }),
  );

  const swaggerOptions = {
    customSiteTitle: 'PSX Scraper API Docs',
    swaggerOptions: {
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  };
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec as unknown as Record<string, unknown>, swaggerOptions));
  app.get('/api/docs.json', (_req, res) => res.json(openapiSpec));

  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
