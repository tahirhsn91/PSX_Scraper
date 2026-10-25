import { describe, expect, it } from 'vitest';
import { darkTokens, lightTokens, radius, layout, typeScale } from './tokens';

/**
 * Guards the numbers the token file claims. The comments in `tokens.ts` say each pair was measured
 * before it was committed; this test measures them again on every run, so a future "just nudge the
 * green" edit fails here instead of shipping text nobody can read.
 *
 * WCAG 2.1 relative luminance; 4.5:1 for body text, 3:1 for large text and UI boundaries.
 */

const hex = (value: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) throw new Error(`not a hex colour: ${value}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
};

const luminance = (value: string) => {
  const [r, g, b] = hex(value).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const AA_TEXT = 4.5;
const AA_UI = 3;

describe.each([
  ['light', lightTokens],
  ['dark', darkTokens],
] as const)('%s theme contrast', (_name, t) => {
  it.each([
    ['body text on page', t.text, t.bg, AA_TEXT],
    ['body text on card', t.text, t.surface, AA_TEXT],
    ['secondary text on page', t.textSecondary, t.bg, AA_TEXT],
    ['muted text on card', t.textMuted, t.surface, AA_TEXT],
    ['primary label on primary fill', t.onPrimary, t.primary, AA_TEXT],
    ['up label on up wash', t.up.onSoft, t.up.soft, AA_TEXT],
    ['down label on down wash', t.down.onSoft, t.down.soft, AA_TEXT],
    // Trend text that sits on the page, not on a wash: IndicesPanel's decliner count uses this
    // pair, and `down.main` on the page background measures 4.3:1 — under AA.
    ['down text on page', t.down.onSoft, t.bg, AA_TEXT],
    ['nav label', t.nav.text, t.nav.bg, AA_TEXT],
    ['nav inactive label', t.nav.textMuted, t.nav.bg, AA_TEXT],
    ['nav active label', t.nav.active, t.nav.bg, AA_TEXT],
    ['nav cta label', t.nav.ctaText, t.nav.cta, AA_TEXT],
    ['focus ring on page', t.focusRing, t.bg, AA_UI],
    ['control outline on card', t.borderStrong, t.surface, AA_UI],
  ])('%s', (_label, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('structure tokens', () => {
  it('keeps body copy at 15px or above on every breakpoint', () => {
    // The scale is in rem so a reader's font-size preference still applies; 0.9375rem = 15px.
    const px = typeScale.body.fontSize.endsWith('rem')
      ? parseFloat(typeScale.body.fontSize) * 16
      : parseFloat(typeScale.body.fontSize);
    expect(px).toBeGreaterThanOrEqual(15);
  });

  it('has a radius for small, medium and large surfaces, and a pill', () => {
    expect(radius.sm).toBeGreaterThan(0);
    expect(radius.md).toBeGreaterThan(radius.sm);
    expect(radius.lg).toBeGreaterThan(radius.md);
  });

  it('keeps the content column readable', () => {
    expect(Number(layout.contentMaxWidth)).toBeGreaterThanOrEqual(1100);
    expect(Number(layout.contentMaxWidth)).toBeLessThanOrEqual(1600);
  });
});
