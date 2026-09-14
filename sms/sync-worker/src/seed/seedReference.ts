/**
 * Seed baseline reference rows so downstream transform has rules to read.
 * Idempotent. Uses confirmed values (Q8 shift boundaries) and honest defaults
 * (as_recorded weight). Rule rows are versioned; this is v1, effective from epoch.
 *
 * Roadmap Phase 1 (14 Sep 2026): stations are no longer seeded as `TOP (14)`.
 * That number was a fact about IFL's line drawing written into the worker, and
 * a fifteenth winder added in Setup would never have got a station row without
 * a code change. Stations are now RECONCILED from sms.machine (migration 028):
 * every active, numbered winder on the line gets a station of the same number
 * if it has none. A line with no machines seeds no stations — the runbook
 * (DEPLOY.md, "Adding a machine") says to add machines first.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { DEFAULT_SHIFT_BOUNDARIES, formatShiftTime } from '@sms/shared';
import type { SyncConfig } from '../config.js';

export async function seedReference(
  pool: ConnectionPool,
  cfg: SyncConfig,
): Promise<void> {
  const line = cfg.lineId;

  // shift_rule — the FIRST row only; the newest row is the rule, and Setup ›
  // Rules appends. Boundaries are the shared seed (Q8, IFL confirmed
  // 06/14/22); `mode` (fix-vs-reproduce, Q7) and the night rule are the env
  // defaults and still open with IFL — an answer changes the row, not this
  // code. Written as parameters so the seed and the shared default cannot
  // drift apart.
  await pool
    .request()
    .input('line', mssql.Int, line)
    .input('ms', mssql.VarChar(5), formatShiftTime(DEFAULT_SHIFT_BOUNDARIES.morningStart))
    .input('es', mssql.VarChar(5), formatShiftTime(DEFAULT_SHIFT_BOUNDARIES.eveningStart))
    .input('ns', mssql.VarChar(5), formatShiftTime(DEFAULT_SHIFT_BOUNDARIES.nightStart))
    .input('mode', mssql.VarChar(10), cfg.appConfig.shift.mode)
    .input('night', mssql.VarChar(15), cfg.appConfig.shift.nightBelongsTo)
    .query(
      `IF NOT EXISTS (SELECT 1 FROM sms.shift_rule WHERE line_id = @line)
       INSERT INTO sms.shift_rule
         (line_id, morning_start, evening_start, night_start, mode, night_belongs_to, effective_from, reason)
       VALUES (@line, @ms, @es, @ns, @mode, @night, '2000-01-01', 'baseline seed (Q8 confirmed)');`,
    );

  // weight_rule (basis from config; honest default as_recorded pending Q4/Q5)
  await pool
    .request()
    .input('line', mssql.Int, line)
    .input('basis', mssql.VarChar(12), cfg.appConfig.weight.basis)
    .input('tube', mssql.Decimal(10, 2), cfg.appConfig.weight.coneTubeWeightG)
    .input('tare', mssql.Decimal(10, 3), cfg.appConfig.weight.sackTareKg)
    .query(
      `IF NOT EXISTS (SELECT 1 FROM sms.weight_rule WHERE line_id = @line)
       INSERT INTO sms.weight_rule
         (line_id, basis, cone_tube_weight_g, sack_tare_kg, effective_from, reason)
       VALUES (@line, @basis, @tube, @tare, '2000-01-01', 'baseline seed (pending Q4/Q5)');`,
    );

  // plausibility_rule — the scale-fault window, was hardcoded in spc.ts/weights.ts
  // as {cone: 1500-2100g, sack: 40-60kg}. Seeded at those exact values so this
  // table starting to exist changes nothing until an admin edits it.
  await pool
    .request()
    .input('line', mssql.Int, line)
    .query(
      `IF NOT EXISTS (SELECT 1 FROM sms.plausibility_rule WHERE line_id = @line)
       INSERT INTO sms.plausibility_rule
         (line_id, cone_lo_g, cone_hi_g, sack_lo_kg, sack_hi_kg, effective_from, reason)
       VALUES (@line, 1500, 2100, 40, 60, '2000-01-01', 'baseline seed (was a code constant)');`,
    );

  // stations, reconciled from machines (labels pending Q11). One station per
  // active winder (or 'other') that the acquisition layer numbers — the packer
  // has no machine_no and links to no station, since no sack row carries one.
  // The station takes the machine's NUMBER as its id and is linked to it with
  // link_source = 'default_by_number': the data has ONE column (MachineNo)
  // that this project has called "station" since Phase 1 and IFL's drawing
  // calls a machine. Whether they are the same thing is clarification Q3 —
  // if IFL says they differ, the link is edited in Setup › Stations, not here.
  await pool
    .request()
    .input('line', mssql.Int, line)
    .query(
      `INSERT INTO sms.station (station_id, line_id, machine_id, link_source)
       SELECT m.machine_no, @line, m.machine_id, 'default_by_number'
         FROM sms.machine m
        WHERE m.line_id = @line
          AND m.is_active = 1
          AND m.kind IN ('winder', 'other')
          AND m.machine_no IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sms.station s WHERE s.line_id = @line AND s.station_id = m.machine_no
          );`,
    );
}
