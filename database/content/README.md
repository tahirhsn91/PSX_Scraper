# Company profiles

Editorial content for the stock page's **Company Description** section. One JSON file per company,
named after the symbol (`HUBC.json`), loaded into `company_profiles` / `company_products` by the
`company-profile-sync` job. It runs on its own weekly weekend schedule (default Saturday 02:00 UTC,
07:00 PKT), so a deploy that ships content reaches the database without anyone remembering to run
anything. The same loader is available by hand for a fresh database or a correction you do not want
to wait a week for:

```bash
docker exec -w /app/backend psx_scraper_ayyan-backend-1 npx tsx src/scripts/seedCompanyProfiles.ts
```

Both paths call the same service (`backend/src/services/companyProfileSync.service.ts`) and are
idempotent: re-running over the same files leaves the same rows.

## Why these files exist at all

None of this is scraped, and that is a finding rather than a shortcut: no source this project
integrates publishes a company description, CEO, website, phone number or product list. The
Sarmaaya company record our `sector` comes from carries identity and a quote and nothing else, its
stock page fetches no profile-shaped endpoint, and the exchange's own company pages are unreachable
from this host. See `psx-scraper-extraction` → `references/sarmaaya-rest-api.md`, and issue #180.

So this directory *is* the source. Everything here is written by a person.

## Format

```json
{
  "symbol": "HUBC",
  "description": "A short description of the business.",
  "headOffice": "9th Floor, Ocean Tower, Karachi 75600, Pakistan",
  "phone": "+92 21 3587 4677",
  "website": "https://hubpower.com",
  "ceo": "Kamran Kamal",
  "sourceNote": "Company website (about-us, business), read 2026-10-16.",
  "products": [
    { "name": "Hub Plant — thermal generation", "summary": "1,292 MW furnace-oil-fired station." }
  ]
}
```

Every field except `symbol` may be omitted or `null`, and a missing field renders as absent rather
than as a placeholder. A file with only `symbol` and `description` is perfectly valid and better
than one padded out with guesses.

## The rules these files have to keep

1. **Every claim must be attributable.** Fill in `sourceNote` naming where the content came from.
   If a fact cannot be sourced, leave the field out. A wrong product list on a stock page is worse
   than no product list.
2. **An image needs its provenance, or it does not ship.** `imagePath`, `imageSource` and
   `imageLicence` are all-or-nothing — the loader refuses a file that sets only some of them, and
   the API withholds an image whose source or licence is missing even if a row holds one. These are
   the only images on the site that do not come from a source we can re-derive.
3. **Never illustrate with someone else's asset.** A CC-licensed photograph of a cement plant in
   India is not a photograph of Lucky Cement's plant; attaching it to that company's product states
   something untrue without saying it. Use a company's own press image only with its permission,
   a CC-licensed image *of that company's own facility*, or nothing.
4. **Images live in the frontend**, referenced as a root-relative path
   (`/products/luck-cement-plant.jpg` in `frontend/public/products/`), never a remote URL — a
   product image that 404s later, or disappears with someone else's CDN, is worse than none.
5. **The symbol must already be tracked.** The loader never creates a stock row; an unknown symbol
   is reported and skipped.

## Coverage

511 symbols are tracked and all 511 have a write-up (batches 1–3, #180). A stock with no file
renders no section at all — no empty box, no placeholder — so a new listing simply waits for its
file.
