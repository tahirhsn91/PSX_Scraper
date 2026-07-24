import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn' as never, (e: { message: string }) => logger.warn('prisma.warn', { message: e.message }));
prisma.$on('error' as never, (e: { message: string }) => logger.error('prisma.error', { message: e.message }));

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
