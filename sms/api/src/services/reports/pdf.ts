/**
 * Server-side PDF export — the deliverable the owner asked for verbatim:
 * "a pdf file with proper structure and formate with beautification, not
 * just numbers added in the coloums and rows" (WAVE-F-CONTRACT.md,
 * IFL-ANSWERS-2026-09-15.md §10: "beautiful, Excel AND PDF, with graphics").
 *
 * THE APPROACH, AND WHY. This module does not re-implement any report's
 * layout: it drives a headless copy of Microsoft **Edge** — via
 * `puppeteer-core`, never plain `puppeteer` — to load the REAL report page
 * this server already serves (the built React app under `WEB_DIST`, the
 * same page a signed-in person sees), and asks Chromium's own print engine
 * to turn that page into a PDF. The PDF therefore inherits, automatically
 * and without a second implementation to keep in sync:
 *   - Phase 9's print CSS (`web/src/app.css`'s `@page` rules, the
 *     `report-landscape` orientation, the 8pt tightened `.tw` tables),
 *   - the title block and provenance line (`PrintHead.tsx` — the same
 *     "line · period · generated at (plant clock) · by whom · SMS version"
 *     every screen already prints, including its Phase 9 degraded path),
 *   - whatever charts and monochrome styling the parallel Weight/chart.tsx
 *     work lands, with zero coupling from this file to that one.
 * One layout, three outputs (screen, CSV/XLSX, PDF), no drift.
 *
 * WHY `puppeteer-core`, NOT `puppeteer` (owner-approved; the one dependency
 * this change adds — see api/package.json). Plain `puppeteer` downloads and
 * bundles its own Chromium at `npm install` time. **The plant PC is
 * air-gapped**, so that download would simply fail there, and even where it
 * succeeds it duplicates a ~300 MB browser Windows already ships.
 * `puppeteer-core` is the same driver API with the download removed: it
 * drives whatever browser executable you hand it. `edge.ts`'s `locateEdge`
 * finds the Edge that is preinstalled on every Windows machine this app
 * targets, and hands its path here.
 *
 * WHAT "beautification" DOES NOT MEAN. This module adds no template, no
 * second stylesheet and no design decision of its own — every visual choice
 * belongs to Phase 9's print CSS. Whether a given report actually looks
 * beautiful once printed is the owner's call, not this file's: this module
 * proves the pipeline runs end to end (page loads, header renders, Chromium
 * produces a well-formed multi-page PDF of the expected rough size) and
 * nothing about on-paper appearance, which no tool in this environment can
 * see (see routes/reports.ts's export handler and this repo's usual print
 * caveats — Phase 9's "no print-pipeline verification exists" applies here
 * unchanged).
 */
import puppeteer, { type Browser } from 'puppeteer-core';
import { mintRenderToken, revokeRenderToken, RENDER_TOKEN_COOKIE, type AuthUser } from '../../auth.js';
import type { ReportFilters, ReportType } from './common.js';
import type { ResolvedPeriod } from '../report.js';
import type { ShiftRange } from '../../shiftRange.js';

/** One page load must complete (network-idle, then the header actually rendering) within this long, or the render fails loudly. */
export const RENDER_TIMEOUT_MS = 30_000;

/** A4 landscape (297 mm) less app.css's 14 mm side margins, at 96 px/in: the width the report actually prints at. */
export const PRINT_VIEWPORT_WIDTH_PX = Math.round(((297 - 28) / 25.4) * 96);

/**
 * The exact SPA URL the on-screen report uses, reproduced from the ALREADY
 * RESOLVED server-side period rather than re-deriving one client-side from
 * "today" — `p=pick&from=…&to=…` makes the client's own `resolvePeriod`
 * (web/src/lib/period.ts) land on precisely the same day bounds
 * `routes/reports.ts`'s `parse()` already computed for this export, with no
 * dependence on what the plant clock reads at the moment Chromium's page
 * loads. Query keys match `App.tsx`'s `parseRoute`/`routeSearch` exactly
 * (`s`, `rt`, `rsh`, `st`, `pr`, `at`) — there is no second parser to drift
 * out of step with; a change to that file's key names would need a matching
 * change here, same as any other consumer of that URL contract.
 *
 * A SHIFT-BOUNDED period (D-49, 1 Oct 2026). A request that carried
 * `fromShift`/`toShift` (the route decodes them into `shiftRange`) is a period
 * of its own, "2 Sep morning shift – 3 Sep night shift", narrower than the
 * calendar days `resolved` holds. This URL used to drop it: the PDF loaded
 * `p=pick&from=…&to=…`, so the page fetched the whole calendar days and
 * printed those figures, while the CSV and workbook of the same request DID
 * honour the range — three files, one request, two different periods. It is now written the way
 * the SPA writes it itself (web/src/lib/period.ts `writePeriodParams`):
 * `p=range&from=YYYY-MM-DD.shift&to=YYYY-MM-DD.shift`, which the page decodes
 * and sends back to the server as `fromShift`/`toShift`.
 */
export function buildRenderUrl(
  baseUrl: string,
  type: ReportType,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  atMs: number | null,
  shiftRange?: ShiftRange | null,
): string {
  const u = new URL('/', baseUrl);
  u.searchParams.set('s', 'report');
  u.searchParams.set('rt', type);
  if (shiftRange) {
    u.searchParams.set('p', 'range');
    u.searchParams.set('from', `${shiftRange.from}.${shiftRange.fromShift}`);
    u.searchParams.set('to', `${shiftRange.to}.${shiftRange.toShift}`);
  } else {
    u.searchParams.set('p', 'pick');
    u.searchParams.set('from', resolved.from);
    u.searchParams.set('to', resolved.to);
  }
  if (filters.shift) u.searchParams.set('rsh', filters.shift);
  if (filters.station != null) u.searchParams.set('st', String(filters.station));
  if (filters.product != null) u.searchParams.set('pr', String(filters.product));
  // Only ever set when the caller's own request carried `at` AND the server
  // allows replays (routes/reports.ts's `parse()` already applied that
  // gate before calling here) — so a production deployment, where
  // LIVE_ALLOW_AS_OF is false, never sets this, and the PDF's "generated
  // at" is the real plant clock, never a replayed one.
  if (atMs != null) u.searchParams.set('at', new Date(atMs).toISOString());
  return u.toString();
}

/**
 * Rough page count from the PDF's own object stream: one `/Type /Page`
 * object per page, distinct from the single `/Type /Pages` tree node (the
 * negative lookahead excludes it). This is a reporting convenience — "how
 * many pages did this come out to" for the acceptance run — not a
 * correctness-critical value anywhere in the app; Chromium's producers have
 * written this shape consistently across every version this was checked
 * against, but no PDF parser is added as a dependency to make the count
 * exact for every possible producer.
 */
export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

/** The options handed to Chromium's print engine. Orientation, margins and the running footer ("Page X of Y") all come from the page's own CSS (`@page`, `preferCSSPageSize`); Chromium's own header/footer is deliberately off so the footer prints once. */
export function buildPdfOptions() {
  return {
    printBackground: true,
    preferCSSPageSize: true,
  };
}

let browserPromise: Promise<Browser> | null = null;

/** Launch Edge once per process and reuse it; a failed launch clears the cache so the next call retries cleanly. */
async function getBrowser(executablePath: string): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath,
        headless: true,
        // Loopback-only self-connection (this process navigates to a server
        // this same process is running): a self-signed cert under DEPLOY.md's
        // optional direct-TLS mode would otherwise fail Chromium's own
        // certificate validation. Never affects a request to anywhere else,
        // because this browser instance never navigates anywhere else.
        args: ['--ignore-certificate-errors'],
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/** For tests and graceful shutdown: close the cached browser, if one was launched. */
export async function closePdfBrowser(): Promise<void> {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try {
    await (await p).close();
  } catch {
    // already gone — nothing to do
  }
}

export interface RenderReportPdfInput {
  /** This server's OWN origin, built by the caller from the request that asked for the export (loopback — see routes/reports.ts). */
  baseUrl: string;
  type: ReportType;
  resolved: ResolvedPeriod;
  filters: ReportFilters;
  atMs: number | null;
  /** D-49: the shift-bounded period the request named, when it named one — see `buildRenderUrl`. */
  shiftRange?: ShiftRange | null;
  /** The already-authenticated exporter — a fresh render token is minted for them, used once, and revoked in `finally`. */
  user: AuthUser;
  edgePath: string;
}

export interface RenderedPdf {
  buffer: Buffer;
  pageCount: number;
}

/**
 * Render one report as a PDF. Opens a fresh page on the shared Edge
 * instance, authenticates it with a one-render token (auth.ts — never a
 * database session), waits for the print header to actually appear (proof
 * the report's data, not just its skeleton, loaded), and asks Chromium for
 * the PDF with `preferCSSPageSize` so the app's own `@page` rules (portrait
 * registers, landscape reports — app.css, guarded by
 * `print.landscape.guard.test.ts`) decide size and orientation, not a
 * default this file would otherwise have to keep in sync by hand.
 */
export async function renderReportPdf(input: RenderReportPdfInput): Promise<RenderedPdf> {
  const browser = await getBrowser(input.edgePath);
  const { token } = mintRenderToken(input.user);
  const page = await browser.newPage();
  try {
    const origin = new URL(input.baseUrl);
    await page.setCookie({
      name: RENDER_TOKEN_COOKIE,
      value: token,
      domain: origin.hostname,
      path: '/',
      httpOnly: true,
    });
    // Lay the page out at the PRINTED width, in print media, before it
    // loads (25 Sep 2026 report-document pass). The charts size their SVG
    // from the measured width of their block (ui/chart.tsx useChartWidth);
    // under puppeteer's default 800px screen viewport they were drawn for
    // 800px and then scaled up onto the ~1,017px landscape sheet, printing
    // axis ticks at nearly twice their intended size.
    await page.setViewport({ width: PRINT_VIEWPORT_WIDTH_PX, height: 1400 });
    await page.emulateMediaType('print');
    const url = buildRenderUrl(input.baseUrl, input.type, input.resolved, input.filters, input.atMs, input.shiftRange);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });
    await page.evaluate('document.fonts.ready.then(() => true)');
    // The print header (`PrintHead.tsx`) renders nothing at all until the
    // report's header has actually arrived from the server — the same
    // signal a human would judge "has this finished loading" by, and one
    // that already exists in the app rather than a hook added for this file.
    await page.waitForSelector('.print-head', { timeout: RENDER_TIMEOUT_MS });
    const pdf = await page.pdf(buildPdfOptions());
    const buffer = Buffer.from(pdf);
    return { buffer, pageCount: countPdfPages(buffer) };
  } finally {
    revokeRenderToken(token);
    await page.close().catch(() => {});
  }
}
