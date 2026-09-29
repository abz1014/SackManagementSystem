/**
 * The coupling boundary: everything IFL-schema-specific lives here.
 * Each definition maps a source *_TP1U2 wide table to its verbatim raw table.
 * `src` is the IFL column, `raw` the sms_raw column, `type` drives fingerprint
 * + bulk-insert typing. `id` is always the source row key (SCHEMA rule).
 *
 * ROADMAP PHASE 1 (14 Sep 2026): the NAMES are configuration, the SHAPES are
 * code. Until this change `IFL_TABLES` was a const the runner iterated, so the
 * four table names — which carry the line in their suffix, `pack1_TP1U2` —
 * were a source-code fact, and a second line's tables were a code change.
 * They now come from `sms.source_table` (migration 028) through
 * `loadSourceTables()` in sourceTables.ts. What stays here is the per-kind
 * column shape: it is the vendor's schema, fingerprinted per generation, and
 * a table of a given kind looks the same whichever line it belongs to.
 *
 * `DEFAULT_IFL_TABLES` is the installation migration 028 seeds for line 1,
 * kept for tests and documentation only. Nothing in the worker iterates it.
 *
 * SEPTEMBER 2026 SCHEMA. IFL rebuilt these tables on 2026-08-05 and changed two
 * things that reach us:
 *
 *  1. `Source` was renamed `MachineNo` on the three cone/reject tables. Same
 *     quantity — the machine that weighed the cone, observed 1..14, matching the
 *     14 rewinders in IFL's own line drawing — so `src_Source` is RENAMED rather
 *     than replaced (migration 024), keeping every historical value. `sack1` never
 *     had it and still does not: sacks carry no machine, which is why sack-stock
 *     per machine remains uncomputable (CLAUDE.md's sack-stock blocker).
 *
 *  2. `MaterialId` was ADDED to all four tables and is populated on 100% of rows
 *     (verified: pack1 132,552/132,552, sack1 5,435/5,435, rejectQCS1 6,049/6,049).
 *     It joins to PDAS.dbo.Materials. This is the product key SCHEMA.md OQ-1
 *     recorded as non-existent and which forced NullAttribution across the whole
 *     project; IFL confirmed on 2026-09-10 that it is trustworthy.
 *
 * The July shape is NOT supported. It is gone from IFL's live server, and
 * carrying both would mean a reader that cannot tell a schema change from a
 * misconfiguration — exactly what the fingerprint gate exists to prevent.
 */
export type ColType = 'int' | 'datetime' | 'varchar' | 'decimal' | 'bit';

export interface RawColumn {
  src: string;
  raw: string;
  type: ColType;
}

/** The kinds of source table the raw layer has a shape for (sms.source_table.kind). */
export type TableKind = 'cone' | 'sack' | 'reject_qcs' | 'reject_weight';
export const TABLE_KINDS: readonly TableKind[] = ['cone', 'sack', 'reject_qcs', 'reject_weight'];

export interface IflTableDef {
  key: TableKind;
  sourceTable: string; // in the acquisition database (DATA_TP1U2 today)
  rawTable: string; // sms_raw.*
  /**
   * `system_code` of the sms.data_source this table is read through — the value
   * every raw and canonical row's `source_system` carries, and `sync_run.adapter`.
   * Was the literal 'ifl_sql' at six code sites; now a fact of the row.
   */
  systemCode: string;
  columns: RawColumn[]; // excludes the id key, which is handled explicitly
}

/** What a kind of source table looks like, and which raw table holds it verbatim. */
export interface TableShape {
  rawTable: string;
  columns: RawColumn[];
}

const idCol: RawColumn = { src: 'id', raw: 'src_id', type: 'int' };

/**
 * The column shape of each kind. The raw table is part of the shape, not of
 * the configuration: migration 005/024 created one raw table per kind, and the
 * transform (runTransform.ts) reads each kind's raw table by name. A source
 * table of kind 'cone' can therefore only ever land in sms_raw.cone_raw —
 * `loadSourceTables` refuses a row that says otherwise, because rows written to
 * any other table would sync and never be transformed, which is the exact
 * silent-success failure this project keeps finding.
 */
export const TABLE_SHAPES: Record<TableKind, TableShape> = {
  cone: {
    rawTable: 'sms_raw.cone_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
      { src: 'HangerNum', raw: 'src_HangerNum', type: 'int' },
      { src: 'MachineNo', raw: 'src_MachineNo', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
      { src: 'inRange', raw: 'src_inRange', type: 'bit' },
      { src: 'MaterialId', raw: 'src_MaterialId', type: 'int' },
    ],
  },
  sack: {
    rawTable: 'sms_raw.sack_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'SackNum', raw: 'src_SackNum', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
      { src: 'inRange', raw: 'src_inRange', type: 'bit' },
      { src: 'MaterialId', raw: 'src_MaterialId', type: 'int' },
    ],
  },
  reject_qcs: {
    rawTable: 'sms_raw.reject_qcs_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
      { src: 'HangerNum', raw: 'src_HangerNum', type: 'int' },
      { src: 'MachineNo', raw: 'src_MachineNo', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'TubeInspectResult', raw: 'src_TubeInspectResult', type: 'int' },
      { src: 'MaterialInspectResult', raw: 'src_MaterialInspectResult', type: 'int' },
      { src: 'MaterialId', raw: 'src_MaterialId', type: 'int' },
    ],
  },
  reject_weight: {
    rawTable: 'sms_raw.reject_weight_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
      { src: 'HangerNum', raw: 'src_HangerNum', type: 'int' },
      { src: 'MachineNo', raw: 'src_MachineNo', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
      { src: 'MaterialId', raw: 'src_MaterialId', type: 'int' },
    ],
  },
};

/**
 * The JULY shape (R-17, 29 Sep 2026) — what `pack1_TP1U2`/`sack1_TP1U2`/
 * `rejectQCS1_TP1U2`/`rejectWeight1_TP1U2` looked like BEFORE IFL's
 * 2026-08-05 rebuild: `Source` (not yet renamed `MachineNo`), and no
 * `MaterialId` column at all. The July sample already sitting on this
 * machine (source_epoch 1-4, generation_ordinal 1, seeded closed by
 * scripts/seed-dev-epochs.sql) was read through this exact shape; the
 * 10 Jul - 5 Aug archive IFL has not yet sent is the SAME physical
 * generation's tail and must be read through it too — never through
 * `TABLE_SHAPES`, which is the September shape and would silently misread a
 * renamed/absent column.
 *
 * ADDITIVE ONLY. `TABLE_SHAPES` above is what every live pass and `sms
 * rebuild` read through — the July shape is NOT supported there and the
 * comment at the top of this file is right that carrying both in the LIVE
 * reader would mean it could no longer tell a schema change from a
 * misconfiguration. This export exists for exactly one narrow, deliberate
 * caller: `sync-worker/src/backfill.ts` / `sms epoch:backfill`, which loads a
 * historic archive into an already-CLOSED epoch and nothing else. It must
 * never be wired into `runner.ts`, `runTransform.ts`, or `loadSourceTables`.
 *
 * The raw column names are identical to `TABLE_SHAPES` (`src_MachineNo`,
 * `src_MaterialId`, ...) — only the SOURCE side differs — so a July row and a
 * September row land in the same `sms_raw.*` table, verbatim, exactly as the
 * raw layer's own contract promises. `MaterialId` has no column to omit here:
 * it is simply absent from `columns`, so `persistRaw`'s typed bulk load never
 * supplies a value for `src_MaterialId` and the column keeps its NULL default
 * — honestly reflecting "this row predates product attribution", the same
 * fact every other pre-August row already carries.
 */
export const JULY_TABLE_SHAPES: Record<TableKind, TableShape> = {
  cone: {
    rawTable: 'sms_raw.cone_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
      { src: 'HangerNum', raw: 'src_HangerNum', type: 'int' },
      { src: 'Source', raw: 'src_MachineNo', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
      { src: 'inRange', raw: 'src_inRange', type: 'bit' },
      // no MaterialId column in the July source — src_MaterialId is left NULL.
    ],
  },
  sack: {
    rawTable: 'sms_raw.sack_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'SackNum', raw: 'src_SackNum', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
      { src: 'inRange', raw: 'src_inRange', type: 'bit' },
      // sack1_TP1U2 never carried Source/MachineNo, July or September.
    ],
  },
  reject_qcs: {
    rawTable: 'sms_raw.reject_qcs_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
      { src: 'HangerNum', raw: 'src_HangerNum', type: 'int' },
      { src: 'Source', raw: 'src_MachineNo', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'TubeInspectResult', raw: 'src_TubeInspectResult', type: 'int' },
      { src: 'MaterialInspectResult', raw: 'src_MaterialInspectResult', type: 'int' },
    ],
  },
  reject_weight: {
    rawTable: 'sms_raw.reject_weight_raw',
    columns: [
      idCol,
      { src: 'Date', raw: 'src_Date', type: 'datetime' },
      { src: 'Shift', raw: 'src_Shift', type: 'varchar' },
      { src: 'Area', raw: 'src_Area', type: 'varchar' },
      { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
      { src: 'HangerNum', raw: 'src_HangerNum', type: 'int' },
      { src: 'Source', raw: 'src_MachineNo', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
    ],
  },
};

/** `sms_raw.cone_raw` → `cone_raw`: the form sync_run.target_table and dq_finding.subject_table use. */
export const rawShortName = (rawTable: string): string => rawTable.replace('sms_raw.', '');

/**
 * `sync_run.adapter` for a halt row written when the configuration itself could
 * not be read — nothing is configured, or the app database is not migrated.
 * Written in place of a system code so the row does not claim an adapter that
 * was never resolved.
 */
export const UNKNOWN_ADAPTER = 'unknown';

/**
 * The raw tables a pre-read halt owes a row to when `loadSourceTables` cannot
 * answer: every kind the schema has. Setup counts "did not sync" per
 * target_table, so a pass that could not even read its configuration must
 * still leave one 'halted' row per raw table — otherwise the last good rows
 * stay 'success' and quietly age (the defect 478c456 closed for every other
 * pre-read halt).
 */
export function fallbackHaltTargets(): { targetTable: string; adapter: string }[] {
  return TABLE_KINDS.map((k) => ({ targetTable: rawShortName(TABLE_SHAPES[k].rawTable), adapter: UNKNOWN_ADAPTER }));
}

/**
 * The installation migration 028 seeds for line 1 — the four *_TP1U2 tables of
 * IFL's acquisition database, read through the 'ifl_sql' adapter. For tests
 * and documentation only: the worker and the CLI load theirs from
 * sms.source_table at the start of every pass and command.
 */
export const DEFAULT_IFL_TABLES: IflTableDef[] = [
  { key: 'cone', sourceTable: 'pack1_TP1U2', systemCode: 'ifl_sql', ...TABLE_SHAPES.cone },
  { key: 'sack', sourceTable: 'sack1_TP1U2', systemCode: 'ifl_sql', ...TABLE_SHAPES.sack },
  { key: 'reject_qcs', sourceTable: 'rejectQCS1_TP1U2', systemCode: 'ifl_sql', ...TABLE_SHAPES.reject_qcs },
  { key: 'reject_weight', sourceTable: 'rejectWeight1_TP1U2', systemCode: 'ifl_sql', ...TABLE_SHAPES.reject_weight },
];
