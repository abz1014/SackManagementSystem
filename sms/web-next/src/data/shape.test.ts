import { describe, expect, it } from 'vitest';
import { assertShape, missingField } from './shape';
import { SHAPE } from './shapes';

describe('missingField', () => {
  it('finds a hole at any depth, through arrays, and treats an explicit null as present', () => {
    const body = { data: { thresholds: { act: 2 }, stations: [{ cones: 1 }, { cones: 0 }], mean: null } };
    expect(missingField(body, SHAPE.stationStatus)).toBeNull();
    expect(missingField({ data: { stations: [{ cones: 1 }, {}] , thresholds: {} } }, SHAPE.stationStatus)).toBe('data.stations[].cones');
    expect(missingField({ data: { stations: [] } }, SHAPE.stationStatus)).toBe('data.thresholds');
    expect(missingField({ data: { mean: null } }, ['data.mean'])).toBeNull();
    expect(missingField({ data: {} }, ['data.mean'])).toBe('data.mean');
    expect(missingField({}, ['data.rows[]'])).toBe('data');
    expect(missingField({ data: { rows: 'x' } }, ['data.rows[]'])).toBe('data.rows');
  });

  it('assertShape names the part and the field in plain words, and returns a complete body untouched', () => {
    const ok = { data: { machines: [] } };
    expect(assertShape(ok, SHAPE.machinesRunning, 'machines running')).toBe(ok);
    expect(() => assertShape({ data: {} }, SHAPE.machinesRunning, 'machines running')).toThrow(/machines running answer arrived incomplete \(no "data\.machines"\)/);
  });
});
