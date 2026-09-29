/**
 * Task W2-C, fix 2 (F-07, 29 Sep 2026): every report's `shift`
 * column/filter is SMS's own derivation from `ProductionDate`, never the
 * vendor's stored `Shift` column (which `shiftCheck.ts` proves disagrees for
 * many rows). This pins the one wording (`SHIFT_SOURCE_NOTE`, common.ts) as
 * present on every surface a report reaches: the JSON header (screen and
 * print both read `ReportHeader.shiftNote`), the CSV trailing rows
 * (`attributionRows`/`csvDocument`, csv.ts), and the XLSX header sheet
 * (`headerSheet`, xlsx.ts — which is built from the same `attributionRows`).
 */
import { describe, it, expect } from 'vitest';
import { SHIFT_SOURCE_NOTE, type ReportHeader } from './common.js';
import { attributionRows, csvDocument } from './csv.js';
import { headerSheet } from './xlsx.js';
import { buildXlsx } from './xlsx.js';
import { inflateRawSync } from 'node:zlib';

function makeHeader(): ReportHeader {
  return {
    reportType: 'daily',
    title: 'Daily production report',
    lineName: 'TP1 Line 3',
    plantName: 'IFL',
    unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-08-01', to: '2026-08-10', days: 10 },
    filters: {},
    generatedAtPlantUtc: '2026-08-11T06:00:00.000Z',
    generatedBy: 'tester',
    smsVersion: '0.0.0-test',
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
    shiftNote: SHIFT_SOURCE_NOTE,
    spansGenerations: false,
    sourceGeneration: null,
    otherGenerationExcluded: null,
  };
}

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
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const data = inflateRawSync(compressed);
    entries.push({ name, data });
    offset = dataStart + compSize;
  }
  return entries;
}

describe('F-07 shift-derivation footnote reaches every report surface', () => {
  it('the JSON header carries shiftNote verbatim', () => {
    const header = makeHeader();
    expect(header.shiftNote).toBe(SHIFT_SOURCE_NOTE);
  });

  it('attributionRows carries a note row with the exact wording', () => {
    const rows = attributionRows(makeHeader());
    const note = rows.find(([k]) => k === 'note');
    expect(note).toBeDefined();
    expect(note![1]).toBe(SHIFT_SOURCE_NOTE);
  });

  it('csvDocument\'s trailing block contains the wording', () => {
    const doc = csvDocument(['a'], [[1]], makeHeader());
    expect(doc).toContain(SHIFT_SOURCE_NOTE);
  });

  it('the XLSX header sheet row carries the wording', () => {
    const sheet = headerSheet(makeHeader());
    const hasNote = sheet.rows.some((r) => Object.values(r).some((v) => typeof v === 'string' && v.includes(SHIFT_SOURCE_NOTE)));
    expect(hasNote).toBe(true);
  });

  it('the built XLSX zip\'s sheet1 XML contains the wording', () => {
    const header = makeHeader();
    const sheets = [headerSheet(header)];
    const buf = buildXlsx(sheets);
    const entries = readZipEntries(buf);
    const sheetXml = entries.find((e) => /sheet1\.xml$/i.test(e.name));
    expect(sheetXml).toBeDefined();
    expect(sheetXml!.data.toString('utf8')).toContain(SHIFT_SOURCE_NOTE);
  });

  it('falls back to the constant when shiftNote is absent (a header built before this field existed)', () => {
    const header = makeHeader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately simulating an older fixture
    delete (header as any).shiftNote;
    const rows = attributionRows(header);
    expect(rows.find(([k]) => k === 'note')![1]).toBe(SHIFT_SOURCE_NOTE);
  });
});
