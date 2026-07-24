import { createApp } from './app';
import { env } from './config';
import { logger } from './utils/logger';
import { disconnectPrisma } from './database/prisma';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info('api.started', { port: env.PORT, env: env.NODE_ENV });
});

const shutdown = async (sig: string) => {
  logger.info('api.shutdown', { sig });
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
