/**
 * The device token: an opaque id this browser generates once and keeps.
 *
 * It is the entire ownership model for alerts — no account, no email, no cookie. Clearing site data
 * loses the alerts with it, which the page says out loud rather than letting it be a surprise.
 */
const KEY = 'psx:device-token';

export function deviceToken(): string {
  const existing = localStorage.getItem(KEY);
  if (existing && existing.length >= 8) return existing;
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  localStorage.setItem(KEY, fresh);
  return fresh;
}
