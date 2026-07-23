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
