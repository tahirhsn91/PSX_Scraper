import { createApp } from './app';
import { env } from './config';
import { auditFeatureSettings } from './config/envAudit';
import { logger } from './utils/logger';
import { disconnectPrisma } from './database/prisma';

// A feature setting that is absent is not an error — every one has a code default — but a
// *silent* default is how a release lands with a feature switched off and nothing anywhere
// saying so. State the effective value of each unset setting at start-up.
for (const s of auditFeatureSettings()) {
  logger.warn('config.feature_setting_absent', { setting: s.setting, effective: s.effective, meaning: s.meaning });
}

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
