/**
 * Roadmap Phase 11 follow-up (16 Sep 2026): the dependency-free .xlsx writer
 * gets its first caller (routes/reports.ts). This file pins the writer
 * itself — the zip container is well-formed and holds the OOXML parts a
 * spreadsheet application requires, and the small pure helpers (column
 * letters, sheet-name sanitising, the Excel serial date) behave as
 * documented in xlsx.ts. It does not touch routes/reports.ts — that route's
 * behaviour (headers, filename, audit verb, RBAC) is pinned in
 * routes/reports.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, columnLetter, excelSerial, sheetName, crc32, type Sheet } from './xlsx.js';

/**
 * A minimal zip reader for the shape `buildZip` writes: local file header +
 * deflated bytes, repeated once per entry, immediately followed by the
 * central directory (no data descriptors, no zip64 — see xlsx.ts). Reading
 * back only the local records is enough to prove the archive is valid and
 * to recover each part's name, inflated bytes and stored CRC-32, without a
 * new dependency (this file may only touch xlsx.test.ts as a new file).
 */
function readZipEntries(buf: Buffer): { name: string; data: Buffer; crc: number }[] {
  const entries: { name: string; data: Buffer; crc: number }[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const crc = buf.readUInt32LE(offset + 14);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const data = inflateRawSync(compressed);
    entries.push({ name, data, crc });
    offset = dataStart + compSize;
  }
  return entries;
}

const fixture: Sheet[] = [
  {
    name: 'Report',
    columns: [
      { header: 'Item', key: 'item', type: 'text' },
      { header: 'Value', key: 'value', type: 'text' },
    ],
    rows: [{ item: 'report', value: 'Fixture report' }],
    freeze: false,
  },
  {
    name: 'Daily',
    columns: [
      { header: 'Day', key: 'day', type: 'text' },
      { header: 'Cones', key: 'cones', type: 'integer' },
      { header: 'Reject %', key: 'reject_pct', type: 'percent' },
      { header: 'Generated', key: 'generated_utc', type: 'date' },
    ],
    rows: [
      { day: '2026-09-01', cones: 1234, reject_pct: 2.5, generated_utc: new Date('2026-09-01T06:00:00Z') },
      { day: '2026-09-02', cones: 987, reject_pct: 1.1, generated_utc: new Date('2026-09-02T06:00:00Z') },
    ],
  },
];

describe('buildXlsx', () => {
  it('returns a Buffer beginning with the zip local-file-header magic', () => {
    const buf = buildXlsx(fixture);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // PK\x03\x04
  });

  it('contains the OOXML parts a spreadsheet application requires', () => {
    const buf = buildXlsx(fixture);
    const entries = readZipEntries(buf);
    const names = entries.map((e) => e.name);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/worksheets/sheet2.xml');
    expect(names).toContain('_rels/.rels');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
    expect(names).toContain('xl/styles.xml');
  });

  it('every entry inflates to bytes matching its stored CRC-32', () => {
    const buf = buildXlsx(fixture);
    const entries = readZipEntries(buf);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(crc32(e.data), e.name).toBe(e.crc);
  });

  it('the workbook lists both sheet names, in order', () => {
    const buf = buildXlsx(fixture);
    const entries = readZipEntries(buf);
    const workbook = entries.find((e) => e.name === 'xl/workbook.xml')!.data.toString('utf8');
    expect(workbook).toContain('name="Report"');
    expect(workbook).toContain('name="Daily"');
    expect(workbook.indexOf('name="Report"')).toBeLessThan(workbook.indexOf('name="Daily"'));
  });

  it('sheet1.xml carries the header row and the body rows of the first sheet', () => {
    const buf = buildXlsx(fixture);
    const entries = readZipEntries(buf);
    const sheet1 = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')!.data.toString('utf8');
    expect(sheet1).toContain('Item');
    expect(sheet1).toContain('Fixture report');
  });

  it('rejects an empty workbook', () => {
    expect(() => buildXlsx([])).toThrow(/at least one sheet/);
  });
});

describe('columnLetter', () => {
  it('0-based index to spreadsheet column letters', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(701)).toBe('ZZ');
    expect(columnLetter(702)).toBe('AAA');
  });
});

describe('sheetName', () => {
  it('de-duplicates against names already taken, case-insensitively', () => {
    const taken = new Set<string>();
    expect(sheetName('Report', taken)).toBe('Report');
    expect(sheetName('Report', taken)).toBe('Report 2');
    // The base text is kept verbatim (only the dedup lookup is case-insensitive) —
    // a lowercase 'report' collides with 'Report'/'Report 2' and gets its own suffix.
    expect(sheetName('report', taken)).toBe('report 3');
  });

  it('truncates at 31 characters, still fitting the de-dup suffix', () => {
    const raw = 'A'.repeat(40);
    const taken = new Set<string>();
    const first = sheetName(raw, taken);
    expect(first.length).toBe(31);
    const second = sheetName(raw, taken);
    expect(second.length).toBeLessThanOrEqual(31);
    expect(second.endsWith(' 2')).toBe(true);
    expect(second).not.toBe(first);
  });

  it('strips characters Excel refuses in a sheet name', () => {
    const taken = new Set<string>();
    expect(sheetName('A/B:C*D?E[F]G\\H', taken)).toBe('A B C D E F G H');
  });
});

describe('excelSerial', () => {
  it('the Unix epoch is serial 25569 on the 1900 date system', () => {
    expect(excelSerial(new Date('1970-01-01T00:00:00Z'))).toBe(25_569);
  });

  it('a later known date matches the documented day count', () => {
    // 2026-09-16 UTC midnight: (days between 1899-12-30 and 2026-09-16).
    expect(excelSerial(new Date('2026-09-16T00:00:00Z'))).toBe(46_281);
  });

  it('carries the time of day as a fraction of the serial', () => {
    const midday = excelSerial(new Date('2026-09-16T12:00:00Z'));
    const midnight = excelSerial(new Date('2026-09-16T00:00:00Z'));
    expect(midday - midnight).toBeCloseTo(0.5, 10);
  });
});
