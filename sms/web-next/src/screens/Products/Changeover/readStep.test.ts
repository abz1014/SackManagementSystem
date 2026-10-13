import { describe, expect, it } from 'vitest';
import { C, FRAGMENTS, withFragments } from '../../../copy';
import { readStep } from './model';

const CO = withFragments(C.changeover, FRAGMENTS.changeover);

describe('readStep (fix-wave D19)', () => {
  it('names mapped detail keys with the Plan labels and keeps the raw keys for the disclosure', () => {
    const r = readStep(
      { step: 'material', proc: 'CreateMaterial', detail: { setpointG: 1950, offsetMinusG: 40, offsetPlusG: 40, lot: '205-ILO-SD', packSchemaId: 1, ppColour: 'Blue', active: true } },
      CO.stepWords,
    );
    expect(r.kind).toBe(CO.productName);
    expect(r.pairs).toEqual([
      { label: CO.setpoint, value: '1950' },
      { label: CO.below, value: '40' },
      { label: CO.above, value: '40' },
      { label: CO.productName, value: '205-ILO-SD' },
    ]);
    const prose = JSON.stringify([r.kind, r.pairs]);
    for (const raw of ['CreateMaterial', 'setpointG', 'packSchemaId', 'ppColour']) expect(prose).not.toContain(raw);
    expect(r.technical.join(' ')).toContain('CreateMaterial');
    expect(r.technical.join(' ')).toContain('packSchemaId: 1');
    expect(r.technical.join(' ')).toContain('ppColour: Blue');
  });
  it('a pallet step has no kind word and a retire step has none either', () => {
    expect(readStep({ step: 'pallet', proc: 'CreatePallet', detail: { sackColour: 'Green', lot: null } }, CO.stepWords).kind).toBeNull();
    expect(readStep({ step: 'retire_material', proc: 'SetMaterialStatusActive', detail: {} }, CO.stepWords).kind).toBeNull();
  });
});
