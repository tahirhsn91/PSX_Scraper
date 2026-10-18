import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { requireAdmin } from '../src/middleware/requireAdmin';

/**
 * Admin authorisation.
 *
 * Two kinds of test here, because they catch different mistakes:
 *  1. the middleware's own contract (401 without a token, 401 with a wrong one, next() with the
 *     right one, 503 when the deployment has no token configured);
 *  2. a scan of every route file asserting that **every** mutating route carries `requireAdmin`
 *     — the way this breaks is not a bad comparison, it is a new POST added without the guard.
 */

const TOKEN = 'test-admin-token-0123456789';

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = (header?: string) =>
  ({ header: (name: string) => (name.toLowerCase() === 'x-admin-token' ? header : undefined) }) as unknown as Request;

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('requireAdmin', () => {
  it('rejects a request with no token as 401', () => {
    process.env.ADMIN_TOKEN = TOKEN;
    const res = fakeRes();
    const next = jest.fn() as NextFunction;
    requireAdmin(req(), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wrong token as 401', () => {
    process.env.ADMIN_TOKEN = TOKEN;
    const res = fakeRes();
    const next = jest.fn() as NextFunction;
    requireAdmin(req('not-the-token'), res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts the configured token', () => {
    process.env.ADMIN_TOKEN = TOKEN;
    const res = fakeRes();
    const next = jest.fn() as NextFunction;
    requireAdmin(req(TOKEN), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(0);
  });

  it('fails closed when the deployment has no token configured', () => {
    delete process.env.ADMIN_TOKEN;
    const res = fakeRes();
    const next = jest.fn() as NextFunction;
    requireAdmin(req('anything'), res, next);
    // 503, not 200: a forgotten variable must not open the controls.
    expect((res as unknown as { statusCode: number }).statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not leak which part of the token was wrong', () => {
    process.env.ADMIN_TOKEN = TOKEN;
    const short = fakeRes();
    requireAdmin(req('test'), short, jest.fn() as NextFunction);
    const long = fakeRes();
    requireAdmin(req('x'.repeat(TOKEN.length)), long, jest.fn() as NextFunction);
    expect((short as unknown as { body: { error: { code: string } } }).body.error.code).toBe('ADMIN_TOKEN_INVALID');
    expect((long as unknown as { body: { error: { code: string } } }).body.error.code).toBe('ADMIN_TOKEN_INVALID');
  });
});

describe('route wiring', () => {
  const routesDir = join(__dirname, '..', 'src', 'routes');
  const files = readdirSync(routesDir).filter((f) => f.endsWith('.ts'));

  /** A route definition is mutating when it uses post/patch/put/delete. */
  const MUTATING = /\brouter\.(post|patch|put|delete)\(/;

  it('guards every mutating route with requireAdmin', () => {
    const unguarded: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(routesDir, file), 'utf8');
      // Route definitions can span lines; take each router.<verb> call up to the closing `);`.
      const calls = source.split(/\n(?=\s*router\.)/);
      for (const call of calls) {
        if (!MUTATING.test(call)) continue;
        if (call.includes('requireAdmin')) continue;
        // The alerts router authenticates with a device token instead — that is its authorisation.
        if (file === 'alerts.routes.ts') continue;
        unguarded.push(`${file}: ${(call.split('\n')[0] ?? '').trim()}`);
      }
    }
    expect(unguarded).toEqual([]);
  });
});
