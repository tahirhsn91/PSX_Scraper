import { describe, expect, it } from 'vitest';
import { screenNameProblem, screenUrl } from './savedScreens';
import type { SavedScreen } from './savedScreens';

const screen = (name: string): SavedScreen => ({
  id: name.toLowerCase(),
  name,
  query: 'sector=OIL',
  savedAt: '2026-10-18T00:00:00.000Z',
});

describe('screenNameProblem', () => {
  it('rejects an empty or whitespace-only name', () => {
    expect(screenNameProblem([], '   ')).toBe('Give the screen a name.');
  });

  it('rejects a duplicate case-insensitively', () => {
    expect(screenNameProblem([screen('Banks')], 'banks')).toBe('A screen with that name already exists.');
  });

  it('rejects a name longer than 60 characters', () => {
    expect(screenNameProblem([], 'x'.repeat(61))).toBe('Keep the name under 60 characters.');
  });

  it('accepts a fresh name, trimmed', () => {
    expect(screenNameProblem([screen('Banks')], '  Dividend payers ')).toBeNull();
  });
});

describe('screenUrl', () => {
  it('builds an absolute link so a copied screen opens anywhere', () => {
    expect(screenUrl('sector=OIL&page=2')).toBe(`${window.location.origin}/screener?sector=OIL&page=2`);
  });

  it('omits the query separator when the screen is empty', () => {
    expect(screenUrl('')).toBe(`${window.location.origin}/screener`);
  });
});
