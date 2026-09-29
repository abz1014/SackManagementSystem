/**
 * services/dqAck.ts on its own, with a fake pool modelling
 * sms.dq_finding/sms.dq_acknowledgement (Task W2-B, 29 Sep 2026, failure
 * analysis F-24). Route-level RBAC/audit proof is in routes/dqAck.test.ts.
 */
import { describe, it, expect } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { acknowledgeDqFinding, listDqAcknowledgements } from './dqAck.js';

interface FindingRow { finding_id: number; check_name: string }
interface AckRow { finding_id: number; acknowledged_by: number; reason: string; display_name: string | null; username: string }

function fakePool(opts: { findings: FindingRow[]; acks?: AckRow[]; ackTableMissing?: boolean }) {
  const acks = opts.acks ? [...opts.acks] : [];
  const request = () => {
    const params: Record<string, unknown> = {};
    const req = {
      input: (name: string, _t: unknown, value: unknown) => { params[name] = value; return req; },
      query: async <T,>(sql: string) => {
        if (opts.ackTableMissing && /dq_acknowledgement/.test(sql)) {
          throw new Error("Invalid object name 'sms.dq_acknowledgement'.");
        }
        if (/SELECT check_name FROM sms\.dq_finding/.test(sql)) {
          const row = opts.findings.find((f) => f.finding_id === params.id);
          return { recordset: row ? [{ check_name: row.check_name }] as T[] : [], rowsAffected: [row ? 1 : 0] };
        }
        if (/SELECT COUNT\(\*\) AS n FROM sms\.dq_acknowledgement/.test(sql)) {
          const n = acks.filter((a) => a.finding_id === params.id).length;
          return { recordset: [{ n }] as T[], rowsAffected: [1] };
        }
        if (/INSERT INTO sms\.dq_acknowledgement/.test(sql)) {
          const row: AckRow = {
            finding_id: params.id as number,
            acknowledged_by: params.by as number,
            reason: params.reason as string,
            display_name: null,
            username: `user${params.by}`,
          };
          acks.push(row);
          return { recordset: [{ acknowledged_utc: new Date('2026-09-29T12:00:00.000Z') }] as T[], rowsAffected: [1] };
        }
        if (/FROM sms\.dq_acknowledgement a\s+LEFT JOIN sms\.app_user/.test(sql)) {
          return {
            recordset: acks.map((a) => ({
              finding_id: a.finding_id,
              acknowledged_utc: new Date('2026-09-29T12:00:00.000Z'),
              reason: a.reason,
              display_name: a.display_name,
              username: a.username,
            })) as T[],
            rowsAffected: [acks.length],
          };
        }
        throw new Error(`fakePool: unhandled query: ${sql}`);
      },
    };
    return req;
  };
  return { request } as unknown as ConnectionPool;
}

describe('acknowledgeDqFinding', () => {
  it('404s a finding_id that does not exist', async () => {
    const pool = fakePool({ findings: [] });
    const r = await acknowledgeDqFinding(pool, { findingId: 999, actorId: 2, reason: 'looked at it, benign' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('refuses a system-state check (persistent_sync_failure) — never acknowledgeable', async () => {
    const pool = fakePool({ findings: [{ finding_id: 1, check_name: 'persistent_sync_failure' }] });
    const r = await acknowledgeDqFinding(pool, { findingId: 1, actorId: 2, reason: 'the worker is fine, I checked' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
  });

  it('refuses every other named system-state check too', async () => {
    const names = ['transform_failed', 'transform_zero_write', 'raw_read_without_write', 'product_mirror_failed', 'pdas_write_unverified', 'pdas_write_readback_failed', 'pdas_write_echo_mismatch'];
    for (const [i, name] of names.entries()) {
      const pool = fakePool({ findings: [{ finding_id: i + 1, check_name: name }] });
      const r = await acknowledgeDqFinding(pool, { findingId: i + 1, actorId: 2, reason: 'reviewed this finding' });
      expect(r, name).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    }
  });

  it('accepts every allow-listed data-fact check', async () => {
    const names = ['nonpositive_weight', 'stale_timestamp', 'future_timestamp', 'isolated_production_day', 'station_not_in_roster', 'source_columns_changed'];
    for (const [i, name] of names.entries()) {
      const pool = fakePool({ findings: [{ finding_id: i + 1, check_name: name }] });
      const r = await acknowledgeDqFinding(pool, { findingId: i + 1, actorId: 2, reason: 'reviewed, known and benign' });
      expect(r, name).toMatchObject({ ok: true, findingId: i + 1, reason: 'reviewed, known and benign' });
    }
  });

  it('409s a finding already acknowledged', async () => {
    const pool = fakePool({
      findings: [{ finding_id: 1, check_name: 'nonpositive_weight' }],
      acks: [{ finding_id: 1, acknowledged_by: 2, reason: 'already looked at', display_name: null, username: 'engineer' }],
    });
    const r = await acknowledgeDqFinding(pool, { findingId: 1, actorId: 3, reason: 'looking again, still fine' });
    expect(r).toMatchObject({ ok: false, code: 'ALREADY_ACKNOWLEDGED' });
  });

  it('a successful acknowledgement returns the finding id, reason and an ISO timestamp', async () => {
    const pool = fakePool({ findings: [{ finding_id: 42, check_name: 'stale_timestamp' }] });
    const r = await acknowledgeDqFinding(pool, { findingId: 42, actorId: 5, reason: 'clock-fault day, already known' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.findingId).toBe(42);
      expect(r.acknowledgedBy).toBe(5);
      expect(r.reason).toBe('clock-fault day, already known');
      expect(new Date(r.acknowledgedUtc).toISOString()).toBe(r.acknowledgedUtc);
    }
  });
});

describe('listDqAcknowledgements', () => {
  it('returns an empty map, not an error, when sms.dq_acknowledgement does not exist yet', async () => {
    const pool = fakePool({ findings: [], ackTableMissing: true });
    const m = await listDqAcknowledgements(pool);
    expect(m.size).toBe(0);
  });

  it('maps finding_id to who/when/why', async () => {
    const pool = fakePool({
      findings: [],
      acks: [{ finding_id: 7, acknowledged_by: 2, reason: 'known clock fault', display_name: 'Ali Raza', username: 'ali' }],
    });
    const m = await listDqAcknowledgements(pool);
    expect(m.get(7)).toMatchObject({ findingId: 7, acknowledgedBy: 'Ali Raza', reason: 'known clock fault' });
  });

  it('falls back to username when display_name is null', async () => {
    const pool = fakePool({
      findings: [],
      acks: [{ finding_id: 8, acknowledged_by: 2, reason: 'reviewed', display_name: null, username: 'engineer2' }],
    });
    const m = await listDqAcknowledgements(pool);
    expect(m.get(8)?.acknowledgedBy).toBe('engineer2');
  });
});
