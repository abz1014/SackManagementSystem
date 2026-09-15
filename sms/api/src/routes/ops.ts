/**
 * Routes added by roadmap Phase 11 (security, reliability and operations,
 * 14 Sep 2026) — mounted from createApp after the shared auth gate, so every
 * route here already requires a signed-in user; the admin reset adds its own
 * requireRole(4).
 *
 * Two password paths, deliberately different:
 *
 *   POST /api/auth/password            the caller's own. Verifies the current
 *                                      password first (a stolen session must
 *                                      not be enough to lock the owner out),
 *                                      refuses to reuse it, applies the length
 *                                      policy, and revokes every OTHER session
 *                                      of the account in the same transaction
 *                                      as the hash — the caller keeps theirs.
 *   POST /api/admin/users/:id/password an administrator's reset of someone
 *                                      else's. No current password (it is
 *                                      lost — that is why they are here), and
 *                                      EVERY session of the target is revoked.
 *                                      Refuses the actor's own id: an admin
 *                                      changing their own password must prove
 *                                      the current one like anyone else.
 *
 * Both go through auditedWrite (services/audit.ts): the hash, the session
 * revocation and the audit row commit together or not at all.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { requireRole, revokeSessions, sessionIdOf, type AuthedRequest } from '../auth.js';
import { auditedWrite } from '../services/audit.js';
import {
  hashPassword,
  passwordHashOf,
  passwordPolicyProblem,
  setPasswordHash,
  usernameOf,
  verifyPassword,
} from '../services/admin.js';

/** The default when the config was built without the key (hand-built test fixtures). */
export const DEFAULT_PASSWORD_MIN_LENGTH = 10;

export function mountOpsRoutes({ app, pool, cfg }: RouteContext): void {
  const minLength = cfg.passwordMinLength ?? DEFAULT_PASSWORD_MIN_LENGTH;
  const actor = (req: Request) => (req as AuthedRequest).user!;

  // ---- self-service password change (any signed-in account) ----------------
  app.post('/api/auth/password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'currentPassword and newPassword required' });
        return;
      }
      const problem = passwordPolicyProblem(body.data.newPassword, minLength);
      if (problem) {
        res.status(400).json({ error: 'password policy', detail: problem });
        return;
      }
      if (body.data.newPassword === body.data.currentPassword) {
        res.status(400).json({ error: 'password policy', detail: 'The new password must differ from the current one.' });
        return;
      }
      const me = actor(req);
      const hash = await passwordHashOf(pool, me.userId);
      // Verified BEFORE the transaction opens, on the pool, so a wrong current
      // password costs one argon2 verify and no write.
      if (!hash || !(await verifyPassword(hash, body.data.currentPassword))) {
        res.status(403).json({ error: 'current password is incorrect' });
        return;
      }
      const newHash = await hashPassword(body.data.newPassword);
      const keep = sessionIdOf(req);
      const revoked = await auditedWrite(
        pool,
        me.userId,
        { action: 'auth.password_change', targetType: 'user', targetId: me.userId, detail: null },
        async (tx) => {
          await setPasswordHash(tx, me.userId, newHash);
          const n = await revokeSessions(tx, me.userId, keep);
          return { result: n, detail: `other sessions revoked: ${n}` };
        },
      );
      res.json({ ok: true, otherSessionsRevoked: revoked });
    } catch (err) {
      next(err);
    }
  });

  // ---- admin reset of another account's password ---------------------------
  app.post('/api/admin/users/:id/password', requireRole(4), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const body = z.object({ newPassword: z.string().min(1) }).safeParse(req.body);
      if (!Number.isInteger(id) || id <= 0 || !body.success) {
        res.status(400).json({ error: 'invalid' });
        return;
      }
      const me = actor(req);
      if (id === me.userId) {
        res.status(400).json({
          error: 'use the self-service route',
          detail: 'Change your own password from the account menu, which asks for the current one.',
        });
        return;
      }
      const problem = passwordPolicyProblem(body.data.newPassword, minLength);
      if (problem) {
        res.status(400).json({ error: 'password policy', detail: problem });
        return;
      }
      const target = await usernameOf(pool, id);
      if (target == null) {
        res.status(404).json({ error: 'no such user' });
        return;
      }
      const newHash = await hashPassword(body.data.newPassword);
      const revoked = await auditedWrite(
        pool,
        me.userId,
        { action: 'user.password_reset', targetType: 'user', targetId: id, detail: `username ${target}` },
        async (tx) => {
          const updated = await setPasswordHash(tx, id, newHash);
          if (!updated) return { result: 0, noop: true };
          const n = await revokeSessions(tx, id, null);
          return { result: n, detail: `username ${target}; sessions revoked: ${n}` };
        },
      );
      res.json({ ok: true, sessionsRevoked: revoked });
    } catch (err) {
      next(err);
    }
  });
}
