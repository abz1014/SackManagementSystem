/**
 * Admin surface (admin-only): users, station labels (Q11), and versioned rule
 * config (weight basis Q4/Q5, shift mode Q7). Rules are append-only — a change
 * writes a new effective row; changing them is auditable, never destructive.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import argon2 from 'argon2';

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
export async function createUser(pool: ConnectionPool, username: string, password: string, role: string, display: string | null): Promise<void> {
  const hash = await argon2.hash(password);
  await pool.request()
    .input('u', mssql.NVarChar(64), username).input('h', mssql.NVarChar(256), hash)
    .input('d', mssql.NVarChar(128), display ?? username).input('r', mssql.VarChar(20), role)
    .query(`INSERT INTO sms.app_user (username, password_hash, display_name, role_id)
            SELECT @u, @h, @d, role_id FROM sms.role WHERE name=@r`);
}
/** Returns the pre-update active/role so the caller can log a plain-language
 *  "old -> new" — this table has no version history of its own, unlike the
 *  rule tables below, so the audit log is the only place that trail exists. */
export async function updateUser(
  pool: ConnectionPool,
  userId: number,
  active?: boolean,
  role?: string,
): Promise<{ oldActive: boolean | null; oldRole: string | null }> {
  let oldActive: boolean | null = null;
  let oldRole: string | null = null;
  if (active != null) {
    const r = await pool.request().input('id', mssql.Int, userId).input('a', mssql.Bit, active)
      .query<{ old_active: boolean }>(
        `UPDATE sms.app_user SET active=@a OUTPUT deleted.active AS old_active WHERE user_id=@id`,
      );
    oldActive = r.recordset[0]?.old_active ?? null;
  }
  if (role) {
    const r = await pool.request().input('id', mssql.Int, userId).input('r', mssql.VarChar(20), role)
      .query<{ old_role: number }>(
        `UPDATE sms.app_user SET role_id=(SELECT role_id FROM sms.role WHERE name=@r)
         OUTPUT deleted.role_id AS old_role WHERE user_id=@id`,
      );
    const oldRoleId = r.recordset[0]?.old_role;
    if (oldRoleId != null) {
      const rr = await pool.request().input('id', mssql.Int, oldRoleId).query<{ name: string }>(
        `SELECT name FROM sms.role WHERE role_id=@id`,
      );
      oldRole = rr.recordset[0]?.name ?? null;
    }
  }
  return { oldActive, oldRole };
}

// ---- stations (Q11) ----
export interface StationRow { stationId: number; name: string | null; machine: string | null; description: string | null; }
export async function listStations(pool: ConnectionPool, lineId: number): Promise<StationRow[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{ station_id: number; name: string | null; machine: string | null; description: string | null }>(
    `SELECT station_id, name, machine, description FROM sms.station WHERE line_id=@line ORDER BY station_id`,
  );
  return r.recordset.map((x) => ({ stationId: x.station_id, name: x.name, machine: x.machine, description: x.description }));
}
export async function setStation(
  pool: ConnectionPool, lineId: number, stationId: number,
  name: string | null, machine: string | null, description: string | null,
): Promise<{ oldName: string | null }> {
  const r = await pool.request().input('line', mssql.Int, lineId).input('id', mssql.Int, stationId)
    .input('n', mssql.NVarChar(64), name).input('m', mssql.NVarChar(64), machine).input('d', mssql.NVarChar(255), description)
    .query<{ old_name: string | null }>(
      `UPDATE sms.station SET name=@n, machine=@m, description=@d
       OUTPUT deleted.name AS old_name
       WHERE line_id=@line AND station_id=@id`,
    );
  return { oldName: r.recordset[0]?.old_name ?? null };
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
  pool: ConnectionPool,
  lineId: number,
  coneLoG: number,
  coneHiG: number,
  sackLoKg: number,
  sackHiKg: number,
  by: number,
  reason: string | null,
): Promise<void> {
  await pool.request().input('line', mssql.Int, lineId)
    .input('cl', mssql.Decimal(10, 2), coneLoG).input('ch', mssql.Decimal(10, 2), coneHiG)
    .input('sl', mssql.Decimal(10, 3), sackLoKg).input('sh', mssql.Decimal(10, 3), sackHiKg)
    .input('by', mssql.Int, by).input('reason', mssql.NVarChar(255), reason)
    .query(`INSERT INTO sms.plausibility_rule (line_id, cone_lo_g, cone_hi_g, sack_lo_kg, sack_hi_kg, effective_from, changed_by, reason)
            VALUES (@line, @cl, @ch, @sl, @sh, SYSUTCDATETIME(), @by, @reason)`);
}
export async function setWeightRule(pool: ConnectionPool, lineId: number, basis: string, tube: number, tare: number, by: number, reason: string | null): Promise<void> {
  await pool.request().input('line', mssql.Int, lineId).input('b', mssql.VarChar(12), basis)
    .input('tube', mssql.Decimal(10, 2), tube).input('tare', mssql.Decimal(10, 3), tare)
    .input('by', mssql.Int, by).input('reason', mssql.NVarChar(255), reason)
    .query(`INSERT INTO sms.weight_rule (line_id, basis, cone_tube_weight_g, sack_tare_kg, effective_from, changed_by, reason)
            VALUES (@line, @b, @tube, @tare, SYSUTCDATETIME(), @by, @reason)`);
}
export async function setShiftRule(pool: ConnectionPool, lineId: number, mode: string, nightBelongsTo: string, by: number, reason: string | null): Promise<void> {
  await pool.request().input('line', mssql.Int, lineId).input('mode', mssql.VarChar(10), mode)
    .input('nb', mssql.VarChar(15), nightBelongsTo).input('by', mssql.Int, by).input('reason', mssql.NVarChar(255), reason)
    .query(`INSERT INTO sms.shift_rule (line_id, morning_start, evening_start, night_start, mode, night_belongs_to, effective_from, changed_by, reason)
            VALUES (@line, '06:00','14:00','22:00', @mode, @nb, SYSUTCDATETIME(), @by, @reason)`);
}
