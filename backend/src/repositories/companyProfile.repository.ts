import { prisma } from '../database/prisma';

/**
 * Read model for the stock page's "Company Description" section.
 *
 * Everything this returns is editorial — hand-written per company, not scraped. See the header of
 * `database/prisma/migrations/0020_company_profiles/migration.sql` for why (no integrated source
 * publishes a description, CEO, website, phone or product list).
 *
 * The important distinction this module exists to keep: a **stock we do not track** and a **stock
 * with no profile yet** are different answers. The first is a 404; the second is a perfectly
 * ordinary `null`, because for the foreseeable future most of the 511 tracked symbols will have no
 * profile, and the section's absence is the normal case rather than a fault.
 */
export interface CompanyProduct {
  name: string;
  summary: string | null;
  /**
   * Served by this app, never a remote URL.
   *
   * Null unless the image is *also* licensed: an image whose provenance we cannot state is not one
   * we publish, so an `image_source`/`image_licence`-less row keeps its name and summary and simply
   * has no picture. Dropping the image is deliberate — see `toWireProduct`.
   */
  imagePath: string | null;
  imageSource: string | null;
  imageLicence: string | null;
}

export interface CompanyProfile {
  description: string | null;
  headOffice: string | null;
  phone: string | null;
  website: string | null;
  ceo: string | null;
  sourceNote: string | null;
  updatedAt: string;
  products: CompanyProduct[];
}

/** A stock's profile, or `null` for a stock that has none. The outer `null` means untracked. */
export interface CompanyProfileRead {
  symbol: string;
  profile: CompanyProfile | null;
}

/**
 * An image we cannot attribute is not shown.
 *
 * The licence and the source are the whole reason a product image is storable at all: these are the
 * only images on the page that do not come from a source we can re-derive, so an unattributed one
 * is a legal and editorial liability rather than a missing nicety. Return the path only when both
 * are present, and keep the fields themselves so the gap is visible to whoever fills it in.
 */
function toWireProduct(p: {
  name: string;
  summary: string | null;
  imagePath: string | null;
  imageSource: string | null;
  imageLicence: string | null;
}): CompanyProduct {
  const attributable = Boolean(p.imagePath && p.imageSource && p.imageLicence);
  return {
    name: p.name,
    summary: p.summary,
    imagePath: attributable ? p.imagePath : null,
    imageSource: p.imageSource,
    imageLicence: p.imageLicence,
  };
}

/**
 * One stock's company profile.
 *
 * Returns `null` when the symbol is not tracked, so the caller can 404 it the way every other
 * per-symbol read does, and `{ profile: null }` when the symbol is tracked but nobody has written a
 * profile yet.
 */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfileRead | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol: symbol.toUpperCase() },
    select: {
      symbol: true,
      profile: {
        select: {
          description: true,
          headOffice: true,
          phone: true,
          website: true,
          ceo: true,
          sourceNote: true,
          updatedAt: true,
          // The writer chooses the reading order, so the position is the sort — the same way
          // income-statement lines render in the order the source prints them.
          products: {
            orderBy: { position: 'asc' },
            select: {
              name: true,
              summary: true,
              imagePath: true,
              imageSource: true,
              imageLicence: true,
            },
          },
        },
      },
    },
  });

  if (stock === null) return null;

  const p = stock.profile;
  return {
    symbol: stock.symbol,
    profile:
      p === null
        ? null
        : {
            description: p.description,
            headOffice: p.headOffice,
            phone: p.phone,
            website: p.website,
            ceo: p.ceo,
            sourceNote: p.sourceNote,
            updatedAt: p.updatedAt.toISOString(),
            products: p.products.map(toWireProduct),
          },
  };
}
