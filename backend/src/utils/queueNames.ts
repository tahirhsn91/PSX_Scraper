/**
 * Queue names the dashboard reports on.
 *
 * Kept dependency-free (no Redis client, no BullMQ import) so the request validators and the
 * API contract can name a queue without opening a connection — importing `jobs/queues` at
 * module scope creates one, which a schema module must not do.
 */
export const MONITORED_QUEUES = [
  'stock-sync',
  'stock-sync-all',
  'stock-history-sync',
  'index-sync',
  'quote-sync',
  'universe-sync',
] as const;

export type MonitoredQueueName = (typeof MONITORED_QUEUES)[number];
