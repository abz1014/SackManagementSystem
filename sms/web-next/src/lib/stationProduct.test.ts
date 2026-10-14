import { describe, expect, it } from 'vitest';
import { stationProductText } from './stationProduct';

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
});
