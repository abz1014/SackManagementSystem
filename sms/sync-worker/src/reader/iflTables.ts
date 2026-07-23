/**
 * The coupling boundary: everything IFL-schema-specific lives here.
 * Each definition maps a source *_TP1U2 wide table to its verbatim raw table.
 * `src` is the IFL column, `raw` the sms_raw column, `type` drives fingerprint
 * + bulk-insert typing. `id` is always the source row key (SCHEMA rule).
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
      { src: 'Source', raw: 'src_Source', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
      { src: 'inRange', raw: 'src_inRange', type: 'bit' },
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
      { src: 'Source', raw: 'src_Source', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'TubeInspectResult', raw: 'src_TubeInspectResult', type: 'int' },
      { src: 'MaterialInspectResult', raw: 'src_MaterialInspectResult', type: 'int' },
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
      { src: 'Source', raw: 'src_Source', type: 'int' },
      { src: 'Lifter', raw: 'src_Lifter', type: 'int' },
      { src: 'Weight', raw: 'src_Weight', type: 'decimal' },
    ],
  },
];
