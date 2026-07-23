/**
 * Seed baseline reference rows so downstream transform has rules to read.
 * Idempotent. Uses confirmed values (Q8 shift boundaries) and honest defaults
 * (as_recorded weight). Rule rows are versioned; this is v1, effective from epoch.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { SyncConfig } from '../config.js';

export async function seedReference(
  pool: ConnectionPool,
  cfg: SyncConfig,
): Promise<void> {
  const line = cfg.lineId;

  // shift_rule (Q8 boundaries confirmed; mode/night from config, still open Q7)
  await pool
    .request()
    .input('line', mssql.Int, line)
    .input('mode', mssql.VarChar(10), cfg.appConfig.shift.mode)
    .input('night', mssql.VarChar(15), cfg.appConfig.shift.nightBelongsTo)
    .query(
      `IF NOT EXISTS (SELECT 1 FROM sms.shift_rule WHERE line_id = @line)
       INSERT INTO sms.shift_rule
         (line_id, morning_start, evening_start, night_start, mode, night_belongs_to, effective_from, reason)
       VALUES (@line, '06:00', '14:00', '22:00', @mode, @night, '2000-01-01', 'baseline seed (Q8 confirmed)');`,
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

  // stations 1..14 (labels pending Q11)
  await pool
    .request()
    .input('line', mssql.Int, line)
    .query(
      `WITH n AS (
         SELECT TOP (14) ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS id
         FROM sys.all_objects
       )
       INSERT INTO sms.station (station_id, line_id)
       SELECT n.id, @line FROM n
       WHERE NOT EXISTS (
         SELECT 1 FROM sms.station s WHERE s.line_id = @line AND s.station_id = n.id
       );`,
    );
}
