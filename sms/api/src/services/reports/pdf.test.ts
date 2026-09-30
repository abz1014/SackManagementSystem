/**
 * pdf.ts's pure helpers — the URL contract with App.tsx's route parser, and
 * the page-count estimate used for the acceptance run's own reporting. The
 * end-to-end render itself (`renderReportPdf`, real Edge, real
 * puppeteer-core) is deliberately NOT exercised in this suite — see
 * routes/reports.test.ts's note on why format=pdf is mocked there — so
 * `npx vitest run` never needs Edge installed to pass, including in CI.
 */
import { describe, it, expect } from 'vitest';
import { buildRenderUrl, countPdfPages, buildPdfOptions, buildFooterTemplate, formatPlantStamp } from './pdf.js';
import type { ResolvedPeriod } from '../report.js';

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

describe('W4: PDF footer and print options', () => {
  const at = Date.UTC(2026, 8, 30, 14, 5); // plant-clock 30-09-2026 14:05

  it('formats the plant clock as DD-MM-YYYY HH:mm', () => {
    expect(formatPlantStamp(at)).toBe('30-09-2026 14:05');
  });

  it('turns the header/footer on, keeps CSS page size (orientation from @page), backgrounds on, empty header', () => {
    const o = buildPdfOptions(at, '1.2.3');
    expect(o.displayHeaderFooter).toBe(true);
    expect(o.preferCSSPageSize).toBe(true);
    expect(o.printBackground).toBe(true);
    expect(o.headerTemplate.replace(/<[^>]*>/g, '')).toBe(''); // no visible text in the header
    expect((o as Record<string, unknown>).format).toBeUndefined();
    expect((o as Record<string, unknown>).landscape).toBeUndefined();
  });

  it('footer carries page X of Y, the plant-clock time, the version and IFL internal, in small grey text', () => {
    const f = buildPdfOptions(at, '1.2.3').footerTemplate;
    expect(f).toContain('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
    expect(f).toContain('Generated 30-09-2026 14:05 (plant time)');
    expect(f).toContain('SMS v1.2.3');
    expect(f).toContain('IFL internal');
    expect(f).toMatch(/font-size:7pt/);
    expect(f).toMatch(/color:#777/);
  });

  it('does not double the v of a version that already has one, and escapes markup', () => {
    expect(buildFooterTemplate('x', 'v2.0')).toContain('SMS v2.0');
    expect(buildFooterTemplate('<b>', '1')).toContain('&lt;b&gt;');
  });
});
