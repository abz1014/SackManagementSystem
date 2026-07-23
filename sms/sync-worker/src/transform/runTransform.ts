/**
 * Transform runner (Step 3): raw → canonical. Reads sms_raw.*, maps via the
 * pure transform, assigns merge keys, runs DQ, persists idempotently.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionPool } from 'mssql';
import type { SyncConfig } from '../config.js';
import {
  mapCone,
  mapSack,
  mapReject,
  assignMergeKeys,
  coneKey,
  sackKey,
  rejectKey,
} from './transform.js';
import {
  persistCanonical,
  CONE_COLS,
  SACK_COLS,
  REJECT_COLS,
} from './persistCanonical.js';
import { computeFindings, persistFindings, type Finding } from './dq.js';
import { seedRejectCodes } from './seedRejectCodes.js';

type Raw = Record<string, unknown>;

async function readRaw(pool: ConnectionPool, table: string): Promise<Raw[]> {
  const r = await pool.request().query(`SELECT * FROM ${table} ORDER BY src_id`);
  return r.recordset as Raw[];
}

export interface TransformOutcome {
  table: string;
  read: number;
  written: number;
  findings: Finding[];
}

export async function runTransform(
  appPool: ConnectionPool,
  cfg: SyncConfig,
): Promise<TransformOutcome[]> {
  const runId = randomUUID();
  const out: TransformOutcome[] = [];

  // cones ---------------------------------------------------------------------
  {
    const raw = await readRaw(appPool, 'sms_raw.cone_raw');
    const rows = assignMergeKeys(
      raw.map((r) => mapCone(r, cfg, runId)),
      coneKey,
    );
    const findings = computeFindings(rows, 'cone', 'cone_event', (r) => r.weight_g);
    const res = await persistCanonical(appPool, 'sms.cone_event', CONE_COLS, rows);
    await persistFindings(appPool, runId, findings);
    out.push({ table: 'cone_event', ...res, findings });
  }

  // sacks ---------------------------------------------------------------------
  {
    const raw = await readRaw(appPool, 'sms_raw.sack_raw');
    const rows = assignMergeKeys(
      raw.map((r) => mapSack(r, cfg, runId)),
      sackKey,
    );
    const findings = computeFindings(rows, 'sack', 'sack_event', (r) => r.weight_kg);
    const res = await persistCanonical(appPool, 'sms.sack_event', SACK_COLS, rows);
    await persistFindings(appPool, runId, findings);
    out.push({ table: 'sack_event', ...res, findings });
  }

  // rejects (two raw sources → one canonical) ---------------------------------
  {
    const qcs = await readRaw(appPool, 'sms_raw.reject_qcs_raw');
    const wt = await readRaw(appPool, 'sms_raw.reject_weight_raw');
    const rows = assignMergeKeys(
      [
        ...qcs.map((r) => mapReject(r, 'quality', cfg, runId)),
        ...wt.map((r) => mapReject(r, 'weight', cfg, runId)),
      ],
      rejectKey,
    );
    // quality and weight rejects share source_row_id spaces → filter per type
    const q = rows.filter((r) => r.reject_type === 'quality');
    const w = rows.filter((r) => r.reject_type === 'weight');
    const rq = await persistCanonical(appPool, 'sms.reject_event', REJECT_COLS, q, {
      extraExistingFilter: "AND reject_type = 'quality'",
    });
    const rw = await persistCanonical(appPool, 'sms.reject_event', REJECT_COLS, w, {
      extraExistingFilter: "AND reject_type = 'weight'",
    });
    const findings = computeFindings(w, 'reject', 'reject_event', (r) => r.weight_g);
    await persistFindings(appPool, runId, findings);
    out.push({
      table: 'reject_event',
      read: rq.read + rw.read,
      written: rq.written + rw.written,
      findings,
    });
  }

  // keep the reject-code lookup populated with any new code pairs (labels pending Q10)
  await seedRejectCodes(appPool);

  return out;
}
