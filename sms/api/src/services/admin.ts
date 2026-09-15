/**
 * Admin surface (admin-only): users, station labels (Q11), and versioned rule
 * config (weight basis Q4/Q5, shift mode Q7). Rules are append-only — a change
 * writes a new effective row; changing them is auditable, never destructive.
 *
 * Every write here takes a `Db` (a pool OR a transaction) rather than a pool:
 * since 14 Sep 2026 (roadmap Phase 1) the routes run them inside
 * auditedWrite(), so the change and its audit row commit together. Reads take
 * the pool.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import argon2 from 'argon2';
import { formatShiftTime, type ShiftBoundaries } from '@sms/shared';
import type { Db } from './audit.js';

// ---- users ----
export interface UserRow {
  userId: number; username: string; displayName: string | null; role: string; active: boolean; createdAtUtc: string;
}
export async function listUsers(pool: ConnectionPool): Promise<UserRow[]> {
  const r = await pool.request().query<{ user_id: number; username: string; display_name: string | null; role: string; active: boolean; created: Date }>(
    `SELECT u.user_id, u.username, u.display_name, r.name AS role, u.active, u.created_at_utc AS created
     FROM sms.app_user u JOIN sms.role r ON r.role_id=u.role_id ORDER BY u.user_id`,
  );
  return r.recordset.map((x) => ({
    userId: x.user_id, username: x.username, displayName: x.display_name, role: x.role,
    active: Boolean(x.active), createdAtUtc: new Date(x.created).toISOString(),
  }));
}
export async function createUser(db: Db, username: string, password: string, role: string, display: string | null): Promise<void> {
  const hash = await argon2.hash(password);
  await db.request()
    .input('u', mssql.NVarChar(64), username).input('h', mssql.NVarChar(256), hash)
    .input('d', mssql.NVarChar(128), display ?? username).input('r', mssql.VarChar(20), role)
    .query(`INSERT INTO sms.app_user (username, password_hash, display_name, role_id)
            SELECT @u, @h, @d, role_id FROM sms.role WHERE name=@r`);
}
/**
 * Thrown by updateUser when the change would leave the installation with no
 * active administrator (roadmap Phase 11 item 1, 14 Sep 2026). The route
 * answers 409. Before this the guard existed only in the Setup screen, which
 * disabled the toggle on the caller's own row — so a second admin could
 * still deactivate the first, and then themself, leaving Setup unreachable
 * to everyone and the only way back a hand-written UPDATE in SSMS.
 */
export class LastAdminError extends Error {
  constructor() {
    super('This is the last active administrator. Make another account an administrator first.');
    this.name = 'LastAdminError';
  }
}

/** How many active accounts hold the admin role. */
export async function countActiveAdmins(db: Db): Promise<number> {
  const r = await db.request().query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id
      WHERE u.active = 1 AND r.name = 'admin'`,
  );
  return Number(r.recordset[0]?.n ?? 0);
}

/** Is this account an ACTIVE admin right now? Used by the last-admin guard. */
async function isActiveAdmin(db: Db, userId: number): Promise<boolean> {
  const r = await db.request().input('id', mssql.Int, userId).query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sms.app_user u JOIN sms.role r ON r.role_id = u.role_id
      WHERE u.user_id = @id AND u.active = 1 AND r.name = 'admin'`,
  );
  return Number(r.recordset[0]?.n ?? 0) > 0;
}

/** Returns the pre-update active/role so the caller can log a plain-language
 *  "old -> new" — this table has no version history of its own, unlike the
 *  rule tables below, so the audit log is the only place that trail exists.
 *
 *  Refuses (LastAdminError) to deactivate or demote the last active admin.
 *  The check runs inside the caller's transaction, on the same connection as
 *  the UPDATE, so two admins racing to demote each other cannot both pass. */
export async function updateUser(
  db: Db,
  userId: number,
  active?: boolean,
  role?: string,
): Promise<{ oldActive: boolean | null; oldRole: string | null }> {
  const removesAdmin = active === false || (role != null && role !== 'admin');
  if (removesAdmin && (await isActiveAdmin(db, userId)) && (await countActiveAdmins(db)) <= 1) {
    throw new LastAdminError();
  }
  let oldActive: boolean | null = null;
  let oldRole: string | null = null;
  if (active != null) {
    const r = await db.request().input('id', mssql.Int, userId).input('a', mssql.Bit, active)
      .query<{ old_active: boolean }>(
        `UPDATE sms.app_user SET active=@a OUTPUT deleted.active AS old_active WHERE user_id=@id`,
      );
    oldActive = r.recordset[0]?.old_active ?? null;
  }
  if (role) {
    const r = await db.request().input('id', mssql.Int, userId).input('r', mssql.VarChar(20), role)
      .query<{ old_role: number }>(
        `UPDATE sms.app_user SET role_id=(SELECT role_id FROM sms.role WHERE name=@r)
         OUTPUT deleted.role_id AS old_role WHERE user_id=@id`,
      );
    const oldRoleId = r.recordset[0]?.old_role;
    if (oldRoleId != null) {
      const rr = await db.request().input('id', mssql.Int, oldRoleId).query<{ name: string }>(
        `SELECT name FROM sms.role WHERE role_id=@id`,
      );
      oldRole = rr.recordset[0]?.name ?? null;
    }
  }
  return { oldActive, oldRole };
}

// ---- passwords (roadmap Phase 11 item 1, 14 Sep 2026) ----
/**
 * Until this wave there was no way to change a password in the UI, the API
 * or the CLI: a forgotten password was an UPDATE in SSMS with a hash minted
 * by hand. Two paths now, both through these helpers: the self-service
 * change (verifies the current password first) and the admin reset (does
 * not — the point of a reset is that the current one is lost). Both write
 * the hash inside auditedWrite's transaction and revoke the user's other
 * sessions in the same transaction.
 */

/** The stored hash, or null when the account does not exist or is inactive. */
export async function passwordHashOf(db: Db, userId: number): Promise<string | null> {
  const r = await db.request().input('id', mssql.Int, userId).query<{ h: string }>(
    `SELECT password_hash AS h FROM sms.app_user WHERE user_id = @id AND active = 1`,
  );
  return r.recordset[0]?.h ?? null;
}

/**
 * The policy, in one place: the route, the admin reset, the create route and
 * the CLI all call this so they cannot drift apart. Returns the reason a
 * password is refused, or null when it passes. Length only — IFL has not
 * stated a policy (Phase 11 clarifications), and inventing composition rules
 * they did not ask for would be over-claiming.
 */
export function passwordPolicyProblem(password: string, minLength: number): string | null {
  if (typeof password !== 'string' || password.length < minLength) {
    return `The password must be at least ${minLength} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

/** True when `password` is the one behind `hash`. Never throws: a malformed hash is a wrong password. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}

/** Write a new hash. Returns false when the user row did not exist. */
export async function setPasswordHash(db: Db, userId: number, hash: string): Promise<boolean> {
  const r = await db
    .request()
    .input('id', mssql.Int, userId)
    .input('h', mssql.NVarChar(256), hash)
    .query(`UPDATE sms.app_user SET password_hash = @h WHERE user_id = @id`);
  return (r.rowsAffected[0] ?? 0) > 0;
}

/** The username behind an id, for the audit row of a reset; null when absent. */
export async function usernameOf(db: Db, userId: number): Promise<string | null> {
  const r = await db.request().input('id', mssql.Int, userId).query<{ u: string }>(
    `SELECT username AS u FROM sms.app_user WHERE user_id = @id`,
  );
  return r.recordset[0]?.u ?? null;
}

// ---- stations (Q11) ----
/**
 * `machine` is the free-text column Phase 1 gave the station ("Winder-5",
 * typed by an admin); `machineId`/`machineNo`/`machineName` are the row in
 * sms.machine it is linked to since migration 028. Both are returned: the
 * text is what existing screens print, the link is what Setup edits. Whether
 * a station and a machine are the same thing on this line is clarification
 * Q3 for IFL — the link is a row, so their answer edits data, not code.
 */
export interface StationRow {
  stationId: number;
  name: string | null;
  machine: string | null;
  description: string | null;
  machineId: number | null;
  machineNo: number | null;
  machineName: string | null;
  linkSource: string | null;
  isActive: boolean;
}
export async function listStations(pool: ConnectionPool, lineId: number): Promise<StationRow[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    station_id: number; name: string | null; machine: string | null; description: string | null;
    machine_id: number | null; machine_no: number | null; machine_name: string | null; link_source: string | null; is_active: boolean | null;
  }>(
    `SELECT s.station_id, s.name, s.machine, s.description,
            s.machine_id, m.machine_no, m.name AS machine_name, s.link_source, s.is_active
       FROM sms.station s
       LEFT JOIN sms.machine m ON m.machine_id = s.machine_id
      WHERE s.line_id=@line ORDER BY s.station_id`,
  );
  return r.recordset.map((x) => ({
    stationId: x.station_id, name: x.name, machine: x.machine, description: x.description,
    machineId: x.machine_id == null ? null : Number(x.machine_id),
    machineNo: x.machine_no == null ? null : Number(x.machine_no),
    machineName: x.machine_name,
    linkSource: x.link_source,
    isActive: x.is_active == null ? true : Boolean(x.is_active),
  }));
}
export interface StationPatch {
  name: string | null;
  machine: string | null;
  description: string | null;
  /** undefined = leave the link alone; null = unlink; a number = link (link_source becomes 'admin'). */
  machineId?: number | null;
  /** undefined = leave alone. */
  isActive?: boolean;
}
export async function setStation(
  db: Db, lineId: number, stationId: number, p: StationPatch,
): Promise<{ updated: boolean; oldName: string | null; oldMachineId: number | null; oldIsActive: boolean | null }> {
  const setLink = p.machineId !== undefined;
  const setActive = p.isActive !== undefined;
  const r = await db.request().input('line', mssql.Int, lineId).input('id', mssql.Int, stationId)
    .input('n', mssql.NVarChar(64), p.name).input('m', mssql.NVarChar(64), p.machine).input('d', mssql.NVarChar(255), p.description)
    .input('setLink', mssql.Bit, setLink).input('mid', mssql.Int, p.machineId ?? null)
    .input('setActive', mssql.Bit, setActive).input('active', mssql.Bit, p.isActive ?? null)
    .query<{ old_name: string | null; old_machine_id: number | null; old_is_active: boolean | null }>(
      `UPDATE sms.station
          SET name=@n, machine=@m, description=@d,
              machine_id  = CASE WHEN @setLink = 1 THEN @mid ELSE machine_id END,
              link_source = CASE WHEN @setLink = 1 THEN 'admin' ELSE link_source END,
              is_active   = CASE WHEN @setActive = 1 THEN @active ELSE is_active END
       OUTPUT deleted.name AS old_name, deleted.machine_id AS old_machine_id, deleted.is_active AS old_is_active
       WHERE line_id=@line AND station_id=@id`,
    );
  const row = r.recordset[0];
  return {
    updated: (r.rowsAffected[0] ?? 0) > 0,
    oldName: row?.old_name ?? null,
    oldMachineId: row?.old_machine_id == null ? null : Number(row.old_machine_id),
    oldIsActive: row?.old_is_active == null ? null : Boolean(row.old_is_active),
  };
}

// ---- versioned rules ----
export interface Rules {
  weight: { basis: string; coneTubeWeightG: number; sackTareKg: number } | null;
  shift: { morningStart: string; eveningStart: string; nightStart: string; mode: string; nightBelongsTo: string } | null;
  plausibility: { coneLoG: number; coneHiG: number; sackLoKg: number; sackHiKg: number } | null;
}
export async function getRules(pool: ConnectionPool, lineId: number): Promise<Rules> {
  const w = await pool.request().input('line', mssql.Int, lineId).query<{ basis: string; tube: number; tare: number }>(
    `SELECT TOP 1 basis, cone_tube_weight_g AS tube, sack_tare_kg AS tare FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  const s = await pool.request().input('line', mssql.Int, lineId).query<{ ms: string; es: string; ns: string; mode: string; nb: string }>(
    `SELECT TOP 1 CONVERT(varchar(5),morning_start,108) ms, CONVERT(varchar(5),evening_start,108) es,
            CONVERT(varchar(5),night_start,108) ns, mode, night_belongs_to nb FROM sms.shift_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  const p = await getPlausibilityRule(pool, lineId);
  return {
    weight: w.recordset[0] ? { basis: w.recordset[0].basis, coneTubeWeightG: Number(w.recordset[0].tube), sackTareKg: Number(w.recordset[0].tare) } : null,
    shift: s.recordset[0] ? { morningStart: s.recordset[0].ms, eveningStart: s.recordset[0].es, nightStart: s.recordset[0].ns, mode: s.recordset[0].mode, nightBelongsTo: s.recordset[0].nb } : null,
    plausibility: p ? { coneLoG: p.coneLoG, coneHiG: p.coneHiG, sackLoKg: p.sackLoKg, sackHiKg: p.sackHiKg } : null,
  };
}

/**
 * The scale-fault window — the bounds below (and, for cones, above) which a
 * reading is physically impossible rather than a real measurement. Was
 * hardcoded (spc.ts's PLAUSIBLE object, weights.ts's CONE_OUT/SACK_OUT); now
 * one app-owned versioned rule both services read fresh per request, same as
 * weight_rule and shift_rule. Falls back to the pre-existing hardcoded values
 * only if the table is somehow empty (should not happen post-seed), so a
 * missing row degrades to old behaviour rather than to no filtering at all.
 */
export interface PlausibilityRule { coneLoG: number; coneHiG: number; sackLoKg: number; sackHiKg: number }
const PLAUSIBILITY_FALLBACK: PlausibilityRule = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };
export async function getPlausibilityRule(pool: ConnectionPool, lineId: number): Promise<PlausibilityRule> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{ cl: number; ch: number; sl: number; sh: number }>(
    `SELECT TOP 1 cone_lo_g cl, cone_hi_g ch, sack_lo_kg sl, sack_hi_kg sh
     FROM sms.plausibility_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  const row = r.recordset[0];
  if (!row) return PLAUSIBILITY_FALLBACK;
  return { coneLoG: Number(row.cl), coneHiG: Number(row.ch), sackLoKg: Number(row.sl), sackHiKg: Number(row.sh) };
}
export async function setPlausibilityRule(
  db: Db,
  lineId: number,
  coneLoG: number,
  coneHiG: number,
  sackLoKg: number,
  sackHiKg: number,
  by: number,
  reason: string | null,
): Promise<void> {
  await db.request().input('line', mssql.Int, lineId)
    .input('cl', mssql.Decimal(10, 2), coneLoG).input('ch', mssql.Decimal(10, 2), coneHiG)
    .input('sl', mssql.Decimal(10, 3), sackLoKg).input('sh', mssql.Decimal(10, 3), sackHiKg)
    .input('by', mssql.Int, by).input('reason', mssql.NVarChar(255), reason)
    .query(`INSERT INTO sms.plausibility_rule (line_id, cone_lo_g, cone_hi_g, sack_lo_kg, sack_hi_kg, effective_from, changed_by, reason)
            VALUES (@line, @cl, @ch, @sl, @sh, SYSUTCDATETIME(), @by, @reason)`);
}
export async function setWeightRule(db: Db, lineId: number, basis: string, tube: number, tare: number, by: number, reason: string | null): Promise<void> {
  await db.request().input('line', mssql.Int, lineId).input('b', mssql.VarChar(12), basis)
    .input('tube', mssql.Decimal(10, 2), tube).input('tare', mssql.Decimal(10, 3), tare)
    .input('by', mssql.Int, by).input('reason', mssql.NVarChar(255), reason)
    .query(`INSERT INTO sms.weight_rule (line_id, basis, cone_tube_weight_g, sack_tare_kg, effective_from, changed_by, reason)
            VALUES (@line, @b, @tube, @tare, SYSUTCDATETIME(), @by, @reason)`);
}
/**
 * The three start times are PARAMETERS. Until 14 Sep 2026 this INSERT carried
 * '06:00','14:00','22:00' as literals — the only three values the table could
 * ever hold, which made the shift_rule columns decoration and the boundary a
 * source-code constant (roadmap Phase 1: "avoid hard-coded … shift"). The
 * caller validates order (morning < evening < night) through
 * shiftBoundariesFrom before this runs; the worker and /api/live read the
 * newest row back into the same ShiftBoundaries shape. 06/14/22 remains the
 * DEFAULT (IFL, Q8) for a line with no rule row, not the rule.
 */
export async function setShiftRule(
  db: Db, lineId: number, boundaries: ShiftBoundaries, mode: string, nightBelongsTo: string, by: number, reason: string | null,
): Promise<void> {
  await db.request().input('line', mssql.Int, lineId)
    .input('ms', mssql.VarChar(5), formatShiftTime(boundaries.morningStart))
    .input('es', mssql.VarChar(5), formatShiftTime(boundaries.eveningStart))
    .input('ns', mssql.VarChar(5), formatShiftTime(boundaries.nightStart))
    .input('mode', mssql.VarChar(10), mode)
    .input('nb', mssql.VarChar(15), nightBelongsTo).input('by', mssql.Int, by).input('reason', mssql.NVarChar(255), reason)
    .query(`INSERT INTO sms.shift_rule (line_id, morning_start, evening_start, night_start, mode, night_belongs_to, effective_from, changed_by, reason)
            VALUES (@line, CAST(@ms AS TIME(0)), CAST(@es AS TIME(0)), CAST(@ns AS TIME(0)), @mode, @nb, SYSUTCDATETIME(), @by, @reason)`);
}
