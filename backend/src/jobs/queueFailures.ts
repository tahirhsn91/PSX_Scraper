import type { Queue } from 'bullmq';

/** How many recent failures a report carries. Enough to act on, small enough to poll. */
const DEFAULT_RECENT = 5;

/** `queue.clean()` takes a limit; this is "all of them" for a queue of our size. */
const CLEAN_LIMIT = 10_000;

/**
 * Drop every member of the failed set whose job hash is gone.
 *
 * BullMQ's client layer exposes only the commands the library itself uses, and none of them can
 * remove a member of the failed set — so this one script is registered on the connection and
 * called through `runCommand`. It is the only way to clear an entry BullMQ cannot see.
 */
const DROP_ORPHANS_SCRIPT = `
local ids = redis.call('ZRANGE', KEYS[1], 0, -1)
local removed = 0
for i = 1, #ids do
  if redis.call('EXISTS', ARGV[1] .. ids[i]) == 0 then
    removed = removed + redis.call('ZREM', KEYS[1], ids[i])
  end
end
return removed
`;

/** A failed job that still has a payload — the only kind a human can retry or inspect. */
export interface FailedJobInfo {
  id: string;
  /** The symbol the job carried, when it carried one (`sync-all`/poll jobs do not). */
  symbol: string | null;
  reason: string;
  /** When it failed (ms epoch), or null when BullMQ recorded no finish time. */
  failedAt: number | null;
}

export interface QueueFailureReport {
  /** Failed jobs whose payload still exists — what `getFailed()` can actually hand back. */
  failed: number;
  /**
   * Entries in the queue's `failed` set with no job payload.
   *
   * BullMQ's counters are the set's cardinality (`ZCARD`), not a count of jobs, so a member
   * whose hash is gone still counts as failed — and can never be retried, inspected or
   * removed through the library. They are counted separately here rather than inflating
   * `failed`, which is the number the dashboard shows.
   */
  orphans: number;
  /** The most recent failures, newest first. */
  recent: FailedJobInfo[];
}

/**
 * Split the `failed` set's members into the ones that still own a job hash and the leftovers.
 *
 * Pure, so the ghost case (a member with no payload) is testable without Redis.
 */
export function splitFailedMembers(
  members: string[],
  present: boolean[],
): { existing: string[]; orphans: string[] } {
  const existing: string[] = [];
  const orphans: string[] = [];
  members.forEach((id, i) => (present[i] ? existing.push(id) : orphans.push(id)));
  return { existing, orphans };
}

/**
 * Every member of the queue's `failed` set, with whether its job payload still exists.
 *
 * `queue.getFailed()` is the library's own view and silently drops members whose hash is gone,
 * which is why the count and the list disagreed in the first place: the count comes from the
 * set, the list from the hashes. Both are read here in one pass, so the gap is visible.
 */
async function failedMembers(queue: Queue): Promise<{ members: string[]; present: boolean[] }> {
  const client = await queue.client;
  const members = await client.zrange(queue.toKey('failed'), 0, -1);
  if (members.length === 0) return { members, present: [] };

  const pipeline = client.pipeline();
  for (const id of members) pipeline.hgetall(queue.toKey(id));
  const results = await pipeline.exec();
  // A missing job hash answers with an empty object rather than an error.
  const present = (results ?? []).map(
    ([err, value]) => !err && !!value && Object.keys(value as Record<string, unknown>).length > 0,
  );
  return { members, present };
}

/** The client, with the one command BullMQ has no way to express registered on it. */
const prepared = new WeakSet<object>();
async function scriptedClient(queue: Queue) {
  const client = await queue.client;
  if (!prepared.has(client as object)) {
    client.defineCommand('psxDropOrphanFailures', { numberOfKeys: 1, lua: DROP_ORPHANS_SCRIPT });
    prepared.add(client as object);
  }
  return client;
}

/**
 * What is actually failed in a queue: live jobs with their reason, plus the set members that
 * are nothing more than a leftover id.
 */
export async function inspectQueueFailures(
  queue: Queue,
  recent = DEFAULT_RECENT,
): Promise<QueueFailureReport> {
  const { members, present } = await failedMembers(queue);
  const { existing, orphans } = splitFailedMembers(members, present);

  // The set is scored by failure time, so the newest members are the tail. Fetch only those.
  const failures: FailedJobInfo[] = [];
  for (const id of recent > 0 ? existing.slice(-recent).reverse() : []) {
    const job = await queue.getJob(id);
    if (!job) continue;
    const data = (job.data ?? {}) as { symbol?: string };
    failures.push({
      id,
      symbol: data.symbol ?? null,
      reason: job.failedReason ?? 'unknown',
      failedAt: job.finishedOn ?? job.timestamp ?? null,
    });
  }

  return { failed: existing.length, orphans: orphans.length, recent: failures };
}

/**
 * Empty a queue's failed set.
 *
 * `queue.clean()` walks the set's members and takes the ones it matched — ghosts included —
 * so it is the first move. Anything still standing afterwards has no hash and no queue entry
 * BullMQ can act on, so it is dropped by the registered script; otherwise the counter keeps
 * counting a job that does not exist and nothing in the app can clear it.
 */
export async function clearQueueFailures(
  queue: Queue,
): Promise<{ removed: number; orphans: number }> {
  const { members, present } = await failedMembers(queue);
  const { existing, orphans: ghosts } = splitFailedMembers(members, present);
  if (existing.length > 0) await queue.clean(0, CLEAN_LIMIT, 'failed');

  const after = await failedMembers(queue);
  const { orphans: survivors } = splitFailedMembers(after.members, after.present);
  if (survivors.length > 0) {
    const client = await scriptedClient(queue);
    await client.runCommand('psxDropOrphanFailures', [
      queue.toKey('failed'),
      queue.toKey(''),
    ]);
  }

  // `orphans` reports what the set was hiding, not which mechanism removed it: a caller
  // reading the number wants to know how much of the count was never a job.
  return { removed: existing.length, orphans: ghosts.length };
}
