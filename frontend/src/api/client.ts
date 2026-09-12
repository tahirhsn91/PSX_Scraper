import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:4000/api/v1';

/**
 * Correlation id sent as `x-request-id` (the API echoes it back in its logs).
 *
 * `crypto.randomUUID()` exists only in a **secure context** — https, or http on localhost.
 * This app is also served over plain http on a host IP (e.g. http://169.58.108.61:5173),
 * where `crypto` exists but `crypto.randomUUID` is `undefined`. Calling it inside the
 * request interceptor threw `TypeError: crypto.randomUUID is not a function` before the
 * request ever reached the network, so *every* API call failed and the dashboard showed
 * "Failed to load stocks." — while the identical build worked fine on localhost, because
 * localhost counts as a secure context.
 *
 * The value only has to be unique per request, not unguessable, so fall back to a
 * non-crypto id instead of losing the request.
 */
function newRequestId(): string {
  const cryptoObj: Crypto | undefined = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const api = axios.create({ baseURL, timeout: 20000 });

api.interceptors.request.use((config) => {
  config.headers['x-request-id'] = newRequestId();
  return config;
});

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
