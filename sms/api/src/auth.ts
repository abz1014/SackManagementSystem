/**
 * Auth (ARCHITECTURE §11): argon2 password verify, server-side sessions,
 * httpOnly session cookie, RBAC middleware. Never touches IFL's Users table.
 */
import type { Request, Response, NextFunction } from 'express';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

export const SESSION_COOKIE = 'sms_session';
const SESSION_DAYS = 7;

/** Cookie must be Secure behind TLS in production. Read at call time (NOT module
 *  load) so it reflects .env loaded during startup. COOKIE_SECURE=false only for
 *  local HTTP dev; default true. */
const cookieSecure = (): boolean => (process.env.COOKIE_SECURE ?? 'true') !== 'false';

export interface AuthUser {
  userId: number;
  username: string;
  displayName: string | null;
  role: string;
  rank: number;
}

/**
 * Login rate limiter (in-memory; single-server intranet). After MAX_FAILS failed
 * attempts from one client within WINDOW, further attempts are locked out for
 * LOCKOUT. A successful login clears the counter. No dependency; bounded map.
 */
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

interface Attempt { fails: number; first: number; lockedUntil: number; }

export class LoginRateLimiter {
  private readonly map = new Map<string, Attempt>();

  /** Returns seconds to wait if locked out, else 0. */
  retryAfter(key: string, now: number): number {
    const a = this.map.get(key);
    if (a && a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000);
    return 0;
  }

  recordFailure(key: string, now: number): void {
    const a = this.map.get(key);
    if (!a || now - a.first > WINDOW_MS) {
      this.map.set(key, { fails: 1, first: now, lockedUntil: 0 });
      return;
    }
    a.fails += 1;
    if (a.fails >= MAX_FAILS) a.lockedUntil = now + LOCKOUT_MS;
  }

  clear(key: string): void {
    this.map.delete(key);
  }
}

/** A valid argon2 hash of a throwaway value, computed once. Used to spend the
 *  same verify time on unknown/inactive users so login timing can't enumerate
 *  valid usernames. */
let dummyHashPromise: Promise<string> | null = null;
const getDummyHash = (): Promise<string> =>
  (dummyHashPromise ??= argon2.hash('sms-timing-equalizer-not-a-real-password'));

/** Verify credentials; returns the user or null. */
export async function authenticate(
  pool: ConnectionPool,
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const r = await pool.request().input('u', mssql.NVarChar(64), username).query<{
    user_id: number;
    password_hash: string;
    display_name: string | null;
    role: string;
    rank: number;
    active: boolean;
  }>(
    `SELECT u.user_id, u.password_hash, u.display_name, r.name AS role, r.rank, u.active
     FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id
     WHERE u.username = @u`,
  );
  const row = r.recordset[0];
  if (!row || !row.active) {
    // spend equivalent verify time, then fail — no username enumeration via timing
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    return null;
  }
  const ok = await argon2.verify(row.password_hash, password).catch(() => false);
  if (!ok) return null;
  return {
    userId: row.user_id,
    username,
    displayName: row.display_name,
    role: row.role,
    rank: row.rank,
  };
}

export async function createSession(pool: ConnectionPool, userId: number): Promise<{ id: string; expires: Date }> {
  const id = randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await pool
    .request()
    .input('id', mssql.UniqueIdentifier, id)
    .input('u', mssql.Int, userId)
    .input('exp', mssql.DateTime2, expires)
    .query(`INSERT INTO sms.session (session_id, user_id, expires_at_utc) VALUES (@id, @u, @exp)`);
  return { id, expires };
}

/** Prune expired session rows so the table doesn't grow unbounded. Cheap;
 *  called opportunistically on login. Expiry is also enforced on read, so this
 *  is housekeeping, not a security control. */
export async function pruneExpiredSessions(pool: ConnectionPool): Promise<void> {
  await pool.request().query(`DELETE FROM sms.session WHERE expires_at_utc <= SYSUTCDATETIME()`);
}

export async function destroySession(pool: ConnectionPool, id: string): Promise<void> {
  await pool.request().input('id', mssql.UniqueIdentifier, id).query(`DELETE FROM sms.session WHERE session_id=@id`);
}

async function userFromSession(pool: ConnectionPool, id: string): Promise<AuthUser | null> {
  const r = await pool.request().input('id', mssql.UniqueIdentifier, id).query<{
    user_id: number; username: string; display_name: string | null; role: string; rank: number;
  }>(
    `SELECT u.user_id, u.username, u.display_name, r.name AS role, r.rank
     FROM sms.session s
     JOIN sms.app_user u ON u.user_id = s.user_id AND u.active = 1
     JOIN sms.role r ON r.role_id = u.role_id
     WHERE s.session_id = @id AND s.expires_at_utc > SYSUTCDATETIME()`,
  );
  const row = r.recordset[0];
  return row
    ? { userId: row.user_id, username: row.username, displayName: row.display_name, role: row.role, rank: row.rank }
    : null;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Warn when a Secure cookie is about to be issued over a plain-HTTP request
 * from somewhere other than localhost.
 *
 * Browsers treat http://localhost as a trustworthy origin and keep Secure
 * cookies there, but drop them for http://<lan-ip>. On a plain-HTTP intranet
 * deployment that makes login fail in the least debuggable way possible: the
 * POST returns 200 with the user, the browser silently discards the cookie,
 * and the very next request is anonymous — so the UI just bounces back to the
 * login screen with no error anywhere. Say so in the log instead.
 */
function warnIfCookieWillBeDropped(req: Request): void {
  if (!cookieSecure()) return;
  if (req.secure) return; // real TLS (or a trusted proxy reported https)
  const host = (req.hostname ?? '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return;
  console.warn(
    `[auth] COOKIE_SECURE=true but this login arrived over plain HTTP for host "${host}". ` +
      `The browser will DISCARD the session cookie and the user will appear unable to log in. ` +
      `For a plain-HTTP intranet set COOKIE_SECURE=false; keep it true only behind TLS.`,
  );
}

export function setSessionCookie(res: Response, id: string, expires: Date, req?: Request): void {
  if (req) warnIfCookieWillBeDropped(req);
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure(), // true by default; COOKIE_SECURE=false for local HTTP dev
    expires,
    path: '/',
  });
}
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Attach req.user from the session cookie (or null). */
export function authMiddleware(pool: ConnectionPool) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const id = readCookie(req, SESSION_COOKIE);
    (req as AuthedRequest).user = id ? await userFromSession(pool, id) : null;
    next();
  };
}

export interface AuthedRequest extends Request {
  user?: AuthUser | null;
}

export interface RoleGate {
  (req: Request, res: Response, next: NextFunction): void;
  /** The rank this gate enforces — tagged on the closure so a test can walk
   *  app._router.stack and discover every route's real minRank without
   *  hand-maintaining a second copy of the list (auth.test.ts does this). */
  minRank: number;
}

/** Gate: require an authenticated user with at least `minRank`. */
export function requireRole(minRank: number): RoleGate {
  const gate = ((req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (user.rank < minRank) {
      res.status(403).json({ error: 'insufficient role' });
      return;
    }
    next();
  }) as RoleGate;
  gate.minRank = minRank;
  return gate;
}
