import { findUnsetFeatureSettings, FEATURE_SETTINGS } from '../src/config/envAudit';

describe('findUnsetFeatureSettings', () => {
  it('reports a setting that is absent, so its default is silently in force', () => {
    // The production case: the worker had no UNIVERSE_* variable at all.
    const unset = findUnsetFeatureSettings({ DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://y' });

    expect(unset.map((s) => s.name)).toContain('UNIVERSE_ENABLED');
    expect(unset.find((s) => s.name === 'UNIVERSE_ENABLED')!.effect).toMatch(/never walks the listed board/);
  });

  it('stays quiet about a setting the environment actually configures', () => {
    // Derived from the list on purpose. Hardcoding the names is what let this test trail the
    // settings `758bfdf` added: the audit grew a `DAILY_BOARD_*` entry, this fixture did not,
    // and the suite went red for a reason that had nothing to do with the audit's behaviour.
    const configured: Record<string, string> = Object.fromEntries(
      FEATURE_SETTINGS.map((s) => [s.name, '1']),
    );
    configured.UNIVERSE_ENABLED = 'false'; // present, even when false — that is a deliberate choice
    configured.QUOTE_POLL_MARKET_HOURS_ONLY = 'true';

    expect(findUnsetFeatureSettings(configured)).toEqual([]);
    // …and the fixture has teeth: dropping one setting reports exactly that one.
    const { DAILY_BOARD_HOUR: _dropped, ...missing } = configured;
    expect(findUnsetFeatureSettings(missing).map((s) => s.name)).toEqual(['DAILY_BOARD_HOUR']);
  });

  it('treats an explicitly empty value as configured, not as missing', () => {
    // An empty string is a value someone set; only `undefined` means "never configured".
    const unset = findUnsetFeatureSettings({ UNIVERSE_ENABLED: '' });
    expect(unset.map((s) => s.name)).not.toContain('UNIVERSE_ENABLED');
  });

  it('covers every listed setting exactly once', () => {
    const names = FEATURE_SETTINGS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('UNIVERSE_ENABLED');
  });
});
