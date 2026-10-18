/**
 * The admin token, as held by this browser.
 *
 * Deliberately **not** a `VITE_` build variable: anything with that prefix is compiled into the
 * bundle and served to every visitor, which would make the token public. It is typed in once by the
 * operator and kept in localStorage; the API checks it on every mutating request.
 */
const KEY = 'psx:admin-token';

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
