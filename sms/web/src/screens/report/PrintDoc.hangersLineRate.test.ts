/**
 * C-134 (D-93): with a station or product filter the hangers report's rate is
 * the filtered population's, so the tile must not be labelled "Line".
 */
import { describe, expect, it } from 'vitest';
import { summarise } from './PrintDoc';
import type { ReportResponse } from '../../api';

const wrap = (report: unknown) => ({ report } as unknown as ReportResponse<never>);
const base = { total: { total: 899, ratePct: 11.69 }, flagging: { lineRatePct: 11.69, canFlag: true, hangersSeen: 20, hangersJudged: 20, minInspected: 100, alpha: 0.05 }, hangers: [] };
const rateTile = (s: ReturnType<typeof summarise>) => s.tiles.find((t) => /reject rate/i.test(t.label));

describe('hangers report rate tile label', () => {
  it('station filter: names the station, not the line', () => {
    const s = summarise('rejected-hangers', wrap({ ...base, filters: { station: 14 } }));
    expect(s.tiles.map((t) => t.label)).not.toContain('Line reject rate');
    expect(rateTile(s)?.label).toBe('Reject rate, station 14 only');
  });
  it('product filter: names the product', () => {
    const s = summarise('rejected-hangers', wrap({ ...base, filters: { product: 1022 } }));
    expect(rateTile(s)?.label).toBe('Reject rate, product 1022 only');
  });
  it('no filter: unchanged', () => {
    expect(rateTile(summarise('rejected-hangers', wrap({ ...base, filters: {} })))?.label).toBe('Line reject rate');
  });
});
