/**
 * pdf.ts's pure helpers — the URL contract with App.tsx's route parser, and
 * the page-count estimate used for the acceptance run's own reporting. The
 * end-to-end render itself (`renderReportPdf`, real Edge, real
 * puppeteer-core) is deliberately NOT exercised in this suite — see
 * routes/reports.test.ts's note on why format=pdf is mocked there — so
 * `npx vitest run` never needs Edge installed to pass, including in CI.
 */
import { describe, it, expect } from 'vitest';
import { buildRenderUrl, countPdfPages, buildPdfOptions } from './pdf.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';

const resolved: ResolvedPeriod = { period: 'custom', from: '2026-09-01', to: '2026-09-07' };

describe('buildRenderUrl', () => {
  it('matches App.tsx\'s parseRoute/routeSearch key contract: s=report, rt=<type>, p=pick, from/to', () => {
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'reject', resolved, {}, null));
    expect(url.searchParams.get('s')).toBe('report');
    expect(url.searchParams.get('rt')).toBe('reject');
    expect(url.searchParams.get('p')).toBe('pick');
    expect(url.searchParams.get('from')).toBe('2026-09-01');
    expect(url.searchParams.get('to')).toBe('2026-09-07');
    expect(url.searchParams.has('rsh')).toBe(false);
    expect(url.searchParams.has('st')).toBe(false);
    expect(url.searchParams.has('pr')).toBe(false);
    expect(url.searchParams.has('at')).toBe(false);
  });

  it('carries shift/station/product filters under the same keys the SPA reads (rsh, st, pr)', () => {
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'machine-product', resolved, { shift: 'night', station: 7, product: 21 }, null));
    expect(url.searchParams.get('rsh')).toBe('night');
    expect(url.searchParams.get('st')).toBe('7');
    expect(url.searchParams.get('pr')).toBe('21');
  });

  it('carries a replay instant as an ISO string under `at`, only when one is given', () => {
    const atMs = Date.parse('2026-09-07T10:00:00.000Z');
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'daily', resolved, {}, atMs));
    expect(url.searchParams.get('at')).toBe('2026-09-07T10:00:00.000Z');
  });

  it('is anchored at the given base URL\'s own origin, never a hardcoded host', () => {
    const url = new URL(buildRenderUrl('https://127.0.0.1:8443', 'sack', resolved, {}, null));
    expect(url.origin).toBe('https://127.0.0.1:8443');
  });

  it('every report type produces a URL the SPA\'s own REPORT_TYPES set would accept as rt', () => {
    for (const t of ['daily', 'shift', 'product', 'station', 'reject', 'cone-weight', 'sack', 'calibration', 'management-summary', 'machine-product'] as const) {
      const url = new URL(buildRenderUrl('http://127.0.0.1:4000', t, resolved, {}, null));
      expect(url.searchParams.get('rt')).toBe(t);
    }
  });
});

/**
 * D-49 (1 Oct 2026): the PDF used to be rendered from `p=pick&from&to` whatever
 * the request asked for, so a request narrowed to "2 Sep morning shift - 3 Sep
 * night shift" came back as a PDF of the whole calendar days while the CSV and
 * workbook of the same request honoured the range. The SPA reads a shift range
 * as `p=range&from=YYYY-MM-DD.shift&to=YYYY-MM-DD.shift` (web/src/lib/period.ts).
 */
describe('buildRenderUrl: a shift-bounded period (D-49)', () => {
  const range: ShiftRange = { from: '2026-09-02', fromShift: 'morning', to: '2026-09-03', toShift: 'night' };
  const rangeResolved: ResolvedPeriod = { period: 'custom', from: '2026-09-02', to: '2026-09-03' };

  it('writes p=range with the encoded shift references, the SPA\'s own form', () => {
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'daily', rangeResolved, {}, null, range));
    expect(url.searchParams.get('s')).toBe('report');
    expect(url.searchParams.get('rt')).toBe('daily');
    expect(url.searchParams.get('p')).toBe('range');
    expect(url.searchParams.get('from')).toBe('2026-09-02.morning');
    expect(url.searchParams.get('to')).toBe('2026-09-03.night');
  });

  it('is exactly what web/src/lib/period.ts decodes: the same pattern, both ends, and the page period is the range', () => {
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'daily', rangeResolved, {}, null, range));
    const shiftRef = /^(\d{4}-\d{2}-\d{2})\.(morning|evening|night)$/;
    expect(shiftRef.exec(url.searchParams.get('from')!)?.slice(1)).toEqual(['2026-09-02', 'morning']);
    expect(shiftRef.exec(url.searchParams.get('to')!)?.slice(1)).toEqual(['2026-09-03', 'night']);
    // And the plain-calendar form is gone: nothing left for the page to read as whole days.
    expect(url.searchParams.get('p')).not.toBe('pick');
  });

  it('one shift is a range from and to the same reference', () => {
    const one: ShiftRange = { from: '2026-09-02', fromShift: 'evening', to: '2026-09-02', toShift: 'evening' };
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'daily', rangeResolved, {}, null, one));
    expect(url.searchParams.get('p')).toBe('range');
    expect(url.searchParams.get('from')).toBe('2026-09-02.evening');
    expect(url.searchParams.get('to')).toBe('2026-09-02.evening');
  });

  it('carries the filters and a replay instant beside the range, under the same keys as before', () => {
    const atMs = Date.parse('2026-09-07T10:00:00.000Z');
    const url = new URL(buildRenderUrl('http://127.0.0.1:4000', 'rejected-hangers', rangeResolved, { shift: 'night', station: 7, product: 21 }, atMs, range));
    expect(url.searchParams.get('rsh')).toBe('night');
    expect(url.searchParams.get('st')).toBe('7');
    expect(url.searchParams.get('pr')).toBe('21');
    expect(url.searchParams.get('at')).toBe('2026-09-07T10:00:00.000Z');
    expect(url.searchParams.get('p')).toBe('range');
  });

  it('with no range, or an explicit null, the URL is exactly the plain-calendar form it always was', () => {
    const plain = buildRenderUrl('http://127.0.0.1:4000', 'daily', resolved, {}, null);
    expect(buildRenderUrl('http://127.0.0.1:4000', 'daily', resolved, {}, null, null)).toBe(plain);
    expect(buildRenderUrl('http://127.0.0.1:4000', 'daily', resolved, {}, null, undefined)).toBe(plain);
    const url = new URL(plain);
    expect(url.searchParams.get('p')).toBe('pick');
    expect(url.searchParams.get('from')).toBe('2026-09-01');
    expect(url.searchParams.get('to')).toBe('2026-09-07');
  });

  it('every one of the eighteen report types is accepted as rt with a range, including IFL\'s eight', () => {
    for (const t of [
      'daily', 'shift', 'product', 'station', 'reject', 'cone-weight', 'sack', 'calibration', 'management-summary', 'machine-product',
      'shift-production', 'rejected-cones', 'rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary', 'rejected-hangers', 'rejected-unknown-lifter',
    ] as const) {
      const url = new URL(buildRenderUrl('http://127.0.0.1:4000', t, rangeResolved, {}, null, range));
      expect(url.searchParams.get('rt')).toBe(t);
      expect(url.searchParams.get('p')).toBe('range');
    }
  });
});

describe('countPdfPages', () => {
  it('counts one /Type /Page object per page, excluding the single /Type /Pages tree node', () => {
    const fake = Buffer.from(
      '%PDF-1.7\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >> endobj\n' +
        '2 0 obj << /Type /Page /Parent 1 0 R >> endobj\n' +
        '3 0 obj << /Type /Page /Parent 1 0 R >> endobj\n%%EOF',
      'latin1',
    );
    expect(countPdfPages(fake)).toBe(2);
  });

  it('tolerates the compact form Chromium actually writes (/Type/Page, no space)', () => {
    const fake = Buffer.from('/Type/Pages/Kids[]  /Type/Page /Type/Page /Type/Page', 'latin1');
    expect(countPdfPages(fake)).toBe(3);
  });

  it('returns 0 for a buffer with no page objects at all, rather than throwing', () => {
    expect(countPdfPages(Buffer.from('not a pdf'))).toBe(0);
  });
});

describe('PDF print options', () => {
  it('keeps CSS page size (orientation from @page), backgrounds on, and Chromium header/footer OFF so the CSS @page footer prints once', () => {
    const o = buildPdfOptions() as Record<string, unknown>;
    expect(o.preferCSSPageSize).toBe(true);
    expect(o.printBackground).toBe(true);
    expect(o.displayHeaderFooter).toBeUndefined();
    expect(o.footerTemplate).toBeUndefined();
    expect(o.headerTemplate).toBeUndefined();
    expect(o.format).toBeUndefined();
    expect(o.landscape).toBeUndefined();
  });
});
