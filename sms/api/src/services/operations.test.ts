/**
 * The `source` block of /api/operations (roadmap Phase 2 item 5, 14 Sep
 * 2026) — derived from `sms.sync_run` alone, because this API has no
 * connection to IFL's database and can only report what the worker wrote.
 *
 * The fake pool holds one in-memory sync_run table and ANSWERS the three
 * source queries from it — latest row per table, the newest pass's rows, the
 * newest halt — rather than handing back canned rows, so each case below
 * exercises the derivation (which rows count as "the newest pass", what
 * "halted" means, how a probe failure is recognised) and not just the shape.
 * Every other query getOperations issues gets an empty result, which the
 * service handles as "nothing recorded".
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getOperations, PROBE_HALT_PATTERN } from './operations.js';

interface Run {
  sync_run_id: number;
  run_id: string;
  target_table: string;
  outcome: string;
  error_text: string | null;
  started_at_utc: Date;
}

function syncRunPool(runs: Run[], seen: { probeParam?: unknown } = {}): ConnectionPool {
  const mk = () => {
    const params = new Map<string, unknown>();
    const req = {
      input: (name: string, _type: unknown, value: unknown) => {
        params.set(name, value);
        return req;
      },
      query: async (sql: string) => {
        if (sql.includes('PARTITION BY target_table')) {
          const latest = new Map<string, Run>();
          for (const r of runs) {
            const cur = latest.get(r.target_table);
            if (!cur || r.sync_run_id > cur.sync_run_id) latest.set(r.target_table, r);
          }
          const rows = [...latest.values()]
            .sort((a, b) => a.target_table.localeCompare(b.target_table))
            .map((r) => ({
              target_table: r.target_table, outcome: r.outcome, watermark_from: null, watermark_to: null,
              source_epoch: null, epoch_label: null, rows_read: 0, rows_written: 0, finished_at_utc: null,
              age_seconds: null, started_at_utc: r.started_at_utc, error_text: r.error_text,
            }));
          return { recordset: rows };
        }
        if (sql.includes('AS probe_failed')) {
          seen.probeParam = params.get('probe');
          const pattern = String(params.get('probe')).replace(/%/g, '').toLowerCase();
          const connect = String(params.get('connect') ?? '%source connection%').replace(/%/g, '').toLowerCase();
          const newest = [...runs].sort(
            (a, b) => b.started_at_utc.getTime() - a.started_at_utc.getTime() || b.sync_run_id - a.sync_run_id,
          )[0];
          const pass = newest ? runs.filter((r) => r.run_id === newest.run_id) : [];
          const probeFailed = pass.filter(
            (r) =>
              r.outcome === 'halted' &&
              ((r.error_text ?? '').toLowerCase().includes(pattern) || (r.error_text ?? '').toLowerCase().includes(connect)),
          ).length;
          const started = pass.length ? new Date(Math.min(...pass.map((r) => r.started_at_utc.getTime()))) : null;
          return { recordset: [{ n: pass.length, probe_failed: pass.length ? probeFailed : null, started_at_utc: started }] };
        }
        if (sql.includes("outcome IN ('halted', 'failed')")) {
          const halts = runs.filter((r) => r.outcome === 'halted' || r.outcome === 'failed');
          const h = halts.sort((a, b) => b.sync_run_id - a.sync_run_id)[0];
          return { recordset: h ? [{ target_table: h.target_table, started_at_utc: h.started_at_utc, error_text: h.error_text }] : [] };
        }
        return { recordset: [] };
      },
    };
    return req;
  };
  return { request: mk } as unknown as ConnectionPool;
}

const TABLES = ['cone_raw', 'sack_raw', 'reject_qcs_raw', 'reject_weight_raw'];
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const t = (iso: string) => new Date(iso);

/** One row per table for a pass, all with the same outcome and reason. */
function pass(runId: string, firstId: number, at: string, outcome: string, error: string | null = null): Run[] {
  return TABLES.map((tt, i) => ({
    sync_run_id: firstId + i, run_id: runId, target_table: tt, outcome, error_text: error, started_at_utc: t(at),
  }));
}

describe('getOperations().source — derived from sync_run', () => {
  it('healthy: nothing halted, probe ok, and the last halt is still remembered from an earlier pass', async () => {
    const runs = [
      ...pass(P1, 1, '2026-09-14T06:00:00Z', 'halted', 'Pass halted at reference seed, before any table was read. Login failed for user'),
      ...pass(P2, 5, '2026-09-14T06:01:00Z', 'success'),
    ];
    const { source } = await getOperations(syncRunPool(runs), 1);
    expect(source.halted).toEqual([]);
    expect(source.lastProbeOk).toBe(true);
    expect(source.lastProbeAtUtc).toBe('2026-09-14T06:01:00.000Z');
    expect(source.lastProbeMs).toBeNull();
    expect(source.lastHalt).toEqual({
      table: 'reject_weight_raw',
      reason: 'Pass halted at reference seed, before any table was read. Login failed for user',
      atUtc: '2026-09-14T06:00:00.000Z',
    });
  });

  it('one table halted in the newest pass: halted names it, lastHalt carries its reason, the probe was fine', async () => {
    const runs = [
      ...pass(P1, 1, '2026-09-14T06:00:00Z', 'success'),
      ...pass(P2, 5, '2026-09-14T06:01:00Z', 'success'),
    ];
    // The cone table's newest row is a generation halt; the other three synced.
    runs[4] = { ...runs[4]!, outcome: 'halted', error_text: 'Unknown source generation of pack1_TP1U2. Sync halted BEFORE reading. Run `sms epoch:accept`.' };
    const { source } = await getOperations(syncRunPool(runs), 1);
    expect(source.halted).toEqual(['cone_raw']);
    expect(source.lastHalt?.table).toBe('cone_raw');
    expect(source.lastHalt?.reason).toContain('sms epoch:accept');
    expect(source.lastProbeOk).toBe(true);
  });

  it("a 'failed' latest row counts as not syncing too", async () => {
    const runs = pass(P2, 1, '2026-09-14T06:01:00Z', 'success');
    runs[1] = { ...runs[1]!, outcome: 'failed', error_text: 'Timeout: Request failed to complete in 30000ms' };
    const { source } = await getOperations(syncRunPool(runs), 1);
    expect(source.halted).toEqual(['sack_raw']);
    expect(source.lastHalt?.reason).toContain('Timeout');
  });

  it('a probe-failed pass: lastProbeOk is false and every table is halted', async () => {
    const runs = [
      ...pass(P1, 1, '2026-09-14T06:00:00Z', 'success'),
      ...pass(P2, 5, '2026-09-14T06:01:00Z', 'halted', 'source probe failed: transient: connect ETIMEDOUT 10.0.0.5:1433'),
    ];
    const seen: { probeParam?: unknown } = {};
    const { source } = await getOperations(syncRunPool(runs, seen), 1);
    expect(source.lastProbeOk).toBe(false);
    expect(source.lastProbeAtUtc).toBe('2026-09-14T06:01:00.000Z');
    expect(source.halted).toEqual(TABLES.slice().sort());
    expect(source.lastHalt?.reason).toMatch(/^source probe failed: transient/);
    // The pattern reaches SQL as a bound parameter, and is a contains-match.
    expect(seen.probeParam).toBe(PROBE_HALT_PATTERN);
    expect(PROBE_HALT_PATTERN).toBe('%source probe%');
  });

  it('a source CONNECTION failure (before the probe can run) is a failed probe too', async () => {
    // 15 Sep 2026 recovery rehearsal: IFL_DB_PORT unreachable → pass.ts halts
    // at the connection, every table halted, and lastProbeOk read true.
    const runs = pass(P2, 1, '2026-09-14T06:01:00Z', 'halted',
      'Pass halted at source connection, before any table was read. [transient] Failed to connect to localhost:1 - Could not connect (sequence)');
    const { source } = await getOperations(syncRunPool(runs), 1);
    expect(source.lastProbeOk).toBe(false);
  });

  it('a probe failure framed by the pass-level halt helper is still recognised', async () => {
    const runs = pass(P2, 1, '2026-09-14T06:01:00Z', 'halted',
      'Pass halted at source probe, before any table was read. source probe failed: auth: Login failed for user sms_reader');
    const { source } = await getOperations(syncRunPool(runs), 1);
    expect(source.lastProbeOk).toBe(false);
  });

  it('the newest pass is the one that STARTED last, so a later-written row for an earlier instant does not win', async () => {
    const runs = [
      // Written later (higher ids) but for an earlier instant — only the
      // probe verdict is asserted: `halted` is per table by row id, and in
      // real data (IDENTITY ids, one clock) the two orders never disagree.
      ...pass(P1, 10, '2026-09-14T05:00:00Z', 'halted', 'source probe failed: transient: ECONNRESET'),
      ...pass(P2, 1, '2026-09-14T06:01:00Z', 'success'),
    ];
    const { source } = await getOperations(syncRunPool(runs), 1);
    expect(source.lastProbeOk).toBe(true);
    expect(source.lastProbeAtUtc).toBe('2026-09-14T06:01:00.000Z');
  });

  it('an empty sync_run: every field is null or empty, never a claim', async () => {
    const { source } = await getOperations(syncRunPool([]), 1);
    expect(source).toEqual({ lastProbeOk: null, lastProbeAtUtc: null, lastProbeMs: null, lastHalt: null, halted: [] });
  });

  it('schema[].status is unchanged by the new block (no epochs → no entries)', async () => {
    const data = await getOperations(syncRunPool([]), 1);
    expect(data.schema).toEqual([]);
    expect(Object.keys(data)).toContain('source');
  });
});
