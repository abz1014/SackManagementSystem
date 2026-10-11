/**
 * S3 F-2 (Stage 3, 11 Oct 2026): product changes in the notes of the product, daily, shift and shift-production reports.
 *
 * User impact: only the machine-product report said when a winder changed product; the other reports a manager prints
 * (daily, shift, product, IFL's shift production) never mentioned it. The notes travel to the CSV, the workbook and the
 * printed page, so the sentences are tested through `reportNotesOf` (the one function all three read). Pure; no database.
 * Values are synthetic copies of the real changes on sms_audit (S/stage3plan/out/f2_changes.txt).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { reportNotesOf } from './notes.js';
import {
  NO_PRODUCT_CHANGE_NOTE, PRODUCT_CHANGES_UNREAD_NOTE, PRODUCT_CHANGE_TIME_NOTE, productChangeLines, readProductChanges,
} from './productChanges.js';
import type { MachineProductChange } from '../machineProducts.js';

vi.mock('../machineProducts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../machineProducts.js')>();
  return { ...actual, getMachineProductShifts: vi.fn() };
});
import { getMachineProductShifts } from '../machineProducts.js';

const change = (over: Partial<MachineProductChange>): MachineProductChange => ({
  station: 13, machineName: null, day: '2026-09-07', shift: 'morning',
  fromMaterialId: 1022, fromProductName: '205-IL0-SD', toMaterialId: 20, toProductName: '205-IL0-SD',
  firstUtc: '2026-09-07T10:37:10.310Z', kind: 'between_shifts', fromBeforePeriod: true, ...over,
});
const LABELS = { '1022': '205-IL0-SD #1022', '20': '205-IL0-SD #20', '21': '205-IL0-SD #21', '1021': '205-IL0-SD #1021' };

describe('product changes in the notes', () => {
  it('daily, shift, product and shift-production each state the time rule and one sentence per change', () => {
    const d = { productChanges: [change({})], productChangeLabels: LABELS };
    for (const type of ['daily', 'shift', 'product', 'shift-production'] as const) {
      const notes = reportNotesOf(type, d);
      expect(notes, type).toContain(PRODUCT_CHANGE_TIME_NOTE);
      expect(notes, type).toContain('Winder 13: 205-IL0-SD #1022 to 205-IL0-SD #20, first cone of the new product 10:37, 7 Sep 2026.');
    }
  });

  it('lists several changes in time order, each once', () => {
    const d = {
      productChanges: [
        change({ station: 4, fromMaterialId: 21, toMaterialId: 1021, firstUtc: '2026-08-11T20:03:28.827Z' }),
        change({ station: 3, fromMaterialId: 21, toMaterialId: 1021, firstUtc: '2026-08-11T17:20:14.290Z' }),
      ],
      productChangeLabels: LABELS,
    };
    const lines = reportNotesOf('daily', d).filter((n) => n.startsWith('Winder '));
    expect(lines).toEqual([
      'Winder 3: 205-IL0-SD #21 to 205-IL0-SD #1021, first cone of the new product 17:20, 11 Aug 2026.',
      'Winder 4: 205-IL0-SD #21 to 205-IL0-SD #1021, first cone of the new product 20:03, 11 Aug 2026.',
    ]);
  });

  it('says plainly when there was none, and when they could not be read; says nothing for a payload that predates the field', () => {
    expect(reportNotesOf('daily', { productChanges: [], productChangeLabels: {} })).toContain(NO_PRODUCT_CHANGE_NOTE);
    expect(reportNotesOf('daily', { productChanges: null })).toContain(PRODUCT_CHANGES_UNREAD_NOTE);
    const old = reportNotesOf('daily', { rejectPopulations: { note: 'x' } });
    expect(old.join(' ')).not.toContain('product change');
    expect(old.join(' ')).not.toContain('first cone of the new product');
  });

  it('machine-product keeps its changes as rows and adds only the time note, so nothing prints twice', () => {
    const notes = reportNotesOf('machine-product', { note: 'm', changes: [change({})], productChanges: [change({})], productChangeLabels: LABELS });
    expect(notes).toContain(PRODUCT_CHANGE_TIME_NOTE);
    expect(notes.some((n) => n.startsWith('Winder '))).toBe(false);
  });

  it('a type that is not about products (station, reject lists, sacks) gets none of it', () => {
    const d = { note: 'n', productChanges: [change({})], productChangeLabels: LABELS };
    for (const type of ['station', 'cone-weight', 'calibration', 'rejected-cones', 'sack'] as const) {
      expect(reportNotesOf(type, d).join(' '), type).not.toContain('first cone of the new product');
    }
  });

  it('productChangeLines names a side with no product plainly', () => {
    const [line] = productChangeLines([change({ fromMaterialId: null })], (id) => (id == null ? 'No product on the reading' : `P${id}`));
    expect(line).toBe('Winder 13: No product on the reading to P20, first cone of the new product 10:37, 7 Sep 2026.');
  });
});

describe('readProductChanges', () => {
  const resolved = { period: 'custom', from: '2026-09-07', to: '2026-09-07' } as never;
  it('passes the report\'s own period, shift and winder to the one derivation and labels both sides of each change', async () => {
    vi.mocked(getMachineProductShifts).mockResolvedValue({
      from: '2026-09-07', to: '2026-09-07', shift: null, stations: [], cells: [], conesWithoutStation: 0, changes: [change({})],
    });
    const r = await readProductChanges({} as ConnectionPool, 1, resolved, { shift: 'morning', station: 13 });
    expect(vi.mocked(getMachineProductShifts).mock.calls.at(-1)![2]).toMatchObject({ from: '2026-09-07', to: '2026-09-07', shift: 'morning', station: 13 });
    expect(r.productChanges).toHaveLength(1);
    expect(r.productChangeLabels).toEqual({ '1022': '205-IL0-SD #1022', '20': '205-IL0-SD #20' }); // one name on two products, so the id is added
  });
  it('a failed read is null (could not be read), never an empty list', async () => {
    vi.mocked(getMachineProductShifts).mockRejectedValue(new Error('boom'));
    const r = await readProductChanges({} as ConnectionPool, 1, resolved, {});
    expect(r.productChanges).toBeNull();
  });
});
