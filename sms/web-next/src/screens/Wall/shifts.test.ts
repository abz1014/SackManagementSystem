import { describe, expect, it } from 'vitest';
import { inShiftOrder } from './shifts';

describe('inShiftOrder', () => {
  it('puts Morning, Evening, Night in that order', () => {
    const out = inShiftOrder([{ group: 'evening' }, { group: 'morning' }, { group: 'night' }]);
    expect(out.map((r) => r.group)).toEqual(['morning', 'evening', 'night']);
  });
  it('drops a total row and keeps unknown groups last', () => {
    expect(inShiftOrder([{ group: 'x' }, { group: 'total' }, { group: 'night' }]).map((r) => r.group)).toEqual(['night', 'x']);
  });
});
