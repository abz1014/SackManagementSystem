/**
 * IflSqlAdapter — the ONLY component that knows IFL's schema (ARCHITECTURE §10).
 * Reads the *_TP1U2 wide tables read-only, parameterised, keyed on `id`.
 * Produces verbatim raw records keyed by sms_raw column names.
 *
 * Implements SourceAdapter (roadmap Phase 2, 14 Sep 2026) and is reached only
 * through `createAdapter('ifl_sql', ...)` outside tests. Every query here is a
 * read; the login it runs under is `sms_readonly`, and CLAUDE.md's Q21 rule —
 * no writes, no indexes, nothing on DATA_TP1U2 — is what this class is the
 * boundary of.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import {
  computeFingerprint,
  type SchemaColumn,
} from './fingerprint.js';
import type { IflTableDef } from './iflTables.js';
import { classifyError } from './errorClass.js';
import type { ProbeResult, SourceAdapter } from './SourceAdapter.js';

export type RawRecord = Record<string, unknown>;

export class IflSqlAdapter implements SourceAdapter {
  readonly systemCode = 'ifl_sql';

  constructor(
    private readonly pool: ConnectionPool,
    readonly def: IflTableDef,
  ) {}

  /**
   * Is the source there and answering? `SELECT 1` proves the connection and
   * the login; `COUNT(*) FROM sys.tables` proves the login can see the
   * catalogue, which is what every later gate (create_date, fingerprint,
   * column list) reads. Both in one round trip so the number logged as
   * `sourceProbeMs` is one real request, not a sum. Never throws: the runner
   * writes the classification into the pass-level halt rows.
   */
  async probe(): Promise<ProbeResult> {
    const started = Date.now();
    try {
      await this.pool
        .request()
        .query<{ one: number; tables: number }>(`SELECT 1 AS one, (SELECT COUNT(*) FROM sys.tables) AS tables`);
      return { ok: true, roundTripMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        classification: classifyError(err),
      };
    }
  }

  /**
   * The FULL column list, `"name type"` in ordinal order — every column the
   * table has, not only the ones this adapter reads. The fingerprint hashes
   * the depended-on columns by design (SEPT-2026-DB-FINDINGS-RAW.md:279), so a
   * column IFL adds and we do not read is invisible to it; this list is what
   * the worker compares against sms.source_epoch.column_list to notice one
   * (dq finding `source_columns_changed`). `sys.types.name` is the user type
   * as declared — decimal, not decimal(6,2) — so a precision change shows in
   * the fingerprint, not here; the two checks are complementary.
   */
  async columnList(): Promise<string[]> {
    const res = await this.pool
      .request()
      .input('tbl', mssql.NVarChar, `dbo.${this.def.sourceTable}`)
      .query<{ name: string; type: string }>(
        `SELECT c.name, t.name AS type
           FROM sys.columns c
           JOIN sys.types t ON t.user_type_id = c.user_type_id
          WHERE c.object_id = OBJECT_ID(@tbl)
          ORDER BY c.column_id`,
      );
    return res.recordset.map((r) => `${r.name} ${r.type}`);
  }

  /** Fingerprint of the depended-on columns of this source table. */
  async fingerprint(): Promise<string> {
    const res = await this.pool
      .request()
      .input('t', mssql.NVarChar, this.def.sourceTable)
      .query<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        NUMERIC_PRECISION: number | null;
        NUMERIC_SCALE: number | null;
        CHARACTER_MAXIMUM_LENGTH: number | null;
      }>(
        `SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = @t`,
      );
    const cols: SchemaColumn[] = res.recordset.map((r) => ({
      name: r.COLUMN_NAME,
      dataType: r.DATA_TYPE,
      numericPrecision: r.NUMERIC_PRECISION,
      numericScale: r.NUMERIC_SCALE,
      charMaxLength: r.CHARACTER_MAXIMUM_LENGTH,
    }));
    const depended = this.def.columns.map((c) => c.src);
    return computeFingerprint(cols, depended);
  }

  /**
   * When the source TABLE was created, as an ISO string, or null if it cannot be
   * read. This is the epoch discriminator (finding: Sep 2026 source rebuild).
   *
   * IFL dropped and recreated the four wide tables on 2026-08-05 between 18:54:50
   * and 19:03:16, restarting every identity at 1. `sys.databases.create_date` does
   * NOT move for that — the database survived, only its tables were replaced — so
   * the per-table create_date is the signal that actually fires.
   *
   * Read-only, and needs no permission beyond seeing the table itself.
   */
  async sourceEpoch(): Promise<string | null> {
    // Schema-qualified. An unqualified name can match more than one table, and
    // silently taking the first would mean the generation key describes a
    // different object than the one we read rows from.
    const res = await this.pool
      .request()
      .input('t', mssql.NVarChar, this.def.sourceTable)
      .query<{ created: Date | null }>(
        `SELECT create_date AS created FROM sys.tables
          WHERE name = @t AND SCHEMA_NAME(schema_id) = 'dbo'`,
      );
    if (res.recordset.length > 1) {
      throw new Error(
        `ambiguous source table: ${res.recordset.length} tables named dbo.${this.def.sourceTable}`,
      );
    }
    const created = res.recordset[0]?.created ?? null;
    return created ? new Date(created).toISOString() : null;
  }

  /** Highest `id` currently in the source table, or null when it is empty. */
  async maxSourceId(): Promise<number | null> {
    const res = await this.pool
      .request()
      .query<{ hi: number | null }>(`SELECT MAX([id]) AS hi FROM [${this.def.sourceTable}]`);
    const hi = res.recordset[0]?.hi;
    return hi == null ? null : Number(hi);
  }

  /** Read source rows with id > afterId (parameterised), mapped to raw columns. */
  async readSince(afterId: number): Promise<RawRecord[]> {
    const srcList = this.def.columns.map((c) => `[${c.src}]`).join(', ');
    const res = await this.pool
      .request()
      .input('after', mssql.Int, afterId)
      .query(
        `SELECT ${srcList} FROM [${this.def.sourceTable}]
         WHERE [id] > @after ORDER BY [id]`,
      );
    return res.recordset.map((row: Record<string, unknown>) => {
      const out: RawRecord = {};
      for (const c of this.def.columns) out[c.raw] = row[c.src];
      return out;
    });
  }
}
