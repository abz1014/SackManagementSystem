import { describe, expect, it } from 'vitest';
import { shortProductLabel, stationProductText } from './stationProduct';

describe('stationProductText', () => {
  it('two stations on materials sharing a description read differently on a tile, full label in the tooltip', () => {
    const a = stationProductText({ product: '205-IL0-SD · Star Green · PVSD8020 · 30', productBasis: 'own' });
    const b = stationProductText({ product: '205-IL0-SD · Blue · PVSD8020 · 30', productBasis: 'own' });
    expect(a.short).toBe('205-IL0-SD · Star Green');
    expect(b.short).toBe('205-IL0-SD · Blue');
    expect(a.full).toBe('205-IL0-SD · Star Green · PVSD8020 · 30');
  });
  it('a plain unique code stays as it is', () => {
    expect(stationProductText({ product: '201-IH0-SD', productBasis: 'own' })).toEqual({ short: '201-IH0-SD', full: '201-IH0-SD' });
  });
  it('mixed says Several products', () => {
    expect(stationProductText({ product: null, productBasis: 'mixed' }).short).toBe('Several products');
  });
  it('a July (line) product is marked', () => {
    expect(stationProductText({ product: '201-IH0-SD', productBasis: 'line' }).short).toBe('201-IH0-SD (line product)');
  });
  it('no product', () => {
    expect(stationProductText({ product: null, productBasis: null }).short).toBe('No product');
  });

  describe('collisions among the products shown together', () => {
    const A = '205-IL0-SD · ORANGE · PVSD8020 · 30';
    const B = '205-IL0-SD · ORANGE · PVSD8020 · 20 Slub';
    const C = '205-IL0-SD · Blue · PVSD8020 · 30';
    it('products that would both read "code · colour" grow to the segment that tells them apart', () => {
      const shown = [A, B, C];
      expect(stationProductText({ product: A, productBasis: 'own' }, shown).short).toBe('205-IL0-SD · ORANGE · PVSD8020 · 30');
      expect(stationProductText({ product: B, productBasis: 'own' }, shown).short).toBe('205-IL0-SD · ORANGE · PVSD8020 · 20 Slub');
      expect(stationProductText({ product: A, productBasis: 'own' }, shown).full).toBe(A);
    });
    it('a product with no look-alike stays at code · colour', () => {
      expect(stationProductText({ product: C, productBasis: 'own' }, [A, B, C]).short).toBe('205-IL0-SD · Blue');
    });
    it('stops at the first distinguishing segment (count differs, not tube)', () => {
      const x = '205-IL0-SD · ORANGE · PVSD8020 · 30';
      const y = '205-IL0-SD · ORANGE · PVSD8030 · 30';
      expect(shortProductLabel(x, [x, y])).toBe('205-IL0-SD · ORANGE · PVSD8020');
      expect(shortProductLabel(y, [x, y])).toBe('205-IL0-SD · ORANGE · PVSD8030');
    });
    it('the same product on several stations is not a collision', () => {
      expect(shortProductLabel(A, [A, A, C])).toBe('205-IL0-SD · ORANGE');
    });
    it('null and mixed entries in the list are ignored; line basis keeps its mark', () => {
      expect(shortProductLabel(A, [null, A, undefined])).toBe('205-IL0-SD · ORANGE');
      expect(stationProductText({ product: A, productBasis: 'line' }, [A, B]).short).toBe('205-IL0-SD · ORANGE · PVSD8020 · 30 (line product)');
    });
  });
});
