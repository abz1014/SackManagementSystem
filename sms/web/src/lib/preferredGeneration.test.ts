import { describe, expect, it } from 'vitest';
import type { RejectGeneration, RejectSpcData } from '../api';
import { preferredGeneration } from './preferredGeneration';

const gen = (generation: number, totalProduced: number, totalRejects: number): RejectGeneration =>
  ({ generation, totalProduced, totalRejects, totalInspected: totalProduced + 5, pBar: 0.01, firstBucketTs: '', lastBucketTs: '' }) as RejectGeneration;
const spc = (totalProduced: number, totalRejects: number, generations: RejectGeneration[]) =>
  ({ totalProduced, totalRejects, generations }) as unknown as RejectSpcData;

describe('preferredGeneration', () => {
  it('is null for no data and for no generations', () => {
    expect(preferredGeneration(null)).toBeNull();
    expect(preferredGeneration(spc(0, 0, []))).toBeNull();
  });
  it('is the only generation when there is one', () => {
    const g = gen(3, 100, 4);
    expect(preferredGeneration(spc(100, 4, [g]))).toBe(g);
  });
  it('picks the entry whose totals equal the top-level pair', () => {
    const a = gen(2, 500, 20);
    const b = gen(3, 100, 4);
    expect(preferredGeneration(spc(100, 4, [a, b]))).toBe(b);
  });
  it('is null when several generations and none matches', () => {
    expect(preferredGeneration(spc(1, 1, [gen(2, 500, 20), gen(3, 100, 4)]))).toBeNull();
  });
});
