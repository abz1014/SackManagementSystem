import { describe, expect, it } from 'vitest';
import type { MachineRunning } from '../../../bridge/api';
import { buildCards, buildChanges } from './model';

const m = (station: number, over: Partial<MachineRunning>): MachineRunning => ({ station, quiet: false, materialId: null, productName: null, ...over } as MachineRunning);

describe('Board change list (fix-wave P7)', () => {
  it('carries the same station name the card prints', () => {
    const cards = buildCards(
      [m(5, { stationName: 'East Conveyor', materialId: 21, productName: 'X', lastChange: { atUtc: '2026-09-01T10:00:00Z', fromMaterialId: null, fromProductName: null } as MachineRunning['lastChange'] })],
      new Map(),
      null,
    );
    expect(buildChanges(cards)[0]!.stationName).toBe(cards[0]!.stationName);
    expect(buildChanges(cards)[0]!.stationName).toBe('East Conveyor');
  });
});
