import { Job } from 'bullmq';
import { CompanyProfileSyncJobData } from '../jobs/queues';
import { syncCompanyProfiles } from '../services/companyProfileSync.service';
import { childLogger } from '../utils/logger';

/**
 * The weekly company-profile sync.
 *
 * Writes every committed `database/content/companies/*.json` file into `company_profiles` /
 * `company_products`. The service is idempotent, so a retry — or a manual run overlapping the
 * schedule — re-writes the same rows rather than duplicating anything.
 *
 * A bad file must not pass as a normal run: the good files are written, then the job throws with
 * the list, so the failure shows up on the queue (and the status endpoint) instead of hiding in a
 * "completed" result with a skipped count nobody reads.
 */
export async function processCompanyProfileSyncJob(
  job: Job<CompanyProfileSyncJobData>,
): Promise<unknown> {
  const log = childLogger({ op: 'company-profile-sync', trigger: job.data.trigger });
  const startedAt = Date.now();

  const result = await syncCompanyProfiles();

  log.info('company_profile_sync.completed', {
    directory: result.directory,
    files: result.files,
    written: result.written.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
    durationMs: Date.now() - startedAt,
  });

  if (result.skipped.length > 0) {
    log.warn('company_profile_sync.skipped_untracked', { symbols: result.skipped });
  }
  if (result.failed.length > 0) {
    log.error('company_profile_sync.failed_files', { failed: result.failed });
    throw new Error(
      `company profile sync: ${result.failed.length} of ${result.files} files failed — `
        + result.failed.map((f) => `${f.file}: ${f.reason}`).join('; '),
    );
  }

  return {
    files: result.files,
    written: result.written.length,
    skipped: result.skipped.length,
    failed: 0,
  };
}
