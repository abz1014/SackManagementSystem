/**
 * IflSqlAdapter — the ONLY component that knows IFL's schema (ARCHITECTURE §10).
 * Reads the *_TP1U2 wide tables read-only, parameterised, keyed on `id`.
 * Produces verbatim raw records keyed by sms_raw column names.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import {
  computeFingerprint,
  type SchemaColumn,
} from './fingerprint.js';
import type { IflTableDef } from './iflTables.js';

export type RawRecord = Record<string, unknown>;

export class IflSqlAdapter {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly def: IflTableDef,
  ) {}

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
