/**
 * Load the editorial company profiles into the database, once, by hand.
 *
 *   docker exec -w /app/backend psx_scraper_ayyan-backend-1 npx tsx src/scripts/seedCompanyProfiles.ts
 *
 * This is the manual path for a fresh database or a one-field correction. The same service runs on
 * its own weekly weekend schedule (`company-profile-sync` queue, COMPANY_PROFILE_SYNC_CRON), so a
 * deploy that ships content does not need this command to be remembered.
 */
import { prisma } from '../database/prisma';
import { syncCompanyProfiles } from '../services/companyProfileSync.service';

async function main() {
  const result = await syncCompanyProfiles();

  for (const f of result.failed) console.error(`  FAILED   ${f.file}: ${f.reason}`);
  for (const s of result.skipped) console.warn(`  SKIPPED  ${s}: not a tracked symbol`);
  for (const w of result.written) console.log(`  WRITTEN  ${w.symbol} (${w.products} products)`);

  console.log(
    `SUMMARY files=${result.files} written=${result.written.length} `
    + `skipped=${result.skipped.length} failed=${result.failed.length}`,
  );

  await prisma.$disconnect();
  process.exit(result.failed.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('ERR', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
