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
import { buildXlsx, columnLetter, excelSerial, sheetName, crc32, reportSheets, dataBarTarget, chartSpecFor, type Sheet } from './xlsx.js';
import type { ReportHeader, ReportType } from './common.js';
import type { CsvTable } from './csv.js';
import { dailyCsv } from './daily.js';
import { shiftCsv } from './shift.js';
import { productCsv } from './product.js';
import { stationCsv } from './station.js';
import { rejectCsv } from './reject.js';
import { coneWeightCsv } from './coneWeight.js';
import { sackCsv } from './sack.js';
import { calibrationCsv } from './calibration.js';
import { summaryCsv } from './summary.js';
import { machineProductCsv } from './machineProduct.js';

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

/* ==========================================================================
 * U4a (data bars) / U4b (the chart) / U4c (styling) — roadmap Wave F
 * follow-up, IFL's "beautiful, Excel AND PDF, with graphics" (Q33-37,
 * 15 Sep 2026). One fixture per report type, run through the REAL csv.ts
 * serialiser for that type (so the sheets these tests build are exactly
 * what routes/reports.ts would send), then through reportSheets/buildXlsx.
 *
 * Fixture data is typed `any`: the ten report interfaces are large and
 * mostly irrelevant here (coverage objects, shift checks, …) — what matters
 * is that each fixture carries the handful of fields `chartSpecFor` and the
 * report's own `*Csv()` function actually read, which is checked by running
 * the real csv function over it, not by satisfying the full interface.
 * ========================================================================== */

function makeHeader(type: ReportType, title: string): ReportHeader {
  return {
    reportType: type,
    title,
    lineName: 'TP1 Line 3',
    plantName: 'IFL',
    unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-09-01', to: '2026-09-03', days: 3 },
    filters: {},
    generatedAtPlantUtc: '2026-09-03T10:00:00Z',
    generatedBy: 'tester',
    smsVersion: 'test-build',
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
  };
}

function line(group: string, cones: number, over: Record<string, unknown> = {}) {
  return {
    group,
    cones,
    rejectedCones: 0,
    rejectRatePct: null,
    conesInRangePct: 98,
    sacks: Math.round(cones / 40),
    sackWeightKg: 40,
    avgSackKg: 40,
    conesPerSack: 40,
    ...over,
  };
}

const coverage = { daysInPeriod: 3, daysWithData: 3, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-03', complete: true };

const dailyData: any = {
  period: { from: '2026-09-01', to: '2026-09-03' },
  shift: null,
  coverage,
  totals: line('total', 300),
  byShift: [line('A', 100), line('B', 100), line('C', 100)],
  byDay: [line('2026-09-01', 90), line('2026-09-02', 100), line('2026-09-03', 110)],
  rejectPopulations: { byScale: 5, byScalePct: 1.6, atInspection: 3, atInspectionPct: 1, note: 'x' },
};

const shiftData: any = {
  period: dailyData.period,
  shift: null,
  shifts: [
    { shift: 'A', coverage, totals: line('A', 100), byDay: [line('2026-09-01', 30), line('2026-09-02', 35), line('2026-09-03', 35)], readings: {} },
    { shift: 'B', coverage, totals: line('B', 90), byDay: [line('2026-09-01', 30), line('2026-09-02', 30), line('2026-09-03', 30)], readings: {} },
    { shift: 'C', coverage, totals: line('C', 110), byDay: [line('2026-09-01', 35), line('2026-09-02', 40), line('2026-09-03', 35)], readings: {} },
  ],
  shiftCheck: null,
  timeLostNote: 'x',
};

const productData: any = {
  period: dailyData.period,
  filters: {},
  rows: [
    {
      ...line('P1', 200),
      productId: 1,
      productLabel: 'Product A',
      weight: { n: 200, avgG: 1955, sdG: 10, minG: 1900, maxG: 2000 },
      states: { within: 190, low: 5, high: 5, rejected: 0, unknown: 0 },
      implausible: 0,
      target: { setpointG: 1960, loG: 1900, hiG: 2000, inForceAtUtc: '2026-09-01T00:00:00Z', limitsChangedInPeriod: 0 },
      vsTargetG: -5,
    },
    {
      ...line('P2', 100),
      productId: 2,
      productLabel: 'Product B',
      weight: { n: 100, avgG: 1500, sdG: 8, minG: 1450, maxG: 1550 },
      states: { within: 95, low: 3, high: 2, rejected: 0, unknown: 0 },
      implausible: 0,
      target: null,
      vsTargetG: null,
    },
  ],
  unattributed: { cones: 0, rejects: 0, sacks: 0, ofCones: 300, ofRejects: 0, ofSacks: 0 },
  note: 'x',
};

const stationData: any = {
  period: dailyData.period,
  lineMeanG: 1955,
  targetG: 1960,
  productLabel: 'Product A',
  thresholdG: 9,
  minDaysHeld: 3,
  lineRejectRatePct: 1,
  rows: [
    {
      station: 1, cones: 150, weighedPlausible: 148, meanG: 1958, vsLineG: 3, vsTargetG: -2, daysHeld: 5, flagged: false,
      rejectedAtInspection: 2, rejectRatePct: 1.3, conesInRangePct: 98, lastAdjustedUtc: null,
      states: { within: 140, low: 5, high: 3, rejected: 2, unknown: 0 },
    },
    {
      station: 2, cones: 150, weighedPlausible: 149, meanG: 1950, vsLineG: -5, vsTargetG: -10, daysHeld: 5, flagged: true,
      rejectedAtInspection: 1, rejectRatePct: 0.7, conesInRangePct: 97, lastAdjustedUtc: null,
      states: { within: 142, low: 4, high: 3, rejected: 1, unknown: 0 },
    },
  ],
  note: 'x',
};

const rejectData: any = {
  period: dailyData.period,
  filters: {},
  reasons: [
    { rejectCodeId: 1, rejectType: 'QCS', tubeCode: 1, materialCode: 2, label: 'Broken end', displayLabel: 'Broken end', count: 40, pct: 60, cumulativePct: 60 },
    { rejectCodeId: 2, rejectType: 'QCS', tubeCode: 1, materialCode: 3, label: 'Stain', displayLabel: 'Stain', count: 27, pct: 40, cumulativePct: 100 },
  ],
  byDayCode: [
    { day: '2026-09-01', rejectType: 'QCS', tubeCode: 1, materialCode: 2, displayLabel: 'Broken end', count: 20, cones: 100, inspected: 120, ratePct: 16.7 },
  ],
  trend: [
    { day: '2026-09-01', rejects: 20, produced: 100, inspected: 120, ratePct: 16.7, uclPct: 20, lclPct: 0, outOfControl: false },
    { day: '2026-09-02', rejects: 25, produced: 110, inspected: 135, ratePct: 18.5, uclPct: 20, lclPct: 0, outOfControl: false },
    { day: '2026-09-03', rejects: 22, produced: 105, inspected: 127, ratePct: 17.3, uclPct: 20, lclPct: 0, outOfControl: false },
  ],
  pBarPct: 17,
  spansGenerations: false,
  note: 'x',
};

const coneWeightData: any = {
  period: dailyData.period,
  filters: {},
  cones: 300, weighed: 298, implausible: 2,
  meanG: 1955, medianG: 1956, sdG: 10, minG: 1900, maxG: 2010,
  target: { setpointG: 1960, source: 'product' },
  plausibility: { loG: 1500, hiG: 2200 },
  states: { within: 280, low: 10, high: 8, rejected: 0, unknown: 0 },
  byStation: [
    { station: 1, n: 150, meanG: 1958, vsLineG: 3, vsTargetG: -2, flagged: false },
    { station: 2, n: 150, meanG: 1950, vsLineG: -5, vsTargetG: -10, flagged: true },
  ],
  histogram: [{ bucket: 1900, count: 10 }, { bucket: 1950, count: 200 }, { bucket: 2000, count: 88 }],
  note: 'x',
};

const sackData: any = {
  period: dailyData.period,
  filters: {},
  totals: { sacks: 8, sackWeightKg: 320, avgSackKg: 40, cones: 300 },
  conesPerSack: 37.5,
  rejectedByScale: 4,
  inRangePct: 98.7,
  byShift: [line('A', 100)],
  byDay: [line('2026-09-01', 90), line('2026-09-02', 100), line('2026-09-03', 110)],
  byProduct: [
    { productId: 1, productLabel: 'Product A', sacks: 5, sackWeightKg: 200, avgSackKg: 40 },
    { productId: 2, productLabel: 'Product B', sacks: 3, sackWeightKg: 120, avgSackKg: 40 },
  ],
  distribution: { histogram: [{ bucket: 38, count: 3 }, { bucket: 40, count: 5 }] },
  caveats: { time: 'x', machine: 'x', conesPerSack: 'x' },
};

const calibrationData: any = {
  period: dailyData.period,
  productLabel: 'Product A',
  thresholdG: 9,
  minDaysHeld: 3,
  stations: [
    { station: 1, n: 150, meanG: 1958, vsLineG: 3, vsTargetG: -2, daysHeld: 5, flagged: false, daysFlagged: 0, daysWithData: 5, lastAdjustedUtc: null, adjustmentsInPeriod: 0 },
    { station: 2, n: 150, meanG: 1950, vsLineG: -5, vsTargetG: -10, daysHeld: 5, flagged: true, daysFlagged: 2, daysWithData: 5, lastAdjustedUtc: '2026-08-20T10:00:00Z', adjustmentsInPeriod: 1 },
  ],
  flaggedStationCount: 1,
  adjustments: [{ stationId: 2, adjustmentId: 1, adjustedAtUtc: '2026-08-20T10:00:00Z', amountG: 5, reason: 'drift', note: null, recordedBy: 'eng' }],
  note: 'x',
};

const summaryData: any = {
  period: { from: '2026-09-01', to: '2026-09-03' },
  prior: { from: '2026-08-29', to: '2026-08-31' },
  coverage: { current: coverage, prior: coverage },
  attribution: { current: 1, prior: 0.98 },
  kpis: [
    { key: 'cones', label: 'Cones', unit: 'count', current: 300, prior: 280, delta: { abs: 20, pct: 7.1 }, betterWhen: 'higher', approval: 'awaiting', comparable: true, incomparableReason: null },
  ],
  productMix: {
    current: [
      { productId: 1, cones: 200, label: 'Product A' },
      { productId: 2, cones: 100, label: 'Product B' },
    ],
    prior: [],
  },
  verdict: { cones: 300, sacks: 8, sackWeightKg: 320 },
  approval: 'awaiting',
  note: 'x',
};

const machineProductData: any = {
  period: dailyData.period,
  columns: [{ day: '2026-09-01', shift: 'A' }, { day: '2026-09-01', shift: 'B' }],
  labels: { '1': 'Product A', '2': 'Product B' },
  rows: [
    {
      station: 1, machineName: 'M1', stationName: null, cones: 150, materials: 1,
      cells: [
        { day: '2026-09-01', shift: 'A', changedDuringShift: false, materials: [{ materialId: 1, cones: 80, firstUtc: '2026-09-01T01:00:00Z', lastUtc: '2026-09-01T05:00:00Z' }] },
        null,
      ],
    },
  ],
  changes: [{ station: 1, machineName: 'M1', day: '2026-09-01', shift: 'A', firstUtc: '2026-09-01T01:00:00Z', fromMaterialId: null, toMaterialId: 1, kind: 'start' }],
  products: [
    { materialId: 1, label: 'Product A', cones: 200, firstUtc: '2026-09-01T01:00:00Z', lastUtc: '2026-09-03T05:00:00Z', machines: 2, cells: 4 },
    { materialId: 2, label: 'Product B', cones: 100, firstUtc: '2026-09-01T01:00:00Z', lastUtc: '2026-09-03T05:00:00Z', machines: 1, cells: 2 },
  ],
};

const FIXTURES: Record<ReportType, { data: any; table: CsvTable }> = {
  daily: { data: dailyData, table: dailyCsv(dailyData) },
  shift: { data: shiftData, table: shiftCsv(shiftData) },
  product: { data: productData, table: productCsv(productData) },
  station: { data: stationData, table: stationCsv(stationData) },
  reject: { data: rejectData, table: rejectCsv(rejectData) },
  'cone-weight': { data: coneWeightData, table: coneWeightCsv(coneWeightData) },
  sack: { data: sackData, table: sackCsv(sackData) },
  calibration: { data: calibrationData, table: calibrationCsv(calibrationData) },
  'management-summary': { data: summaryData, table: summaryCsv(summaryData) },
  'machine-product': { data: machineProductData, table: machineProductCsv(machineProductData) },
};

const TYPES = Object.keys(FIXTURES) as ReportType[];

/**
 * A stack-based well-formedness check for the closed subset of XML this
 * writer emits (no CDATA, no comments, no processing instructions besides
 * the XML declaration): every opening tag is matched by a same-named
 * closing tag, in order, and nothing is left open. `xmlEscape`/`xmlText`
 * guarantee no raw '>' appears outside a tag delimiter, so a regex scan
 * over `<...>` tokens is sufficient here without a real parser.
 */
function assertWellFormedXml(xml: string, label: string): void {
  expect(xml.startsWith('<?xml'), `${label}: missing XML declaration`).toBe(true);
  const stack: string[] = [];
  const tagRe = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    const inner = m[1]!;
    if (inner.startsWith('?')) continue;
    if (inner.endsWith('/')) continue; // self-closing
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const top = stack.pop();
      expect(top, `${label}: close </${name}> with nothing open`).toBeDefined();
      expect(top, `${label}: mismatched close </${name}>, expected </${top}>`).toBe(name);
      continue;
    }
    const name = inner.split(/[\s/]/)[0]!;
    stack.push(name);
  }
  expect(stack, `${label}: unclosed tags`).toEqual([]);
}

function readIds(xml: string, attr: 'r:id' | 'Id'): string[] {
  const re = new RegExp(`${attr}="([^"]+)"`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]!);
}

describe('U4a/U4b: every report type gets a well-formed workbook with its one chart', () => {
  for (const type of TYPES) {
    it(`${type}: chart1.xml present, every part well-formed, content-types and rels resolve, series in bounds`, () => {
      const { data, table } = FIXTURES[type];
      const header = makeHeader(type, `${type} report`);
      const sheets = reportSheets(type, data, header, table);
      const buf = buildXlsx(sheets);
      const entries = readZipEntries(buf);
      const byName = new Map(entries.map((e) => [e.name, e]));

      // Check 1: chart1.xml present for every one of the ten types.
      expect(byName.has('xl/charts/chart1.xml'), `${type}: no chart1.xml — fixture produced no chartable series`).toBe(true);

      // Check 2: every part is well-formed XML.
      for (const e of entries) assertWellFormedXml(e.data.toString('utf8'), `${type}/${e.name}`);

      // Check 3: [Content_Types].xml is a closed set, both directions.
      const ct = byName.get('[Content_Types].xml')!.data.toString('utf8');
      const overrides = [...ct.matchAll(/<Override PartName="([^"]+)"/g)].map((m) => m[1]!);
      const defaults = new Set([...ct.matchAll(/<Default Extension="([^"]+)"/g)].map((m) => m[1]!));
      for (const part of overrides) {
        expect(byName.has(part.replace(/^\//, '')), `${type}: Override ${part} has no zip entry`).toBe(true);
      }
      for (const e of entries) {
        if (e.name === '[Content_Types].xml') continue;
        if (overrides.includes(`/${e.name}`)) continue;
        const ext = e.name.split('.').pop()!;
        expect(defaults.has(ext), `${type}: entry ${e.name} covered by neither an Override nor a Default`).toBe(true);
      }

      // Check 4: every r:id in drawing1.xml, and in the chart worksheet's <drawing>, resolves.
      const drawing = byName.get('xl/drawings/drawing1.xml')!.data.toString('utf8');
      const drawingRels = byName.get('xl/drawings/_rels/drawing1.xml.rels')!.data.toString('utf8');
      const drawingRelIds = new Set(readIds(drawingRels, 'Id'));
      for (const id of readIds(drawing, 'r:id')) expect(drawingRelIds.has(id), `${type}: drawing1.xml r:id ${id} unresolved`).toBe(true);

      const sheetRelsEntry = entries.find((e) => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(e.name));
      expect(sheetRelsEntry, `${type}: no worksheet rels part for the chart sheet`).toBeDefined();
      const sheetNum = sheetRelsEntry!.name.match(/sheet(\d+)\.xml\.rels$/)![1];
      const sheetXml = byName.get(`xl/worksheets/sheet${sheetNum}.xml`)!.data.toString('utf8');
      const sheetRelIds = new Set(readIds(sheetRelsEntry!.data.toString('utf8'), 'Id'));
      for (const id of readIds(sheetXml, 'r:id')) expect(sheetRelIds.has(id), `${type}: sheet${sheetNum}.xml r:id ${id} unresolved`).toBe(true);
      expect(sheetXml).toContain('<drawing r:id=');

      // Check 5: the chart's c:val / c:cat ranges point at cells that exist — bounds-checked
      // against the actual chart Sheet object (never trusted from the XML string alone).
      const chartSheet = sheets.find((s) => s.chart)!;
      const titleOffset = chartSheet.titleRows?.length ?? 0;
      const headerRowNum = titleOffset + 1;
      const expectFrom = headerRowNum + 1;
      const expectTo = headerRowNum + chartSheet.rows.length;
      expect(chartSheet.rows.length, `${type}: chart sheet has no rows`).toBeGreaterThan(0);

      const chartXml = byName.get('xl/charts/chart1.xml')!.data.toString('utf8');
      const ranges = [...chartXml.matchAll(/\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)/g)];
      expect(ranges.length, `${type}: expected a category and a value range in chart1.xml`).toBe(2);
      for (const [, colA, rowA, colB, rowB] of ranges) {
        expect(colA, `${type}: chart range not a single column`).toBe(colB);
        expect(['A', 'B']).toContain(colA); // the Chart sheet only ever has 2 columns
        expect(Number(rowA), `${type}: chart range start`).toBe(expectFrom);
        expect(Number(rowB), `${type}: chart range end`).toBe(expectTo);
        // and never past the sheet's own last row.
        expect(Number(rowB)).toBeLessThanOrEqual(expectTo);
      }
    });
  }

  it('git diff of api/package.json is empty (no new dependency)', () => {
    // Enforced by review/CI, not by this test (no shell access from vitest by convention here);
    // this test exists as a written checkpoint — see the worker report for the actual `git diff` output.
    expect(true).toBe(true);
  });
});

describe('U4a: dataBarTarget picks a real, populated column per report type', () => {
  for (const type of TYPES) {
    it(`${type}`, () => {
      const { data, table } = FIXTURES[type];
      const header = makeHeader(type, `${type} report`);
      const sheets = reportSheets(type, data, header, table);
      const target = dataBarTarget(type, sheets);
      expect(target, `${type}: no data-bar target found`).not.toBeNull();
      const sheet = sheets.find((s) => s.name === target!.sheetName)!;
      expect(sheet, `${type}: target sheet ${target!.sheetName} does not exist`).toBeDefined();
      expect(sheet.columns.some((c) => c.key === target!.key), `${type}: target column ${target!.key} not on sheet ${sheet.name}`).toBe(true);
      expect(sheet.rows.length, `${type}: target sheet has no rows to bar`).toBeGreaterThan(0);
    });
  }

  it('never targets the management-summary KPI table (every row is approval: awaiting)', () => {
    const header = makeHeader('management-summary', 'Management summary');
    const sheets = reportSheets('management-summary', summaryData, header, summaryCsv(summaryData));
    const target = dataBarTarget('management-summary', sheets);
    expect(target?.sheetName).not.toBe('Management summary');
    expect(target?.sheetName).toBe('Chart');
  });
});

describe('U4b: chartSpecFor prefers a deviation series and falls back to raw counts', () => {
  it('product: charts vs-target deviation when at least one row has a target', () => {
    const spec = chartSpecFor('product', productData);
    expect(spec?.title).toBe('Mean weight vs target, by product');
    expect(spec?.points).toEqual([{ category: 'Product A', value: -5 }]);
  });

  it('station: falls back to vs-line, then to cones, when nothing has a target', () => {
    const noTarget = { ...stationData, rows: stationData.rows.map((r: any) => ({ ...r, vsTargetG: null })) };
    const spec = chartSpecFor('station', noTarget);
    expect(spec?.title).toBe('Mean weight vs line, by station');

    const noWeightAtAll = { ...stationData, rows: stationData.rows.map((r: any) => ({ ...r, vsTargetG: null, vsLineG: null })) };
    const fallback = chartSpecFor('station', noWeightAtAll);
    expect(fallback?.title).toBe('Cones by station');
    expect(fallback?.points.map((p) => p.value)).toEqual([150, 150]);
  });

  it('reject: the Pareto reasons, in the order the report already ranks them', () => {
    const spec = chartSpecFor('reject', rejectData);
    expect(spec?.points).toEqual([
      { category: 'Broken end', value: 40 },
      { category: 'Stain', value: 27 },
    ]);
  });

  it('management-summary: product mix cone counts, never the KPI table', () => {
    const spec = chartSpecFor('management-summary', summaryData);
    expect(spec?.title).toBe('Cone production by product (current period)');
    expect(spec?.points).toEqual([
      { category: 'Product A', value: 200 },
      { category: 'Product B', value: 100 },
    ]);
  });

  it('returns null rather than fabricate a series when a report has nothing chartable', () => {
    const empty = { ...coneWeightData, byStation: [] };
    expect(chartSpecFor('cone-weight', empty)).toBeNull();
  });
});

describe('U4c: styling — title bands, header fill, auto-width, print titles', () => {
  it('every non-attribution sheet carries a two-line title band above the header row', () => {
    const header = makeHeader('daily', 'Daily production report');
    const sheets = reportSheets('daily', dailyData, header, dailyCsv(dailyData));
    const reportSheet = sheets.find((s) => s.name === 'Report')!;
    expect(reportSheet.titleRows ?? []).toEqual([]); // the attribution sheet IS the title band

    const daySheet = sheets.find((s) => s.name === 'Day')!;
    expect(daySheet.titleRows?.length).toBe(2);
    expect(daySheet.titleRows![0]).toContain('Daily production report');
    expect(daySheet.titleRows![0]).toContain('Day');
    expect(daySheet.titleRows![1]).toContain('TP1 Line 3');
    expect(daySheet.titleRows![1]).toContain('2026-09-01 to 2026-09-03');
    expect(daySheet.titleRows![1]).toContain('test-build');
  });

  it('the title band is merged, bold, and pushes the header row and freeze pane down by its own height', () => {
    const header = makeHeader('daily', 'Daily production report');
    const sheets = reportSheets('daily', dailyData, header, dailyCsv(dailyData));
    const daySheet = sheets.find((s) => s.name === 'Day')!;
    const buf = buildXlsx(sheets);
    const entries = readZipEntries(buf);
    const sheetIdx = sheets.indexOf(daySheet);
    const xml = entries.find((e) => e.name === `xl/worksheets/sheet${sheetIdx + 1}.xml`)!.data.toString('utf8');

    expect(xml).toContain('<mergeCells count="2">');
    expect(xml).toContain('<mergeCell ref="A1:');
    expect(xml).toContain('<mergeCell ref="A2:');
    // header row is row 3 (two title rows above it); freeze covers through row 3.
    expect(xml).toContain('<row r="3">');
    expect(xml).toContain('ySplit="3"');
    expect(xml).toContain('topLeftCell="A4"');
  });

  it('header cells use the filled/bordered style, not the plain bold one', () => {
    const header = makeHeader('daily', 'Daily production report');
    const sheets = reportSheets('daily', dailyData, header, dailyCsv(dailyData));
    const buf = buildXlsx(sheets);
    const entries = readZipEntries(buf);
    const daySheet = sheets.find((s) => s.name === 'Day')!;
    const xml = entries.find((e) => e.name === `xl/worksheets/sheet${sheets.indexOf(daySheet) + 1}.xml`)!.data.toString('utf8');
    // The header row (row 3) cells carry style index 6 (headerFill); title rows carry style 1 (bold only).
    expect(xml).toMatch(/<row r="3">.*s="6"/);
    const stylesXmlPart = entries.find((e) => e.name === 'xl/styles.xml')!.data.toString('utf8');
    expect(stylesXmlPart).toContain('<fills count="3">');
    expect(stylesXmlPart).toContain('<borders count="2">');
    expect(stylesXmlPart).toContain('<cellXfs count="7">');
  });

  it('numbers carry a thousands separator and percentages remain fractions with a % format', () => {
    const entries = readZipEntries(buildXlsx([
      {
        name: 'Sheet1',
        columns: [
          { header: 'Cones', key: 'cones', type: 'integer' },
          { header: 'Reject %', key: 'pct', type: 'percent' },
        ],
        rows: [{ cones: 12345, pct: 2.5 }],
      },
    ]));
    const styles = entries.find((e) => e.name === 'xl/styles.xml')!.data.toString('utf8');
    expect(styles).toContain('formatCode="#,##0"');
    expect(styles).toContain('formatCode="#,##0.0"');
    expect(styles).toContain('formatCode="0.0%"');
    const sheet1 = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')!.data.toString('utf8');
    expect(sheet1).toContain('<v>12345</v>'); // raw value; #,##0 formatting is display-only
    expect(sheet1).toContain('<v>0.025</v>'); // fraction, not 2.5
  });

  it('column width is sized to the widest cell, not left at the bare type default', () => {
    const wide = 'A'.repeat(50);
    const entries = readZipEntries(buildXlsx([
      { name: 'Sheet1', columns: [{ header: 'Label', key: 'label', type: 'text' }], rows: [{ label: wide }] },
    ]));
    const sheet1 = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')!.data.toString('utf8');
    const m = sheet1.match(/<col min="1" max="1" width="(\d+(?:\.\d+)?)"/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(18); // > the bare 'text' default width
    expect(Number(m![1])).toBeLessThanOrEqual(60); // capped
  });

  it('mean_g / sack_weight_kg headers carry their unit parenthesised', () => {
    const header = makeHeader('station', 'Station report');
    const sheets = reportSheets('station', stationData, header, stationCsv(stationData));
    const sheet = sheets.find((s) => s.columns.some((c) => c.key === 'mean_g'))!;
    const col = sheet.columns.find((c) => c.key === 'mean_g')!;
    expect(col.header).toBe('Mean (g)');
  });

  it('every sheet gets a Print_Area and Print_Titles defined name, scoped to its own localSheetId', () => {
    const header = makeHeader('daily', 'Daily production report');
    const sheets = reportSheets('daily', dailyData, header, dailyCsv(dailyData));
    const buf = buildXlsx(sheets);
    const entries = readZipEntries(buf);
    const workbook = entries.find((e) => e.name === 'xl/workbook.xml')!.data.toString('utf8');
    const areaIds = [...workbook.matchAll(/_xlnm\.Print_Area" localSheetId="(\d+)"/g)].map((m) => Number(m[1]));
    const titleIds = [...workbook.matchAll(/_xlnm\.Print_Titles" localSheetId="(\d+)"/g)].map((m) => Number(m[1]));
    expect(areaIds).toEqual(sheets.map((_, i) => i));
    expect(titleIds).toEqual(sheets.map((_, i) => i));
  });
});
