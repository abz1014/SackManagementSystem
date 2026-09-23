/**
 * Which source tables feed this line — from configuration, not from code.
 *
 * Roadmap Phase 1 (14 Sep 2026). `sms.source_table` (migration 028) holds one
 * row per (line, kind): the physical table in the acquisition database, the
 * raw table it lands in, and the data source it is read through. The worker
 * loads these at the start of EVERY pass, and the CLI at the start of every
 * command, so a table renamed or disabled in Setup › Sources applies on the
 * next pass with no restart — and a second line is four rows, not a build.
 *
 * What is still code is the column SHAPE of each kind (iflTables.ts): it is
 * the vendor's schema, fingerprinted per generation, and it is the same for
 * every line. A row here is merged with its kind's shape to give the runner
 * the `IflTableDef` it has always worked from.
 *
 * NOTHING IS GUESSED. A line with no enabled rows halts the pass with a message
 * that names the screen to fix it in; it does not fall back to the line-1
 * defaults, because a worker for LINE_ID=2 silently reading line 1's tables is
 * the cross-contamination transform.ts's mapper comment warns about.
 *
 * IDENTIFIERS, NOT PARAMETERS. The table name a row carries is interpolated,
 * bracket-quoted, into the reader's SQL (`FROM [pack1_TP1U2]`) — T-SQL cannot
 * bind an identifier. It is therefore validated against a strict identifier
 * pattern here, once, before anything is built from it, the same way
 * seedProducts.ts treats the PDAS database name. The API applies the same
 * pattern on write; this is the check that holds when the row was edited in
 * SSMS instead.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { TABLE_SHAPES, TABLE_KINDS, rawShortName, type IflTableDef, type TableKind } from './iflTables.js';

/** A plain SQL Server identifier — what a source table name must be to be bracket-quoted safely. */
export const SOURCE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * The one gate every value of `sms.source_table.source_table` passes before it
 * leaves this module, whichever loader read it.
 *
 * 23 Sep 2026. `defsFromRows` has applied `SOURCE_TABLE_NAME` since roadmap
 * Phase 1, and `lineConfig.updateSourceTable` applies the same pattern on
 * write — so the name that reaches `[${def.sourceTable}]` in the reader, in
 * `epoch.ts` and in `verify.ts` was already validated at both ends.
 * `loadSourceStreams` was the ONE exit from this module that returned the same
 * operator-editable column without the check. Its callers today
 * (`runTransform.ts`, `cli rebuild`) only bind it as a parameter or print it,
 * so nothing was exploitable — but the next caller to interpolate it would
 * have had no way to know that, and working rule 3 admits no "the current
 * callers happen to bind it" exemption. Validated here, once, so the property
 * belongs to the module rather than to a reading of its call sites.
 */
export function assertSourceTableName(name: string, lineId: number, kind: string): string {
  if (!SOURCE_TABLE_NAME.test(name)) {
    throw new Error(
      `refusing to build SQL with an unsafe source table name: ${JSON.stringify(name)} ` +
        `(line ${lineId}, kind ${kind}) — sms.source_table.source_table must be a plain SQL Server identifier`,
    );
  }
  return name;
}

/** One row of sms.source_table joined to its data source, as the query returns it. */
export interface SourceTableRow {
  kind: string;
  source_table: string;
  raw_table: string;
  system_code: string;
}

const isKind = (k: string): k is TableKind => (TABLE_KINDS as readonly string[]).includes(k);

/** The halt every caller raises on an unconfigured line — one wording, so Setup and the log agree. */
export function noSourceTablesError(lineId: number): Error {
  return new Error(
    `No source tables are configured for line ${lineId}. Add them in Setup › Sources (sms.source_table).`,
  );
}

/**
 * Rows → table definitions. Pure, so the validation is testable without a
 * database. Throws on the first row that cannot be used: a kind this worker
 * has no shape for, a table name that is not an identifier, or a raw table
 * that is not the one the transform reads for that kind.
 */
export function defsFromRows(rows: SourceTableRow[], lineId: number): IflTableDef[] {
  if (rows.length === 0) throw noSourceTablesError(lineId);
  return rows.map((r) => {
    if (!isKind(r.kind)) {
      throw new Error(
        `sms.source_table row for line ${lineId} has kind ${JSON.stringify(r.kind)}, which this ` +
          `worker has no column shape for (known: ${TABLE_KINDS.join(', ')}).`,
      );
    }
    assertSourceTableName(r.source_table, lineId, r.kind);
    const shape = TABLE_SHAPES[r.kind];
    if (r.raw_table !== shape.rawTable) {
      throw new Error(
        `sms.source_table row for line ${lineId}, kind ${r.kind}, names raw table ` +
          `${JSON.stringify(r.raw_table)}, but the transform reads ${shape.rawTable} for that kind. ` +
          `Rows written anywhere else would sync and never be transformed. The raw table of a kind ` +
          `is fixed by migration; only the source table name is configuration.`,
      );
    }
    if (!r.system_code) {
      throw new Error(`sms.data_source for ${r.source_table} (line ${lineId}) has an empty system_code.`);
    }
    return {
      key: r.kind,
      sourceTable: r.source_table,
      rawTable: shape.rawTable,
      systemCode: r.system_code,
      columns: shape.columns,
    };
  });
}

/**
 * The enabled source tables of a line, in configuration order. Throws the
 * "no source tables" halt when there are none — the runner records it as a
 * pre-read halt, and the CLI commands stop on it the same way.
 *
 * Both the table's own flag and its data source's flag gate the row: a source
 * system disabled in Setup › Sources takes every table read through it with it.
 */
export async function loadSourceTables(appPool: ConnectionPool, lineId: number): Promise<IflTableDef[]> {
  const r = await appPool
    .request()
    .input('line', mssql.Int, lineId)
    .query<SourceTableRow>(
      `SELECT st.kind, st.source_table, st.raw_table, ds.system_code
         FROM sms.source_table st
         JOIN sms.data_source ds ON ds.data_source_id = st.data_source_id
        WHERE st.line_id = @line AND st.is_enabled = 1 AND ds.is_enabled = 1
        ORDER BY st.source_table_id`,
    );
  return defsFromRows(r.recordset, lineId);
}

/**
 * What the transform needs per kind: the system code its rows carry as
 * `source_system`, and the source table's name for a finding to cite. Also
 * what `sms rebuild` deletes by.
 *
 * Unlike `loadSourceTables` this ignores is_enabled: a table disabled in
 * Setup has already put rows in the raw layer, and a rebuild must still stamp
 * them with the adapter they actually came through. A kind with no row at all
 * on this line falls back to the line's acquisition data source for the code
 * (the contract's "the line's acquisition data_source") and to the raw
 * table's own name for the label; a line with neither is the same
 * "no source tables" halt.
 */
export interface SourceStream {
  systemCode: string;
  /** The configured source table, or the raw table's short name when no row names one. */
  sourceTable: string;
}

export async function loadSourceStreams(
  appPool: ConnectionPool,
  lineId: number,
): Promise<Record<TableKind, SourceStream>> {
  const rows = await appPool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ kind: string; source_table: string; system_code: string }>(
      `SELECT st.kind, st.source_table, ds.system_code
         FROM sms.source_table st
         JOIN sms.data_source ds ON ds.data_source_id = st.data_source_id
        WHERE st.line_id = @line
        ORDER BY st.source_table_id`,
    );
  const byKind = new Map(rows.recordset.map((r) => [r.kind, r]));
  let fallback: string | undefined;
  if (TABLE_KINDS.some((k) => !byKind.has(k))) {
    // Enabled first, then the oldest: the one acquisition source an installation
    // has, whichever flag it carries today.
    const acq = await appPool
      .request()
      .query<{ system_code: string }>(
        `SELECT TOP 1 system_code FROM sms.data_source
          WHERE role = 'acquisition' ORDER BY is_enabled DESC, data_source_id`,
      );
    fallback = acq.recordset[0]?.system_code;
  }
  const out = {} as Record<TableKind, SourceStream>;
  for (const k of TABLE_KINDS) {
    const row = byKind.get(k);
    const systemCode = row?.system_code ?? fallback;
    if (!systemCode) throw noSourceTablesError(lineId);
    // Same gate as defsFromRows: this loader returns the operator-editable
    // column too, and a caller cannot tell the two loaders' outputs apart.
    const name = row?.source_table ?? rawShortName(TABLE_SHAPES[k].rawTable);
    out[k] = { systemCode, sourceTable: assertSourceTableName(name, lineId, k) };
  }
  return out;
}
