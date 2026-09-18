import { findUnsetFeatureSettings, FEATURE_SETTINGS } from '../src/config/envAudit';

describe('findUnsetFeatureSettings', () => {
  it('reports a setting that is absent, so its default is silently in force', () => {
    // The production case: the worker had no UNIVERSE_* variable at all.
    const unset = findUnsetFeatureSettings({ DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://y' });

    expect(unset.map((s) => s.name)).toContain('UNIVERSE_ENABLED');
    expect(unset.find((s) => s.name === 'UNIVERSE_ENABLED')!.effect).toMatch(/never walks the listed board/);
  });

  it('stays quiet about a setting the environment actually configures', () => {
    const unset = findUnsetFeatureSettings({
      UNIVERSE_ENABLED: 'false', // present, even when false — that is a deliberate choice
      UNIVERSE_PASS_CRON: '*/3 * * * *',
      UNIVERSE_PACING_MS: '1500',
      UNIVERSE_MAX_QUOTE_AGE_DAYS: '4',
      QUOTE_POLL_MARKET_HOURS_ONLY: 'true',
      CRON_EXPRESSION: '0 * * * *',
    });

    expect(unset).toEqual([]);
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
