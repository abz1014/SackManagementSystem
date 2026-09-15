/**
 * Session cookie flags — DEPLOY.md:42 calls one of these "the one setting
 * that fails silently", and nothing exercised setSessionCookie /
 * clearSessionCookie / the drop-warning before this file (roadmap task T5).
 *
 * Hand-rolled res/req only — no supertest, no new dependency. `cookieSecure()`
 * reads `process.env.COOKIE_SECURE` at call time (see the comment on it in
 * auth.ts), so `vi.stubEnv` + `afterEach(vi.unstubAllEnvs)` is enough; no
 * module reset is needed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, CookieOptions } from 'express';
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie } from './auth.js';
import { log } from './log.js';

/**
 * Minimal res mock: .cookie(name, value, options) and .clearCookie(name, options),
 * both spies. Response.cookie has three overloads (the 2-arg one has no
 * `options`), and `Parameters<Response['cookie']>` resolves to that narrowest
 * one — so the spies are typed explicitly to the 3-arg / 2-arg shapes actually
 * used here, and returned alongside `res` for assertions instead of reading
 * back through `res.cookie`.
 */
function fakeRes() {
  const cookie = vi.fn<(name: string, val: string, options: CookieOptions) => Response>();
  const clearCookie = vi.fn<(name: string, options: CookieOptions) => Response>();
  const res = {} as Response;
  cookie.mockReturnValue(res);
  clearCookie.mockReturnValue(res);
  res.cookie = cookie as unknown as Response['cookie'];
  res.clearCookie = clearCookie as unknown as Response['clearCookie'];
  return { res, cookie, clearCookie };
}

function fakeReq(opts: { secure?: boolean; hostname?: string } = {}): Request {
  // No `.res` on this req, so auth.ts's requestLog(req) -> requestIdOf(req)
  // reads req.res?.locals?.requestId as undefined and falls back to the
  // module-level `log` singleton — the same object this file spies on.
  return {
    secure: opts.secure ?? false,
    hostname: opts.hostname ?? 'sms-host',
  } as unknown as Request;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('setSessionCookie — cookie options', () => {
  it('case 1: default (no COOKIE_SECURE in env) -> httpOnly/sameSite=strict/secure=true/path=/, expires passed through unchanged', () => {
    vi.stubEnv('COOKIE_SECURE', undefined);
    const { res, cookie } = fakeRes();
    const expires = new Date('2026-09-22T00:00:00.000Z');

    setSessionCookie(res, 'session-1', expires);

    expect(cookie.mock.calls).toHaveLength(1);
    const [name, value, options] = cookie.mock.calls[0]!;
    expect(name).toBe(SESSION_COOKIE);
    expect(value).toBe('session-1');
    expect(options).toEqual({ httpOnly: true, sameSite: 'strict', secure: true, expires, path: '/' });
    // Same Date instance, not a copy or reformat.
    expect(options.expires).toBe(expires);
  });

  it('case 2: COOKIE_SECURE=false -> secure:false, httpOnly/sameSite UNCHANGED (the escape hatch cannot widen the other two)', () => {
    vi.stubEnv('COOKIE_SECURE', 'false');
    const { res, cookie } = fakeRes();
    const expires = new Date('2026-09-22T00:00:00.000Z');

    setSessionCookie(res, 'session-2', expires);

    const [name, , options] = cookie.mock.calls[0]!;
    expect(name).toBe(SESSION_COOKIE);
    expect(options).toEqual({ httpOnly: true, sameSite: 'strict', secure: false, expires, path: '/' });
  });

  it('case 3: clearSessionCookie -> path:/, and clears the same cookie name setSessionCookie sets', () => {
    vi.stubEnv('COOKIE_SECURE', undefined);
    const { res, cookie, clearCookie } = fakeRes();

    setSessionCookie(res, 'session-3', new Date());
    clearSessionCookie(res);

    const setName = cookie.mock.calls[0]![0];
    const [clearName, clearOptions] = clearCookie.mock.calls[0]!;
    expect(clearName).toBe(SESSION_COOKIE);
    expect(clearName).toBe(setName);
    expect(clearOptions).toEqual({ path: '/' });
  });
});

describe('setSessionCookie — warnIfCookieWillBeDropped (reached only via the optional req param)', () => {
  it('case 4: COOKIE_SECURE=true + plain-HTTP request for host "sms-host" -> exactly one warn with {host, cookieSecure:true, secure:false}', () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const { res } = fakeRes();
    const req = fakeReq({ secure: false, hostname: 'sms-host' });

    setSessionCookie(res, 'session-4', new Date(), req);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, extra] = warnSpy.mock.calls[0]!;
    expect(extra).toEqual({ host: 'sms-host', cookieSecure: true, secure: false });
  });

  it.each(['localhost', '127.0.0.1', '::1'])(
    'case 5: same setup but host "%s" -> NO warn',
    (hostname) => {
      vi.stubEnv('COOKIE_SECURE', 'true');
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const { res } = fakeRes();
      const req = fakeReq({ secure: false, hostname });

      setSessionCookie(res, 'session-5', new Date(), req);

      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it('case 6: req.secure === true -> NO warn, even for a non-local host', () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const { res } = fakeRes();
    const req = fakeReq({ secure: true, hostname: 'sms-host' });

    setSessionCookie(res, 'session-6', new Date(), req);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
