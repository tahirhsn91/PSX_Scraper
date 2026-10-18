import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Authorisation for the endpoints that change data.
 *
 * A single shared token in `ADMIN_TOKEN`, compared in constant time. That is the smallest thing that
 * fits the current Compose topology (one API container behind one port, no user accounts): rate
 * limiting was never authorisation, and until this existed anyone who could reach the API could
 * trigger a full sync, delete a stock or add one.
 *
 * Fails closed: if `ADMIN_TOKEN` is unset the routes answer **503**, not 200. An open admin surface
 * because a variable was forgotten is the failure mode this must not have.
 *
 * The token is never logged — the handler only ever reports `missing` / `invalid`.
 */

const HEADER = 'x-admin-token';

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on length mismatch, and the length is not a secret worth leaking either way.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  const expected = process.env.ADMIN_TOKEN ?? '';
  if (!expected) {
    res.status(503).json({
      error: {
        code: 'ADMIN_DISABLED',
        message: 'Administrative endpoints are not configured on this deployment (ADMIN_TOKEN is unset).',
      },
    });
    return;
  }

  const given = req.header(HEADER) ?? '';
  if (!given) {
    res.status(401).json({
      error: { code: 'ADMIN_TOKEN_REQUIRED', message: `This endpoint requires the ${HEADER} header.` },
    });
    return;
  }
  if (!tokenMatches(given, expected)) {
    res.status(401).json({ error: { code: 'ADMIN_TOKEN_INVALID', message: 'Invalid administrative token.' } });
    return;
  }
  next();
};

export const ADMIN_HEADER = HEADER;
