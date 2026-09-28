import {
  SUPPLEMENTARY_INDICES,
  registerSupplementaryIndices,
  type SupplementaryDeps,
} from '../src/services/supplementaryIndices.service';

/**
 * An index published only in Sarmaaya's indexes section — HBLTTI — is on neither board, so the
 * board read can never introduce it. It is registered from the source that publishes it, and only
 * after the source answers for it: a mistyped or delisted symbol must not become a tracked index
 * with nothing behind it, and nothing may be invented for one that is skipped.
 */
const deps = (overrides: Partial<SupplementaryDeps> = {}): SupplementaryDeps => {
  const created: Array<{ symbol: string; name: string }> = [];
  const base: SupplementaryDeps = {
    findBySymbol: async () => null,
    create: async (symbol, name) => {
      created.push({ symbol, name });
    },
    sourceSessions: async () => 22,
    backfill: async () => ({ fetched: 22, inserted: 22 }),
    markSynced: async () => {},
    ...overrides,
  };
  (base as unknown as { created: typeof created }).created = created;
  return base;
};

const createdWith = (d: SupplementaryDeps) => (d as unknown as { created: Array<{ symbol: string; name: string }> }).created;

describe('the indices no board carries', () => {
  it('names HBLTTI, the index this exists for', () => {
    const entry = SUPPLEMENTARY_INDICES.find((i) => i.symbol === 'HBLTTI');

    expect(entry?.name).toMatch(/HBL/i);
    expect(entry?.name.trim()).not.toBe('HBLTTI');
  });

  it('registers the index once the source publishes sessions for it', async () => {
    const d = deps();

    const registered = await registerSupplementaryIndices(d);

    expect(registered).toEqual(['HBLTTI']);
    expect(createdWith(d)).toEqual([{ symbol: 'HBLTTI', name: 'HBL Total Treasury Index' }]);
  });

  it('fills the history from the source, insert-only, on the same call', async () => {
    const calls: string[] = [];
    const d = deps({
      backfill: async (symbol) => {
        calls.push(symbol);
        return { fetched: 22, inserted: 22 };
      },
    });

    await registerSupplementaryIndices(d);

    expect(calls).toEqual(['HBLTTI']);
  });

  it('registers nothing when the source publishes no session for the symbol', async () => {
    const d = deps({ sourceSessions: async () => 0 });

    const registered = await registerSupplementaryIndices(d);

    expect(registered).toEqual([]);
    expect(createdWith(d)).toEqual([]);
  });

  it('registers nothing when the source cannot be asked at all', async () => {
    const d = deps({
      sourceSessions: async () => {
        throw new Error('ENETUNREACH');
      },
    });

    await expect(registerSupplementaryIndices(d)).resolves.toEqual([]);
    expect(createdWith(d)).toEqual([]);
  });

  it('keeps an index we already track registered, and refreshes it instead of re-creating it', async () => {
    let asked = 0;
    const fills: string[] = [];
    const synced: string[] = [];
    const d = deps({
      findBySymbol: async () => ({ id: 'idx-1' }),
      sourceSessions: async () => {
        asked += 1;
        return 22;
      },
      backfill: async (symbol) => {
        fills.push(symbol);
        return { fetched: 22, inserted: 0 };
      },
      markSynced: async (symbol) => {
        synced.push(symbol);
      },
    });

    const registered = await registerSupplementaryIndices(d);

    expect(registered).toEqual([]);
    expect(createdWith(d)).toEqual([]);
    // No re-probe and no second row: it is tracked, so the source check has nothing left to decide.
    expect(asked).toBe(0);
    // Nothing else keeps these rows current — the per-index sync reads the exchange's own series.
    expect(fills).toEqual(['HBLTTI']);
    // And the read is recorded, so a series we do hold is not read as never-synced.
    expect(synced).toEqual(['HBLTTI']);
  });

  it('keeps the row when the history fill fails, and does not throw', async () => {
    const d = deps({
      backfill: async () => {
        throw new Error('price-history/HBLTTI -> HTTP 503');
      },
    });

    const registered = await registerSupplementaryIndices(d);

    // The row is the registration; the series is retried by the next pass.
    expect(registered).toEqual(['HBLTTI']);
    expect(createdWith(d)).toHaveLength(1);
  });
});
