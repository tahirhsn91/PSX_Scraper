import { env } from './env';

/**
 * Settings that switch a feature on or off, and what an *unset* one means.
 *
 * A release can add one of these and land in production with the feature silently off: every
 * value has a code default, and nothing — the logs, the deploy output, the health check, the
 * tests — says the setting is missing. The only symptom is absence, which reads like a bug in
 * something else. That is exactly what happened with the universe worker: production never
 * showed its symbols because `UNIVERSE_ENABLED` had never been set there, and neither the deploy
 * nor the app mentioned the setting at all.
 *
 * So the app now says it out loud at start-up: for every setting in this list that is not present
 * in the environment, log the effective default and what it means. List-driven and pure, so it is
 * testable and adding a setting is one line.
 */
export interface FeatureSetting {
  name: string;
  /** What the code default does — i.e. what is being missed. */
  effect: string;
  /** The value in force right now, for the log line. */
  effective: () => string;
}

export const FEATURE_SETTINGS: FeatureSetting[] = [
  {
    name: 'UNIVERSE_ENABLED',
    effect: 'the universe worker never walks the listed board, so no symbols are discovered or added',
    effective: () => String(env.UNIVERSE_ENABLED),
  },
  {
    name: 'UNIVERSE_PASS_CRON',
    effect: 'default pass cadence (*/3 * * * *) is used; the runner still gates on market hours',
    effective: () => env.UNIVERSE_PASS_CRON,
  },
  {
    name: 'UNIVERSE_PACING_MS',
    effect: 'default 1500ms between symbols inside a pass',
    effective: () => String(env.UNIVERSE_PACING_MS),
  },
  {
    name: 'UNIVERSE_MAX_QUOTE_AGE_DAYS',
    effect: 'default 4 days: a quote older than this is treated as a delisted page, never added',
    effective: () => String(env.UNIVERSE_MAX_QUOTE_AGE_DAYS),
  },
  {
    name: 'QUOTE_POLL_MARKET_HOURS_ONLY',
    effect: 'default true: the live-quote poll stops outside the PSX session',
    effective: () => String(env.QUOTE_POLL_MARKET_HOURS_ONLY),
  },
  {
    name: 'CRON_EXPRESSION',
    effect: 'default 0 * * * *: full board sync / index cadence',
    effective: () => env.CRON_EXPRESSION,
  },
];

/**
 * Which of those settings are absent from the environment, so their default applies.
 *
 * Pure: takes the environment as a plain record, which is what makes it testable.
 */
export function findUnsetFeatureSettings(
  envVars: Record<string, string | undefined> = process.env,
): FeatureSetting[] {
  return FEATURE_SETTINGS.filter((setting) => envVars[setting.name] === undefined);
}

/** Ready-to-log view of the settings a deploy forgot to configure. */
export function auditFeatureSettings(
  envVars: Record<string, string | undefined> = process.env,
): { setting: string; effective: string; meaning: string }[] {
  return findUnsetFeatureSettings(envVars).map((s) => ({
    setting: s.name,
    effective: s.effective(),
    meaning: s.effect,
  }));
}
