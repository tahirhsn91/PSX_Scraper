import type { Queue } from 'bullmq';

export interface StubJob {
  data?: unknown;
  failedReason?: string;
  finishedOn?: number;
  timestamp?: number;
}

export interface FakeQueue {
  queue: Queue;
  /** The failed set itself — mutated by clean()/the drop script, so a test can read it back. */
  members: string[];
  cleanCalls: () => number;
  /** Calls to the registered drop-orphans script, with the arguments it received. */
  dropCalls: Array<{ setKey: string; jobKeyPrefix: string }>;
}

/**
 * A Queue stub covering the surface `queueFailures` uses: the `failed` set (`zrange` over
 * `toKey('failed')`), the job hashes (`hgetall` per id, through a pipeline — an empty hash is
 * how Redis answers for a key that is gone), `getJob`, `clean`, and the registered
 * `runCommand` script.
 *
 * `jobs` holds the payloads that still exist, keyed by job id: an id in `members` that is
 * *not* in `jobs` is exactly the ghost this module exists to stop counting — BullMQ's own
 * `getJobCounts().failed` is `ZCARD` over `members`, which cannot tell the difference.
 *
 * `getJobCounts` therefore returns the raw cardinality (ghosts included), the way the real
 * queue does.
 *
 * `cleanSkipsGhosts` models a `clean()` that only takes the jobs it can see — the case the
 * registered script exists for. By default it mirrors the shipped Lua, which collects every
 * member it matched (ghosts included) and ZREMs them.
 */
export function fakeQueue(
  id: string,
  members: string[],
  jobs: Record<string, StubJob> = {},
  opts: { active?: StubJob[]; cleanSkipsGhosts?: boolean } = {},
): FakeQueue {
  const dropCalls: Array<{ setKey: string; jobKeyPrefix: string }> = [];
  let cleanCalls = 0;
  const hasJob = (jobId: string) => !!jobs[jobId];

  const client = {
    zrange: async () => [...members],
    pipeline: () => {
      const keys: string[] = [];
      const pipe = {
        hgetall: (key: string) => { keys.push(key.slice(`bull:${id}:`.length)); return pipe; },
        exec: async () => keys.map((key) => [null, hasJob(key) ? { data: '1' } : {}] as [null, unknown]),
      };
      return pipe;
    },
    defineCommand: (name: string) => { if (!name) throw new Error('script needs a name'); },
    runCommand: async (name: string, args: unknown[]) => {
      if (name !== 'psxDropOrphanFailures') throw new Error(`unexpected script: ${name}`);
      const [setKey, jobKeyPrefix] = args as [string, string];
      dropCalls.push({ setKey, jobKeyPrefix });
      let dropped = 0;
      for (const jobId of [...members]) {
        if (!hasJob(jobId)) {
          members.splice(members.indexOf(jobId), 1);
          dropped += 1;
        }
      }
      return dropped;
    },
  };

  const queue = {
    client: Promise.resolve(client),
    toKey: (name: string) => `bull:${id}:${name}`,
    getJob: async (jobId: string) => (jobs[jobId] ? { id: jobId, ...jobs[jobId] } : undefined),
    getJobCounts: async () => ({
      waiting: 0, active: opts.active?.length ?? 0, completed: 0,
      failed: members.length, delayed: 0, paused: 0,
    }),
    getActive: async () => (opts.active ?? []).map((job, i) => ({ id: `${id}-active-${i}`, ...job })),
    // What the shipped clean() does: walk the matched members, then ZREM them.
    clean: async () => {
      cleanCalls += 1;
      const cleanable = opts.cleanSkipsGhosts ? members.filter(hasJob) : [...members];
      for (const jobId of cleanable) members.splice(members.indexOf(jobId), 1);
      return cleanable.length;
    },
  } as unknown as Queue;

  return { queue, members, cleanCalls: () => cleanCalls, dropCalls };
}
