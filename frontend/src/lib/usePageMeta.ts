import { useEffect, useRef } from 'react';

function upsertMetaDescription(content: string) {
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

/**
 * Per-route document head (SPA SEO). Sets the tab title and meta description for the current page
 * and restores whatever was there before when the page unmounts, so a stock page's title never
 * leaks onto the dashboard. No `react-helmet` dependency — the two tags the SEO pass needs are
 * managed directly.
 */
export function usePageMeta(title?: string, description?: string) {
  const original = useRef<{ title: string; description: string } | null>(null);
  if (original.current === null) {
    original.current = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    };
  }

  useEffect(() => {
    if (title) document.title = title;
    if (description) upsertMetaDescription(description);
    return () => {
      document.title = original.current!.title;
      upsertMetaDescription(original.current!.description);
    };
  }, [title, description]);
}
