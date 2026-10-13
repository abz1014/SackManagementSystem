import { describe, expect, it } from 'vitest';
import type { Route } from '../../../route';
import {
  groupLabel, outsideLimitsHop, readChartType, readMode, readStation, resolveMode, signed1, stationSheetHop, stationsHop, withKeys,
} from './model';

const route: Route = {
  s: 'quality', t: 'weight', sheet: null, wall: false,
  keys: { p: 'pick', from: '2026-08-05', to: '2026-09-07', wm: 'dist', wt: 'sack', st: '4', rp: '3', at: '2026-09-01T10:00:00Z' },
};

describe('weight URL keys', () => {
  it('reads wm / wt / st defensively', () => {
    expect(readMode({ wm: 'dist' })).toBe('dist');
    expect(readMode({ wm: 'time' })).toBe('time');
    expect(readMode({ wm: 'x' })).toBeNull();
    expect(readChartType({ wt: 'sack' })).toBe('sack');
    expect(readChartType({ wt: 'cone' })).toBe('cone');
    expect(readChartType({})).toBe('cone');
    expect(readStation({ st: '4' })).toBe(4);
    expect(readStation({ st: '0' })).toBeNull();
    expect(readStation({ st: '2.5' })).toBeNull();
    expect(readStation({})).toBeNull();
  });
  it('the period-conditional default yields to an explicit wm', () => {
    expect(resolveMode(null, 1)).toBe('dist');
    expect(resolveMode(null, 34)).toBe('time');
    expect(resolveMode('time', 1)).toBe('time');
    expect(resolveMode('dist', 34)).toBe('dist');
  });
  it('withKeys sets and removes keys and leaves the rest', () => {
    const r = withKeys(route, { wt: null, wm: 'time' });
    expect(r.keys.wt).toBeUndefined();
    expect(r.keys.wm).toBe('time');
    expect(r.keys.p).toBe('pick');
  });
});

describe('hops carry state', () => {
  it('outside limits: register, cones, the filter, the period; not the chart keys or a stale page', () => {
    const h = outsideLimitsHop(route);
    expect(h.t).toBe('register');
    expect(h.keys).toMatchObject({ rf: 'outsideLimits', rl: 'cones', p: 'pick', from: '2026-08-05', at: '2026-09-01T10:00:00Z' });
    for (const k of ['wm', 'wt', 'st', 'rp']) expect(h.keys[k]).toBeUndefined();
  });
  it('stations: the station table with the same period', () => {
    const h = stationsHop(route);
    expect(h.t).toBe('stations');
    expect(h.keys.p).toBe('pick');
    expect(h.keys.wm).toBeUndefined();
  });
  it('a station sheet opens over the same screen', () => {
    const h = stationSheetHop(route, 7);
    expect(h.sheet).toEqual({ kind: 'station', id: '7' });
    expect(h.t).toBe('weight');
  });
});

describe('labels', () => {
  it('group labels', () => {
    expect(groupLabel('2026-08-05T06:30:00Z', false)).toBe('06:30');
    expect(groupLabel('2026-08-05T06:30:00Z', true)).toBe('5 Aug');
    expect(groupLabel('nope', true)).toBe('');
  });
  it('signed offsets use a true minus and no negative zero', () => {
    expect(signed1(-8.24)).toBe('\u22128.2');
    expect(signed1(1.94)).toBe('+1.9');
    expect(signed1(-0.04)).toBe('0.0');
  });
});
