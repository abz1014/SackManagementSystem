/**
 * D-74: a column whose header reads "(plant time)" must hold plant time. App-written instants (`adjusted_at_utc`,
 * `last_adjusted_utc`) are genuine UTC (TWO CLOCKS, plantClock.ts) and are converted; production timestamps are already
 * the plant wall clock labelled UTC and are written as they are.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, excelSerial, sheetsFromCsv } from './xlsx.js';
import type { ReportHeader } from './common.js';

function readZipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  const entries: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    entries.push({ name, data: inflateRawSync(buf.subarray(dataStart, dataStart + compSize)) });
    offset = dataStart + compSize;
  }
  return entries;
}

const HEADER = {
  title: 'Calibration report', lineName: 'TP1 Line 3', plantName: null, unitName: null,
  period: { from: '2026-08-05', to: '2026-09-07' }, periodLabel: '2026-08-05 to 2026-09-07', filters: {},
  generatedAtPlantUtc: '2026-09-08T10:00:00.000Z', smsVersion: '1.0',
} as unknown as ReportHeader;

describe('xlsx clocks — "(plant time)" columns hold plant time', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Karachi'; // the plant: UTC+5
  });

  it('converts a genuine-UTC instant to the plant clock and leaves a production timestamp alone', () => {
    const table = {
      headers: ['section', 'adjusted_at_utc', 'last_adjusted_utc', 'first_utc'],
      rows: [['adjustment', '2026-09-03T11:56:07.499Z', '2026-09-03T11:56:07.499Z', '2026-09-03T11:56:07.499Z']],
    };
    const sheets = sheetsFromCsv(table, 'Adjustment', HEADER);
    const cols = sheets[0]!.columns.map((c) => c.header);
    expect(cols).toEqual(['Adjusted at (plant time)', 'Last adjusted (plant time)', 'First (plant time)']);
    const xml = readZipEntries(buildXlsx(sheets))
      .find((e) => e.name === 'xl/worksheets/sheet1.xml')!.data.toString('utf8');
    const plant = excelSerial(new Date("2026-09-03T16:56:07.000Z")) /* the reader keeps whole seconds */;
    const asIs = excelSerial(new Date("2026-09-03T11:56:07.000Z"));
    const vs = [...xml.matchAll(/<v>([^<]+)<\/v>/g)].map((m) => Number(m[1]));
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    // adjusted_at_utc and last_adjusted_utc: converted. first_utc (a production timestamp): as is.
    expect(vs.filter((v) => near(v, plant))).toHaveLength(2);
    expect(vs.filter((v) => near(v, asIs))).toHaveLength(1);
  });
});
