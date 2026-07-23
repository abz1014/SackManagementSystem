import { describe, it, expect } from 'vitest';
import { buildSchemaSignature, computeFingerprint, type SchemaColumn } from './fingerprint.js';

const cols: SchemaColumn[] = [
  { name: 'id', dataType: 'int', numericPrecision: 10, numericScale: 0, charMaxLength: null },
  { name: 'Weight', dataType: 'decimal', numericPrecision: 6, numericScale: 2, charMaxLength: null },
  { name: 'Shift', dataType: 'varchar', numericPrecision: null, numericScale: null, charMaxLength: 8 },
  { name: 'Ignored', dataType: 'nvarchar', numericPrecision: null, numericScale: null, charMaxLength: 400 },
];

describe('schema fingerprint (Q7 drift guard)', () => {
  it('is order-independent and ignores non-depended columns', () => {
    const a = buildSchemaSignature(cols, ['id', 'Weight', 'Shift']);
    const b = buildSchemaSignature([...cols].reverse(), ['Shift', 'Weight', 'id']);
    expect(a).toBe(b);
    expect(a).not.toContain('ignored');
  });

  it('changes when a depended column type changes (decimal->float)', () => {
    const before = computeFingerprint(cols, ['id', 'Weight']);
    const mutated = cols.map((c) =>
      c.name === 'Weight'
        ? { ...c, dataType: 'float', numericPrecision: 53, numericScale: null }
        : c,
    );
    const after = computeFingerprint(mutated, ['id', 'Weight']);
    expect(after).not.toBe(before);
  });

  it('changes when a depended column disappears', () => {
    const full = computeFingerprint(cols, ['id', 'Weight', 'Shift']);
    const missing = computeFingerprint(
      cols.filter((c) => c.name !== 'Shift'),
      ['id', 'Weight', 'Shift'],
    );
    expect(missing).not.toBe(full);
  });
});
