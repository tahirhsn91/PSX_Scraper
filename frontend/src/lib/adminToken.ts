/**
 * The admin token, as held by this browser.
 *
 * The **token itself** is deliberately never a `VITE_` build variable: anything with that prefix is
 * compiled into the bundle and served to every visitor, which would make it public. It is typed in
 * once by the operator and kept in localStorage; the API checks it on every mutating request.
 * The **storage key** is configuration (`VITE_ADMIN_TOKEN_KEY`), which is safe to expose — it only
 * names where the browser keeps the value.
 */
// The storage key is deployment configuration, not a literal: a staging deployment can use its own
// key so a token saved for one environment is never read by another.
const KEY = import.meta.env.VITE_ADMIN_TOKEN_KEY || 'psx:admin-token';

export function adminToken(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) localStorage.setItem(KEY, trimmed);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the mutations will 401, which is the honest outcome */
  }
}

export function clearAdminToken(): void {
  setAdminToken('');
}
