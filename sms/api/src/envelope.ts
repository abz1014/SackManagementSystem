/**
 * Standard response envelope (ARCHITECTURE §9): every payload carries metadata
 * so the UI can show freshness + which interpretation (weight/shift) is active.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { epochFragment } from './services/generation.js';
import { resolveLiveScope } from './services/live.js';

export interface Meta {
  generatedAtUtc: string;
  weightBasis: string;
  shiftMode: string;
  transformVersion: number;
  lastSyncUtc: string | null;
  sourceAgeSeconds: number | null;
}

export interface Envelope<T> {
  data: T;
  metadata: Meta;
}

/**
 * Read the active rule + freshness metadata for the response envelope.
 *
 * `transformVersion` is scoped to ONE source generation (23 Sep 2026, D-11).
 * It is the envelope's answer to "which transform produced what you are
 * looking at", and `MAX(transform_version)` over every generation answers a
 * different question: the highest version ever written for this line,
 * including to rows no screen in this response is reading. On a sidecar
 * holding a generation transformed at v2 beside one still at v1, every
 * payload claimed v2. The generation chosen is the one the live screens
 * read, for the same reason they chose it — see `services/live.ts`.
 *
 * The scope probe is the cached one, so this adds no round trip per request
 * beyond the first in each sixty-second window.
 */
export async function loadMeta(pool: ConnectionPool, lineId: number): Promise<Meta> {
  const scope = await resolveLiveScope(pool, lineId);
  const coneF = epochFragment(scope, 'cone_event');
  const req = pool.request().input('line', mssql.Int, lineId);
  for (const p of coneF.params) req.input(p.name, mssql.Int, p.id);
  const r = await req.query<{
    weightBasis: string | null;
    shiftMode: string | null;
    transformVersion: number | null;
    lastSyncUtc: Date | null;
    sourceAgeSeconds: number | null;
  }>(`
    SELECT
      -- RT24-04: "in force right now" — bounded by effective_from <=
      -- SYSUTCDATETIME() so a future-dated row cannot read as current early.
      (SELECT TOP 1 basis FROM sms.weight_rule WHERE line_id=@line AND effective_from <= SYSUTCDATETIME() ORDER BY effective_from DESC) AS weightBasis,
      (SELECT TOP 1 mode  FROM sms.shift_rule  WHERE line_id=@line AND effective_from <= SYSUTCDATETIME() ORDER BY effective_from DESC) AS shiftMode,
      (SELECT MAX(transform_version) FROM sms.cone_event WHERE line_id=@line${coneF.sql ? ` AND ${coneF.sql}` : ''}) AS transformVersion,
      (SELECT MAX(finished_at_utc) FROM sms.sync_run WHERE line_id=@line AND outcome='success') AS lastSyncUtc,
      DATEDIFF(SECOND,
        (SELECT MAX(finished_at_utc) FROM sms.sync_run WHERE line_id=@line AND outcome='success'),
        SYSUTCDATETIME()) AS sourceAgeSeconds
  `);
  const row = r.recordset[0];
  return {
    generatedAtUtc: new Date().toISOString(),
    weightBasis: row?.weightBasis ?? 'as_recorded',
    shiftMode: row?.shiftMode ?? 'corrected',
    transformVersion: row?.transformVersion ?? 0,
    lastSyncUtc: row?.lastSyncUtc ? new Date(row.lastSyncUtc).toISOString() : null,
    sourceAgeSeconds: row?.sourceAgeSeconds ?? null,
  };
}

export async function envelope<T>(
  pool: ConnectionPool,
  lineId: number,
  data: T,
): Promise<Envelope<T>> {
  return { data, metadata: await loadMeta(pool, lineId) };
}
