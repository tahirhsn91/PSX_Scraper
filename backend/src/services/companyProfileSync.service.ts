/**
 * Load the editorial company profiles into the database.
 *
 * The content lives in `database/content/companies/<SYMBOL>.json` and is committed, so a change to
 * a company's write-up is reviewable in a PR rather than made in a database nobody can see. This
 * service is the only path in, and it is idempotent: re-running it over the same files leaves the
 * same rows, so it is safe after a rebuild, a fresh clone, or an edit to one field.
 *
 * It has two callers and that is deliberate:
 *
 *   * `scripts/seedCompanyProfiles.ts` — the manual command, for a fresh database or a one-field
 *     correction;
 *   * `workers/companyProfileProcessor.ts` — the weekly weekend job, so content that ships with a
 *     deploy reaches the database without anyone remembering to run the script.
 *
 * Two refusals are deliberate and are the point of validating at all:
 *
 *   * a file that sets only part of the image triple (`imagePath` / `imageSource` /
 *     `imageLicence`) is rejected, not silently trimmed — see the README for why an unattributable
 *     image is worse than a missing one;
 *   * an unknown symbol is reported and skipped. The loader must never create a `stocks` row: a
 *     write-up is about a company we track, and inventing the symbol to hold it would put an
 *     untracked ticker on the dashboard.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../database/prisma';

/** The committed content folder: `<repo>/database/content/companies` from `src/` and `dist/`. */
export const COMPANY_CONTENT_DIR = path.resolve(__dirname, '../../../database/content/companies');

/** All-or-nothing: an image ships with where it came from and under what licence, or not at all. */
const productSchema = z
  .object({
    name: z.string().min(1),
    summary: z.string().nullish(),
    imagePath: z.string().nullish(),
    imageSource: z.string().nullish(),
    imageLicence: z.string().nullish(),
  })
  .strict()
  .refine(
    (p) => {
      const set = [p.imagePath, p.imageSource, p.imageLicence].filter(
        (v) => v !== null && v !== undefined && v !== '',
      );
      return set.length === 0 || set.length === 3;
    },
    {
      message:
        'an image needs imagePath, imageSource and imageLicence together — an image whose '
        + 'provenance cannot be stated is not published',
    },
  );

/** `_comment` is allowed so a file can explain itself; anything else unknown is a typo and fails. */
const profileSchema = z
  .object({
    _comment: z.string().optional(),
    symbol: z.string().min(1),
    description: z.string().nullish(),
    headOffice: z.string().nullish(),
    phone: z.string().nullish(),
    website: z.string().nullish(),
    ceo: z.string().nullish(),
    sourceNote: z.string().nullish(),
    products: z.array(productSchema).default([]),
  })
  .strict();

type ProfileFile = z.infer<typeof profileSchema>;

export interface CompanyProfileSyncOptions {
  /** Directory of `<SYMBOL>.json` files. Defaults to the committed content folder. */
  contentDir?: string;
}

export interface CompanyProfileWrite {
  symbol: string;
  /** How many products were written with the profile. */
  products: number;
}

export interface CompanyProfileSyncResult {
  directory: string;
  /** JSON files found in the directory. */
  files: number;
  written: CompanyProfileWrite[];
  /** Tracked-looking files whose symbol is not in `stocks`; never created. */
  skipped: string[];
  /** Files that failed validation or the transaction. */
  failed: { file: string; reason: string }[];
}

/**
 * Upsert every profile file in `contentDir`.
 *
 * Returns counts rather than throwing on a bad file: one malformed write-up must not stop the
 * other 510 from loading, and the caller decides how loud to be about `failed` (the CLI exits
 * non-zero, the job fails after the good files are already written).
 */
export async function syncCompanyProfiles(
  options: CompanyProfileSyncOptions = {},
): Promise<CompanyProfileSyncResult> {
  const directory = options.contentDir ?? COMPANY_CONTENT_DIR;
  const files = (await readdir(directory)).filter((f) => f.endsWith('.json')).sort();

  const written: CompanyProfileWrite[] = [];
  const skipped: string[] = [];
  const failed: { file: string; reason: string }[] = [];

  for (const file of files) {
    let parsed: ProfileFile;
    try {
      const raw = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      parsed = profileSchema.parse(raw);
    } catch (err) {
      failed.push({ file, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const symbol = parsed.symbol.toUpperCase();
    try {
      const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
      if (stock === null) {
        // A write-up for a company we do not track. Reported, never created — the loader is not a
        // back door into the symbol list.
        skipped.push(symbol);
        continue;
      }

      const content = {
        description: parsed.description ?? null,
        headOffice: parsed.headOffice ?? null,
        phone: parsed.phone ?? null,
        website: parsed.website ?? null,
        ceo: parsed.ceo ?? null,
        sourceNote: parsed.sourceNote ?? null,
      };

      await prisma.$transaction(async (tx) => {
        const profile = await tx.companyProfile.upsert({
          where: { stockId: stock.id },
          update: content,
          create: { stockId: stock.id, ...content },
        });

        // Replace wholesale rather than diff: the file is the truth, so a product removed from it
        // must disappear from the page. Position is the array index, which is why order in the file
        // is meaningful.
        await tx.companyProduct.deleteMany({ where: { profileId: profile.id } });
        if (parsed.products.length > 0) {
          await tx.companyProduct.createMany({
            data: parsed.products.map((p, index) => ({
              profileId: profile.id,
              name: p.name,
              summary: p.summary ?? null,
              imagePath: p.imagePath ?? null,
              imageSource: p.imageSource ?? null,
              imageLicence: p.imageLicence ?? null,
              position: index,
            })),
          });
        }
      });

      written.push({ symbol, products: parsed.products.length });
    } catch (err) {
      failed.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { directory, files: files.length, written, skipped, failed };
}
