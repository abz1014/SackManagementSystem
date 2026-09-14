import { describe, expect, it } from 'vitest';
import type { SchemaFingerprint, SourceTableRow } from '../api';
import { noOpenEpochs, rawShortName } from './syncHealth';

const tables: SourceTableRow[] = [
  { sourceTableId: 1, kind: 'cone', sourceTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', isEnabled: true, dataSourceId: 1 },
  { sourceTableId: 2, kind: 'sack', sourceTable: 'sack1_TP1U2', rawTable: 'sms_raw.sack_raw', isEnabled: true, dataSourceId: 1 },
  { sourceTableId: 3, kind: 'reject_qcs', sourceTable: 'rejectQCS1_TP1U2', rawTable: 'sms_raw.reject_qcs_raw', isEnabled: true, dataSourceId: 1 },
];

const enforced = (table: string): SchemaFingerprint => ({
  table, fingerprint: 'abc', status: 'enforced-by-worker', epochId: 2, epochLabel: 'September rebuild',
});
const none = (table: string): SchemaFingerprint => ({
  table, fingerprint: null, status: 'no-open-epoch', epochId: null, epochLabel: null,
});

describe('rawShortName', () => {
  it('drops the schema, the way the worker names sync_run.target_table', () => {
    expect(rawShortName('sms_raw.cone_raw')).toBe('cone_raw');
    expect(rawShortName('cone_raw')).toBe('cone_raw');
  });
});

describe('noOpenEpochs', () => {
  it('places a halted source table on the sync row of the raw table it feeds', () => {
    const r = noOpenEpochs([enforced('pack1_TP1U2'), none('sack1_TP1U2')], tables, ['cone_raw', 'sack_raw']);
    expect([...r.byTarget]).toEqual([['sack_raw', 'sack1_TP1U2']]);
    expect(r.unplaced).toEqual([]);
  });

  it('says nothing for a table whose generation is enforced', () => {
    const r = noOpenEpochs([enforced('pack1_TP1U2'), enforced('sack1_TP1U2')], tables, ['cone_raw', 'sack_raw']);
    expect(r.byTarget.size).toBe(0);
    expect(r.unplaced).toEqual([]);
  });

  it('keeps a status it cannot place rather than dropping it', () => {
    // The sources list failed to load: nothing can be joined, so every
    // halted table is listed by name instead.
    expect(noOpenEpochs([none('pack1_TP1U2')], null, ['cone_raw']).unplaced).toEqual(['pack1_TP1U2']);
    // The mapping is known but the table has no sync row yet.
    expect(noOpenEpochs([none('rejectQCS1_TP1U2')], tables, ['cone_raw', 'sack_raw']).unplaced).toEqual(['rejectQCS1_TP1U2']);
    // A source table this line's configuration does not list at all.
    expect(noOpenEpochs([none('pack2_TP1U2')], tables, ['cone_raw']).unplaced).toEqual(['pack2_TP1U2']);
  });
});
