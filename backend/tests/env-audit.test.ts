import { findUnsetFeatureSettings, FEATURE_SETTINGS } from '../src/config/envAudit';

describe('findUnsetFeatureSettings', () => {
  it('reports a setting that is absent, so its default is silently in force', () => {
    // The production case: the worker had no UNIVERSE_* variable at all.
    const unset = findUnsetFeatureSettings({ DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://y' });

    expect(unset.map((s) => s.name)).toContain('UNIVERSE_ENABLED');
    expect(unset.find((s) => s.name === 'UNIVERSE_ENABLED')!.effect).toMatch(/never walks the listed board/);
  });

  it('stays quiet about a setting the environment actually configures', () => {
    // Every setting present, however it is set — present-and-false is a deliberate choice, not a
    // gap. Derived from the list itself rather than spelled out, so adding a setting cannot break
    // this test, which is what happened when the daily-board settings were added.
    const configured = Object.fromEntries(FEATURE_SETTINGS.map((s) => [s.name, 'configured']));
    const unset = findUnsetFeatureSettings(configured);

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
