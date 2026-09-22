import {
  clearQueueFailures, inspectQueueFailures, splitFailedMembers,
} from '../src/jobs/queueFailures';
import { syncService } from '../src/services/sync.service';
import { clearFailedBody } from '../src/validators/schemas';
import { MONITORED_QUEUES, type MonitoredQueueName } from '../src/utils/queueNames';
import { fakeQueue, type FakeQueue } from './helpers/fakeQueue';

/**
 * The queue stubs the service reads. Built inside the factory because `jest.mock` is hoisted
 * above the imports; reachable afterwards through `__fakes`.
 *
 * `stock-sync` carries the exact shape that produced the dashboard's permanent "Failed 1":
 * one real failed job plus an entry in the failed set whose payload is already gone.
 */
jest.mock('../src/jobs/queues', () => {
  const { fakeQueue: make } = jest.requireActual('./helpers/fakeQueue') as typeof import('./helpers/fakeQueue');

  const fakes = {
    'stock-sync': make('stock-sync', ['sync-ENGRO', 'sync-ZZZZNOTREAL'], {
      'sync-ENGRO': { data: { symbol: 'ENGRO' }, failedReason: 'Source site unavailable: psx', finishedOn: 1789568000000 },
    }, { active: [{ data: { symbol: 'FFC' } }] }),
    'stock-sync-all': make('stock-sync-all', []),
    'stock-history-sync': make('stock-history-sync', ['history-FFC'], {
      'history-FFC': { data: { symbol: 'FFC', range: '2Y' }, failedReason: 'Source site unavailable: psx-eod', finishedOn: 1789929386931 },
    }),
    'index-sync': make('index-sync', ['index-KSE100']),
    'quote-sync': make('quote-sync', []),
    'universe-sync': make('universe-sync', []),
  };

  const monitoredQueues = Object.fromEntries(
    Object.entries(fakes).map(([name, fake]) => [name, fake.queue]),
  );

  return {
    syncQueue: fakes['stock-sync'].queue,
    syncAllQueue: fakes['stock-sync-all'].queue,
    historyQueue: fakes['stock-history-sync'].queue,
    indexQueue: fakes['index-sync'].queue,
    quoteQueue: fakes['quote-sync'].queue,
    universeQueue: fakes['universe-sync'].queue,
    monitoredQueues,
    enqueueSync: jest.fn(),
    enqueueSyncAll: jest.fn(),
    enqueueHistorySync: jest.fn(),
    findExistingSyncJob: jest.fn(),
    findExistingHistoryJob: jest.fn(),
    __fakes: fakes,
  };
});

const fakes = (jest.requireMock('../src/jobs/queues') as { __fakes: Record<MonitoredQueueName, FakeQueue> }).__fakes;

beforeEach(() => {
  // The stubs mutate their own failed set, so each test starts from the declared set.
  const reset = (id: MonitoredQueueName, members: string[]) =>
    fakes[id].members.splice(0, fakes[id].members.length, ...members);
  reset('stock-sync', ['sync-ENGRO', 'sync-ZZZZNOTREAL']);
  reset('stock-history-sync', ['history-FFC']);
  reset('index-sync', ['index-KSE100']);
});

describe('splitFailedMembers', () => {
  it('separates members that still own a payload from the leftovers', () => {
    expect(splitFailedMembers(['a', 'b', 'c'], [true, false, true]))
      .toEqual({ existing: ['a', 'c'], orphans: ['b'] });
  });

  it('reports nothing for an empty failed set', () => {
    expect(splitFailedMembers([], [])).toEqual({ existing: [], orphans: [] });
  });
});

describe('inspectQueueFailures', () => {
  it('does not count a failed-set entry whose payload is gone', async () => {
    const { queue } = fakeQueue('stock-sync', ['sync-ZZZZNOTREAL']);
    expect(await inspectQueueFailures(queue)).toEqual({ failed: 0, orphans: 1, recent: [] });
  });

  it('counts real failures and details them, newest first', async () => {
    const { queue } = fakeQueue('stock-sync', ['sync-ENGRO', 'sync-OGDC', 'sync-GHOST'], {
      'sync-ENGRO': { data: { symbol: 'ENGRO' }, failedReason: 'first', finishedOn: 1000 },
      'sync-OGDC': { data: { symbol: 'OGDC' }, failedReason: 'second', finishedOn: 2000 },
    });

    const report = await inspectQueueFailures(queue);
    expect(report.failed).toBe(2);
    expect(report.orphans).toBe(1);
    expect(report.recent.map((f) => f.symbol)).toEqual(['OGDC', 'ENGRO']);
    expect(report.recent[0]).toEqual({
      id: 'sync-OGDC', symbol: 'OGDC', reason: 'second', failedAt: 2000,
    });
  });

  it('carries a null symbol for jobs that have none, rather than inventing one', async () => {
    const { queue } = fakeQueue('stock-sync-all', ['sync-all-1'], {
      'sync-all-1': { data: { trigger: 'manual' }, failedReason: 'boom', timestamp: 500 },
    });
    expect((await inspectQueueFailures(queue)).recent[0]).toMatchObject({
      symbol: null, reason: 'boom', failedAt: 500,
    });
  });
});

describe('clearQueueFailures', () => {
  it('clears the real job and reports what part of the count was never a job', async () => {
    const fake = fakeQueue('stock-sync', ['sync-ENGRO', 'sync-ZZZZNOTREAL'], {
      'sync-ENGRO': { data: { symbol: 'ENGRO' }, failedReason: 'boom' },
    });

    expect(await clearQueueFailures(fake.queue)).toEqual({ removed: 1, orphans: 1 });
    expect(fake.members).toEqual([]);
    expect(fake.cleanCalls()).toBe(1);
    // The shipped clean() walks the set's members, so it took the ghost with it.
    expect(fake.dropCalls).toEqual([]);
  });

  it('drops a ghost that clean() leaves behind, which nothing else can remove', async () => {
    const fake = fakeQueue('stock-sync', ['sync-ENGRO', 'sync-ZZZZNOTREAL'], {
      'sync-ENGRO': { data: { symbol: 'ENGRO' }, failedReason: 'boom' },
    }, { cleanSkipsGhosts: true });

    expect(await clearQueueFailures(fake.queue)).toEqual({ removed: 1, orphans: 1 });
    expect(fake.members).toEqual([]);
    expect(fake.dropCalls).toEqual([
      { setKey: 'bull:stock-sync:failed', jobKeyPrefix: 'bull:stock-sync:' },
    ]);
  });

  it('clears a set that is nothing but ghosts, without calling clean()', async () => {
    const fake = fakeQueue('stock-sync', ['sync-ZZZZNOTREAL']);
    expect(await clearQueueFailures(fake.queue)).toEqual({ removed: 0, orphans: 1 });
    expect(fake.members).toEqual([]);
    expect(fake.cleanCalls()).toBe(0);
    expect(fake.dropCalls).toHaveLength(1);
  });

  it('is a no-op on an empty failed set, and does not call clean()', async () => {
    const fake = fakeQueue('stock-sync', []);
    expect(await clearQueueFailures(fake.queue)).toEqual({ removed: 0, orphans: 0 });
    expect(fake.cleanCalls()).toBe(0);
    expect(fake.dropCalls).toEqual([]);
  });
});

describe('syncService.status', () => {
  it('reports the ghost as an orphan instead of counting it as failed', async () => {
    const status = await syncService.status();

    // The stub's own getJobCounts() says 2 (ZCARD, ghost included) — the endpoint must not.
    expect(status.queues['stock-sync']!.failed).toBe(1);
    expect(status.queues['stock-sync']!.orphans).toBe(1);
    expect(status.failures['stock-sync']![0]).toMatchObject({ symbol: 'ENGRO' });
  });

  it('reports every queue, so a failure outside stock-sync cannot hide', async () => {
    const status = await syncService.status();
    expect(Object.keys(status.queues)).toEqual([...MONITORED_QUEUES]);
    expect(status.failures['stock-history-sync']![0]).toMatchObject({
      symbol: 'FFC', reason: 'Source site unavailable: psx-eod',
    });
    expect(status.queues['index-sync']).toMatchObject({ failed: 0, orphans: 1 });
  });

  it('keeps the active jobs the dashboard shows as in-flight', async () => {
    expect((await syncService.status()).inFlight).toEqual(['FFC']);
  });
});

describe('syncService.clearFailed', () => {
  it('empties the named queue and says how much of it was orphaned', async () => {
    expect(await syncService.clearFailed('stock-sync'))
      .toEqual({ queue: 'stock-sync', removed: 1, orphans: 1, countedAsFailed: 1 });
    expect(fakes['stock-sync'].members).toEqual([]);
    // The other queues are untouched — clearing is per queue, by name.
    expect(fakes['stock-history-sync'].members).toEqual(['history-FFC']);
  });
});

describe('clearFailedBody', () => {
  it('accepts every queue the status endpoint reports', () => {
    for (const queue of MONITORED_QUEUES) {
      expect(clearFailedBody.parse({ queue }).queue).toBe(queue);
    }
  });

  it('rejects an unknown queue instead of silently doing nothing', () => {
    expect(() => clearFailedBody.parse({ queue: 'not-a-queue' })).toThrow();
  });
});
