import { describe, expect, it } from 'vitest';
import { distinctProductLabels, productLabel } from './productLabel';

describe('distinctProductLabels', () => {
  it('leaves a unique name alone', () => {
    const m = distinctProductLabels([{ productId: 1, description: 'A' }, { productId: 2, description: 'B' }]);
    expect([...m.values()]).toEqual(['A', 'B']);
  });
  it('appends the first part that makes colliding names distinct', () => {
    const m = distinctProductLabels([
      { productId: 20, description: '205-IL0-SD', color: 'PARROT' },
      { productId: 21, description: '205-IL0-SD', color: 'Khaki-2' },
    ]);
    expect(m.get(20)).toBe('205-IL0-SD · PARROT');
    expect(m.get(21)).toBe('205-IL0-SD · Khaki-2');
  });
  it('falls back to the PDAS id when nothing else differs', () => {
    const m = distinctProductLabels([
      { productId: 5, description: 'X', color: null },
      { productId: 6, description: 'X', color: null },
    ]);
    expect(m.get(5)).toBe('X · #5');
    expect(m.get(6)).toBe('X · #6');
  });
  it('productLabel prefers description, then lot code, then the id', () => {
    expect(productLabel({ productId: 9, description: null, lotCode: 'L9' })).toBe('L9');
    expect(productLabel({ productId: 9, description: null, lotCode: null })).toBe('Product 9');
  });
});
