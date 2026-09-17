import type { Job } from 'bullmq';
import { UNIVERSE_PASS_JOB, type UniverseJobData } from '../jobs/queues';
import { runUniverseSymbol, startUniversePass } from '../services/universeRunner.service';

/**
 * Universe queue processor — one job per pass, then one job per symbol.
 *
 * Runs with concurrency 1 (see workers/index.ts) because the whole point of the pass is to walk
 * the board one symbol at a time rather than burst the source, which is what earned the
 * source-side refusal in #27.
 */
export async function processUniverseJob(job: Job<UniverseJobData>): Promise<unknown> {
  if (job.name === UNIVERSE_PASS_JOB) {
    return startUniversePass(job.data.kind ?? 'auto');
  }
  const { symbol } = job.data;
  if (!symbol) throw new Error(`Universe symbol job ${job.id ?? ''} carries no symbol`);
  // Symbol jobs always come from a pass that already resolved the clock, so `auto` never reaches
  // here; the fallback only keeps the log label honest.
  return runUniverseSymbol(symbol, job.data.kind === 'close' ? 'close' : 'intraday');
}
