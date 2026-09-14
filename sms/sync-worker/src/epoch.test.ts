/**
 * Regression tests for resolveEpoch — the generation gate (Sep 2026).
 *
 * Every branch here is a way the sync worker used to be silently wrong. The
 * one that matters most is the last: a source that reports the SAME
 * create_date but a different database is "pointed at the wrong copy", and it
 * must halt exactly like a vendor rebuild does. That is why server and
 * database are part of the epoch's identity rather than decoration.
 *
 * resolveEpoch never guesses. There is no default epoch: defaulting to "the
 * newest" or to 1 reproduces the original blackout, and auto-registering would
 * have re-ingested the simulator a second time the moment its tables were
 * rebuilt. So every mismatch throws, and the message names `sms epoch:accept`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

const source = {
  createdKey: '2026-08-05T19:03:16.353Z' as string | null,
  fingerprint: 'bf17df27200feeb21ac65c2e5dfc39e7',
};
vi.mock('./reader/IflSqlAdapter.js', () => ({
  IflSqlAdapter: class {
    async sourceEpoch() {
      return source.createdKey;
    }
    async fingerprint() {
      return source.fingerprint;
    }
  },
}));

const { resolveEpoch } = await import('./epoch.js');

const OPEN = {
  epoch_id: 9,
  line_id: 1,
  source_table: 'pack1_TP1U2',
  source_server: 'localhost',
  source_db: 'DATA_TP1U2_SEP07',
  source_created_key: '2026-08-05T19:03:16.353Z',
  schema_fingerprint: 'bf17df27200feeb21ac65c2e5dfc39e7',
  provenance: 'ifl_copy',
  generation_ordinal: 3,
  label: 'September copy',
};

/** App pool whose only query is openEpoch's; returns whatever `openRows` holds. */
let openRows: (typeof OPEN)[] = [OPEN];
const appPool = {
  request: () => {
    const req = { input: () => req, query: async () => ({ recordset: openRows }) };
    return req;
  },
} as unknown as ConnectionPool;
const iflPool = {} as ConnectionPool;
const def = { key: 'cone', sourceTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', columns: [] } as never;
const iflDb = { server: 'localhost', database: 'DATA_TP1U2_SEP07' } as never;

beforeEach(() => {
  openRows = [OPEN];
  source.createdKey = OPEN.source_created_key;
  source.fingerprint = OPEN.schema_fingerprint;
});

describe('resolveEpoch', () => {
  it('returns the open epoch when server, database, create_date and fingerprint all match', async () => {
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).resolves.toMatchObject({ epoch_id: 9 });
  });

  it('halts when no generation is open, and names the command that fixes it', async () => {
    openRows = [];
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/No open source generation/);
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/sms epoch:accept/);
  });

  it('halts when the source table was recreated (create_date moved)', async () => {
    // IFL's 2026-08-05 rebuild, seen from an app DB still open on the July generation.
    source.createdKey = '2026-09-30T08:00:00.000Z';
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/generation changed/);
  });

  it('halts when the same create_date is reported by a DIFFERENT database (wrong copy)', async () => {
    // A create_date alone cannot tell "vendor rebuilt the table" from
    // "IFL_DB_NAME_DATA points at the wrong database". This is the case a
    // create_date-only gate would have waved through.
    await expect(
      resolveEpoch(appPool, iflPool, def, 1, { server: 'localhost', database: 'DATA_TP1U2' } as never),
    ).rejects.toThrow(/generation changed/);
  });

  it('halts on column drift within a live generation', async () => {
    source.fingerprint = '00000000000000000000000000000000';
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/Schema drift/);
  });

  it('halts, rather than defaulting, when the source reports no create_date at all', async () => {
    source.createdKey = null;
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/Cannot read create_date/);
  });
});
