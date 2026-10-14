import { useEffect, useRef } from 'react';

/**
 * The head tags this hook owns, beyond the title.
 *
 * Each entry knows how to find its tag and how to create it if it is missing. `og:image` and the
 * Twitter equivalents are normally already present as static defaults in `index.html`; the rest are
 * created on first use.
 */
const SHARE_TAGS: { selector: string; attrs: Record<string, string> }[] = [
  { selector: 'meta[name="description"]', attrs: { name: 'description' } },
  { selector: 'meta[property="og:title"]', attrs: { property: 'og:title' } },
  { selector: 'meta[property="og:description"]', attrs: { property: 'og:description' } },
  { selector: 'meta[property="og:url"]', attrs: { property: 'og:url' } },
  { selector: 'meta[property="og:image"]', attrs: { property: 'og:image' } },
  { selector: 'meta[name="twitter:title"]', attrs: { name: 'twitter:title' } },
  { selector: 'meta[name="twitter:description"]', attrs: { name: 'twitter:description' } },
  { selector: 'meta[name="twitter:image"]', attrs: { name: 'twitter:image' } },
];

/** The site-wide share card. Absolute, because a relative `og:image` is silently ignored. */
const DEFAULT_SHARE_IMAGE = '/og-image.png';

function upsertTag(selector: string, attrs: Record<string, string>): HTMLMetaElement {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    for (const [key, value] of Object.entries(attrs)) tag.setAttribute(key, value);
    document.head.appendChild(tag);
  }
  return tag;
}

/** Resolve a path to the absolute URL these tags require. */
function absolute(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, window.location.origin).href;
  } catch {
    return pathOrUrl;
  }
}

/**
 * Per-route document head: the tab title, the meta description, and the social share tags.
 *
 * A single page's head is set on mount and restored on unmount, so a stock's title never lingers on
 * the dashboard.
 *
 * On *why* the static tags in `index.html` still matter: WhatsApp, Facebook, X, LinkedIn, Slack and
 * Discord fetch the HTML and do not execute JavaScript, so nothing written here is visible to them —
 * they read the defaults in `index.html`, which is what actually produces a link preview. These
 * mirrors exist for crawlers that do run JS (Google's, most importantly) so every surface reports
 * the same title and description rather than disagreeing.
 *
 * `image` overrides the site-wide card for a page that has a better one. Pass `undefined` while data
 * is still loading so the default holds rather than a half-built value.
 */
export function usePageMeta(title?: string, description?: string, image?: string) {
  const original = useRef<{
    title: string;
    tags: Map<string, string | null>;
  } | null>(null);

  if (original.current === null) {
    original.current = {
      title: document.title,
      tags: new Map(
        SHARE_TAGS.map(({ selector }) => [
          selector,
          document.head.querySelector<HTMLMetaElement>(selector)?.getAttribute('content') ?? null,
        ]),
      ),
    };
  }

  useEffect(() => {
    if (title) document.title = title;

    const canonical = absolute(window.location.pathname + window.location.search);
    const shareImage = absolute(image ?? DEFAULT_SHARE_IMAGE);

    for (const { selector, attrs } of SHARE_TAGS) {
      const tag = upsertTag(selector, attrs);

      switch (selector) {
        case 'meta[name="description"]':
        case 'meta[property="og:description"]':
        case 'meta[name="twitter:description"]':
          if (description) tag.setAttribute('content', description);
          break;
        case 'meta[property="og:url"]':
          tag.setAttribute('content', canonical);
          break;
        case 'meta[property="og:image"]':
        case 'meta[name="twitter:image"]':
          tag.setAttribute('content', shareImage);
          break;
        default:
          // og:title and twitter:title follow the document title.
          if (title) tag.setAttribute('content', title);
      }
    }

    return () => {
      document.title = original.current!.title;
      for (const { selector } of SHARE_TAGS) {
        const previous = original.current!.tags.get(selector);
        if (previous === null || previous === undefined) continue;
        const tag = document.head.querySelector<HTMLMetaElement>(selector);
        if (tag) tag.setAttribute('content', previous);
      }
    };
  }, [title, description, image]);
}
