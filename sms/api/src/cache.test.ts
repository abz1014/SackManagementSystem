/**
 * TtlCache (roadmap Phase 11, 14 Sep 2026): expired entries are swept on
 * every set, so a key written once and never read again — a replay instant,
 * a one-off window — cannot accumulate for the life of the process.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TtlCache } from './cache.js';

afterEach(() => vi.useRealTimers());

describe('TtlCache — sweep on set', () => {
  it('drops every expired entry when a new one is written', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const c = new TtlCache<number>(1000);
    for (let i = 0; i < 100; i++) c.set(`live:${i}`, i);
    expect(c.size).toBe(100);
    vi.setSystemTime(1500);
    c.set('live:new', 1);
    expect(c.size).toBe(1);
    expect(c.get('live:new')).toBe(1);
    expect(c.get('live:5')).toBeUndefined();
  });

  it('keeps entries that are still live', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const c = new TtlCache<number>(1000);
    c.set('a', 1);
    vi.setSystemTime(500);
    c.set('b', 2);
    expect(c.size).toBe(2);
    expect(c.get('a')).toBe(1);
  });
});
