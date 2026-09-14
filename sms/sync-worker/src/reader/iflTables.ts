/**
 * The coupling boundary: everything IFL-schema-specific lives here.
 * Each definition maps a source *_TP1U2 wide table to its verbatim raw table.
 * `src` is the IFL column, `raw` the sms_raw column, `type` drives fingerprint
 * + bulk-insert typing. `id` is always the source row key (SCHEMA rule).
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

export interface IflTableDef {
  key: 'cone' | 'sack' | 'reject_qcs' | 'reject_weight';
  sourceTable: string; // in DATA_TP1U2
  rawTable: string; // sms_raw.*
  columns: RawColumn[]; // excludes the id key, which is handled explicitly
}

const idCol: RawColumn = { src: 'id', raw: 'src_id', type: 'int' };

export const IFL_TABLES: IflTableDef[] = [
  {
    key: 'cone',
    sourceTable: 'pack1_TP1U2',
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
  {
    key: 'sack',
    sourceTable: 'sack1_TP1U2',
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
  {
    key: 'reject_qcs',
    sourceTable: 'rejectQCS1_TP1U2',
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
  {
    key: 'reject_weight',
    sourceTable: 'rejectWeight1_TP1U2',
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
];
