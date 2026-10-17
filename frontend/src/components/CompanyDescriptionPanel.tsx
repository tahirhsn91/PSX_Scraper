import { useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Card, Grid, Link, Stack, Typography } from '@mui/material';
import { SectionCard } from './ui/SectionCard';
import { StatTile } from './ui/StatTile';
import { DASH } from '../lib/format';
import type { CompanyProfile } from '../types';

/**
 * The stock page's **Company Description** section (#180).
 *
 * Editorial content: a description of the business, its sector, head office, phone, website and
 * CEO, and the products it makes with a picture where one is cleared for use. Every field is
 * optional and a missing one renders as a dash rather than a guess, because none of this is
 * scraped — it is written by hand, per company, from attributable sources.
 *
 * The parent renders nothing when there is no profile: for now that is most of the board, so
 * absence has to be silent rather than an empty card.
 */

interface Props {
  profile: CompanyProfile;
  /** The stock's sector, already on the detail payload. Rendered here because it orients the reader. */
  sector: string | null;
}

/**
 * The sector as a reader can use it.
 *
 * `"undefined"` arrives as literal text from a known data defect upstream, and null means no
 * company record was scraped. Neither names a sector, so both become a dash.
 */
function usableSector(sector: string | null): string | null {
  if (!sector || sector === 'undefined') return null;
  return sector;
}

/** A website or a phone only becomes a link when there is something real to point at. */
function websiteHref(website: string | null): string | null {
  const w = website?.trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

function ProductCard({ product }: { product: CompanyProfile['products'][number] }) {
  return (
    <Card variant="outlined" sx={{ height: '100%', overflow: 'hidden' }}>
      {/* Only rendered with a cleared image, and `loading="lazy"` + `aspectRatio` so an image
       * arriving later cannot become a layout shift — this block sits well below the fold. */}
      {product.imagePath && (
        <Box
          component="img"
          src={product.imagePath}
          alt={product.name}
          loading="lazy"
          decoding="async"
          sx={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', bgcolor: 'action.hover' }}
        />
      )}
      <Box sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" component="h3">
          {product.name}
        </Typography>
        {product.summary && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {product.summary}
          </Typography>
        )}
        {/* The credit is not decoration: an image we publish has to say where it came from. */}
        {product.imagePath && product.imageLicence && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Image: {product.imageSource} · {product.imageLicence}
          </Typography>
        )}
      </Box>
    </Card>
  );
}

export function CompanyDescriptionPanel({ profile, sector }: Props) {
  const href = websiteHref(profile.website);
  // Across the 511 write-ups the description runs to 470 characters at the median and 889 at the
  // top; products run to 3 at the median and 9 at the top. Both are secondary to the description's
  // opening and the contact block, so they start folded and say how much more there is.
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const visibleProducts = showAllProducts ? profile.products : profile.products.slice(0, 3);
  // A character count is a poor proxy for "hidden text": a 350-character write-up can fit in
  // three lines, and a Read more that changes nothing is worse than no button. Measure the box
  // once, unclamped: a four-line write-up is short enough to show whole, and only five lines or
  // more earns a toggle that pays for its own 32px button.
  const descRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    setClamped(el.scrollHeight > line * 4 + 1);
  }, [profile.description]);

  return (
    <SectionCard title="Company Description">
      <Stack spacing={2.5}>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={6} md={4}>
            <StatTile label="Sector" value={usableSector(sector) ?? DASH} />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatTile label="CEO" value={profile.ceo ?? DASH} />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatTile
              label="Phone"
              value={
                profile.phone ? (
                  <Link href={`tel:${profile.phone.replace(/\s+/g, '')}`}>{profile.phone}</Link>
                ) : (
                  DASH
                )
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatTile
              label="Website"
              value={
                href ? (
                  <Link href={href} target="_blank" rel="noopener noreferrer">
                    {profile.website}
                  </Link>
                ) : (
                  DASH
                )
              }
            />
          </Grid>
          <Grid item xs={12} sm={12} md={8}>
            <StatTile label="Head office" value={profile.headOffice ?? DASH} />
          </Grid>
        </Grid>

        {profile.description && (
          <Box>
            <Typography
              ref={descRef}
              variant="body1"
              sx={{
                maxWidth: '80ch',
                // Three lines is the gist; the median write-up is ~470 characters, so most open
                // past the fold.
                ...(clamped && !showFullDescription
                  ? {
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }
                  : {}),
              }}
            >
              {profile.description}
            </Typography>
            {clamped && (
              <Button
                size="small"
                onClick={() => setShowFullDescription((v) => !v)}
                aria-expanded={showFullDescription}
                sx={{ mt: 0.5, minHeight: 32 }}
              >
                {showFullDescription ? 'Show less' : 'Read more'}
              </Button>
            )}
          </Box>
        )}

        {profile.products.length > 0 && (
          <Box>
            <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
              Products
            </Typography>
            <Grid container spacing={1.5}>
              {visibleProducts.map((product) => (
                <Grid item xs={12} sm={6} md={4} key={product.name}>
                  <ProductCard product={product} />
                </Grid>
              ))}
            </Grid>
            {profile.products.length > 3 && (
              <Button
                size="small"
                onClick={() => setShowAllProducts((v) => !v)}
                aria-expanded={showAllProducts}
                sx={{ mt: 1 }}
              >
                {showAllProducts
                  ? 'Show fewer products'
                  : `Show all ${profile.products.length} products`}
              </Button>
            )}
            {/* Said plainly rather than left to be noticed: these are ours to source, and an
             * unattributed image is deliberately not shown. */}
            {profile.products.some((p) => !p.imagePath) && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Product images are shown only where the picture is of that company&apos;s own
                facility and its licence is recorded.
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </SectionCard>
  );
}
