/**
 * Port of sms/web/src/rank.crosscheck.test.ts to the redesign (fix-wave T6, TRACE B6-06).
 *
 * A write control in web-next is gated by a name from `ranks.ts` (ENGINEER_RANK, EXPORT_MIN_RANK, ADMIN_RANK).
 * The server gates the same action with its own `requireRole(N)`. The 3 Sep 2026 defect was a control offered at
 * rank 2 whose route answered 403 below rank 3. This test reads both sides off disk and fails when:
 *  - a pairing's client name resolves to a different number than the server's requireRole on its route,
 *  - a pairing is STALE (the control file, its api marker, its gate name, or the route text no longer exists),
 *  - an api route behind requireRole has neither a pairing, a rule (every /api/admin/* route is Setup, ADMIN_RANK)
 *    nor a dated exemption (a new gated route nobody crosschecked).
 *
 * Pairings are the old test's, re-pointed at web-next control files. Comments are stripped line-preserving.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const NEXT_SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '');
/** SMS_GUARD_API_SRC (test hook, unset normally): read the server routes from this copy instead, for the red-proof. */
const API_SRC = toPosix(process.env.SMS_GUARD_API_SRC ?? fileURLToPath(new URL('../../api/src', import.meta.url))).replace(/\/*$/, '');
const REPORT_MODEL = toPosix(fileURLToPath(new URL('../../web/src/screens/report/model.ts', import.meta.url)));
const REPORTS_COMMON = `${API_SRC}/services/reports/common.ts`;

function stripComments(src: string): string {
  let inBlock = false;
  return src
    .split('\n')
    .map((l) => {
      const t = l.trimStart();
      if (inBlock) {
        if (t.includes('*/')) inBlock = false;
        return '';
      }
      if (t.startsWith('/*')) {
        if (!t.includes('*/')) inBlock = true;
        return '';
      }
      return t.startsWith('*') || t.startsWith('//') ? '' : l;
    })
    .join('\n');
}
const read = (f: string) => stripComments(readFileSync(f, 'utf8'));

export function readIntConst(src: string, name: string): number | null {
  const m = new RegExp(String.raw`(?:export\s+)?const\s+${name}\s*=\s*(\d+)`).exec(src);
  return m ? Number(m[1]) : null;
}

/** Client names -> numbers, from their real definitions (never a second copy). */
function clientRanks(): Record<string, number> {
  return {
    ENGINEER_RANK: readIntConst(read(`${NEXT_SRC}/ranks.ts`), 'ENGINEER_RANK') ?? NaN,
    ADMIN_RANK: readIntConst(read(`${NEXT_SRC}/ui/nav.ts`), 'ADMIN_RANK') ?? NaN,
    EXPORT_MIN_RANK: readIntConst(read(REPORT_MODEL), 'EXPORT_MIN_RANK') ?? NaN,
  };
}

/* ---- server side ---------------------------------------------------------- */

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir}/${e.name}`;
    return e.isDirectory() ? listTs(full) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [full] : [];
  });
}
export interface Gate { file: string; method: string; path: string; arg: string }
/** Every `app.<method>('<path>', requireRole(<arg>)` registration under api/src. */
export function discoverGates(files: Array<{ file: string; code: string }>): Gate[] {
  const out: Gate[] = [];
  const re = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*requireRole\(\s*([\w]+)\s*\)/g;
  for (const f of files) for (const m of f.code.matchAll(re)) out.push({ file: f.file, method: m[1]!.toUpperCase(), path: m[2]!, arg: m[3]! });
  return out;
}
const API_FILES = listTs(API_SRC).map((file) => ({ file, code: read(file) }));
const GATES = discoverGates(API_FILES);

/** The number behind a requireRole argument: a literal, a const in the same file, or the reports common EXPORT_RANK. */
export function serverRank(g: Gate, codeOf: (f: string) => string = (f) => read(f), common: string = read(REPORTS_COMMON)): number | null {
  if (/^\d+$/.test(g.arg)) return Number(g.arg);
  return readIntConst(codeOf(g.file), g.arg) ?? readIntConst(common, g.arg);
}
const gateOf = (method: string, path: string) => GATES.find((g) => g.method === method && g.path === path);

/* ---- the table ------------------------------------------------------------ */

type Client = 'ENGINEER_RANK' | 'EXPORT_MIN_RANK' | 'ADMIN_RANK';
interface Pairing { control: string; file: string; marker: string; client: Client; method: string; path: string }

const PAIRINGS: Pairing[] = [
  { control: 'Products > Board: set the default product', file: 'screens/Products/Board/ProductsBoard.tsx', marker: 'setCurrentProduct', client: 'ENGINEER_RANK', method: 'POST', path: '/api/current-product' },
  { control: 'Products > Catalogue: retire or reactivate a product', file: 'screens/Products/Catalogue/ProductsCatalogue.tsx', marker: 'setProductActive', client: 'ENGINEER_RANK', method: 'POST', path: '/api/products/:id/active' },
  { control: 'Products > Catalogue: retire or reactivate a pallet', file: 'screens/Products/Catalogue/ProductsCatalogue.tsx', marker: 'setPalletActive', client: 'ENGINEER_RANK', method: 'POST', path: '/api/pallets/:id/active' },
  { control: 'Products > Changeover: Execute', file: 'screens/Products/Changeover/ChangeoverScreen.tsx', marker: 'WriteGate', client: 'ENGINEER_RANK', method: 'POST', path: '/api/changeover/execute' },
  { control: 'Products > Limits: change limits in SMS', file: 'screens/Products/Limits/LimitsScreen.tsx', marker: 'setLocalLimitVersion', client: 'ENGINEER_RANK', method: 'POST', path: '/api/products/limits/local' },
  { control: 'Quality > Register: record a sack movement', file: 'screens/Quality/Register/StockLedger.tsx', marker: 'recordSackMovement', client: 'ENGINEER_RANK', method: 'POST', path: '/api/sacks/movements' },
  { control: 'Reason sheet: name a reject code', file: 'sheets/ReasonSheet/NameIt.tsx', marker: 'setRejectLabel', client: 'ENGINEER_RANK', method: 'PUT', path: '/api/reject-codes/:id' },
  { control: 'Station sheet: record a calibration adjustment', file: 'sheets/StationSheet/AdjustmentForm.tsx', marker: 'recordAdjustment', client: 'ENGINEER_RANK', method: 'POST', path: '/api/calibration/adjustments' },
  { control: 'System > Diagnostics: acknowledge a data finding', file: 'screens/System/Diagnostics/DqFindings.tsx', marker: 'ackDqFinding', client: 'ENGINEER_RANK', method: 'POST', path: '/api/dq-findings/:id/ack' },
  { control: 'Quality > Register: export CSV / XLSX', file: 'screens/Quality/Register/QualityRegister.tsx', marker: 'eventsExportUrl', client: 'EXPORT_MIN_RANK', method: 'GET', path: '/api/events/export' },
  { control: 'Reports: export links', file: 'screens/Reports/Builder.tsx', marker: 'reportExportUrl', client: 'EXPORT_MIN_RANK', method: 'GET', path: '/api/reports/:type/export' },
];

/** Gated routes web-next has no control for, each with a date and a reason (no silent hole). */
const EXEMPTIONS: Array<{ method: string; path: string; reason: string; dated: string }> = [
  { method: 'POST', path: '/api/products', reason: 'Create-a-product is not offered in web-next (Catalogue lists, retires and reactivates only; creation goes through Changeover, which has its own pairing).', dated: '2026-10-13' },
  { method: 'POST', path: '/api/products/:id/limits', reason: 'Change-limits-in-PDAS has no direct control: Limits writes SMS-local versions (products/limits/local) and Changeover carries the PDAS path.', dated: '2026-10-13' },
];

/** Every /api/admin/* route is behind Setup, one gate: ADMIN_RANK on the Setup screen, whatever the method. */
const ADMIN_PREFIX = '/api/admin/';

describe('web-next rank names vs the server', () => {
  const ranks = clientRanks();

  it('canary on the scan: client names resolve, the server routes were found, and a mismatch would be seen', () => {
    expect(ranks.ENGINEER_RANK).toBeGreaterThan(0);
    expect(ranks.ADMIN_RANK).toBeGreaterThan(0);
    expect(ranks.EXPORT_MIN_RANK).toBeGreaterThan(0);
    expect(GATES.length).toBeGreaterThan(20);
    // synthetic: a literal, a same-file const, an imported const and an unknown name
    const code = (f: string) => (f === 'a' ? 'const MY = 5;' : '');
    expect(serverRank({ file: 'a', method: 'GET', path: '/x', arg: '3' }, code, '')).toBe(3);
    expect(serverRank({ file: 'a', method: 'GET', path: '/x', arg: 'MY' }, code, '')).toBe(5);
    expect(serverRank({ file: 'b', method: 'GET', path: '/x', arg: 'EXPORT_RANK' }, code, 'export const EXPORT_RANK = 3;')).toBe(3);
    expect(serverRank({ file: 'b', method: 'GET', path: '/x', arg: 'NOPE' }, code, '')).toBeNull();
    expect(discoverGates([{ file: 'f', code: "app.post('/api/x', requireRole(2), h);\napp.use('/api', requireRole(1));" }])).toEqual([
      { file: 'f', method: 'POST', path: '/api/x', arg: '2' },
    ]);
  });

  it('PAIRINGS are not stale: every control file, api marker, gate name and server route still exists', () => {
    const stale: string[] = [];
    for (const p of PAIRINGS) {
      const f = `${NEXT_SRC}/${p.file}`;
      if (!existsSync(f)) {
        stale.push(`${p.control}: ${p.file} is gone`);
        continue;
      }
      const code = read(f);
      if (!code.includes(p.marker)) stale.push(`${p.control}: ${p.file} no longer mentions ${p.marker}`);
      const gated = new RegExp(String.raw`minRank=\{${p.client}\}|rank\s*>=\s*${p.client}|rank\s*<\s*${p.client}`).test(code) || (p.client === 'EXPORT_MIN_RANK' && /rank\s*[<>]=?\s*EXPORT_MIN_RANK|minRank=\{EXPORT_MIN_RANK\}/.test(read(`${NEXT_SRC}/screens/Reports/Builder.tsx`)));
      if (!gated) stale.push(`${p.control}: ${p.file} no longer gates on ${p.client}`);
      if (!gateOf(p.method, p.path)) stale.push(`${p.control}: no requireRole on ${p.method} ${p.path} under api/src`);
    }
    expect(stale).toEqual([]);
  });

  it("each pairing's client rank equals the server's requireRole on its route", () => {
    const bad: string[] = [];
    for (const p of PAIRINGS) {
      const g = gateOf(p.method, p.path);
      if (!g) continue; // reported by the stale test
      const server = serverRank(g);
      if (server !== ranks[p.client]) bad.push(`${p.control}: web-next ${p.client}=${ranks[p.client]}, server requireRole=${server} on ${p.method} ${p.path}`);
    }
    expect(bad, 'a control offered at one rank whose route answers 403 at another').toEqual([]);
  });

  it('every /api/admin/* route is requireRole(ADMIN_RANK), the one Setup gate', () => {
    const admin = GATES.filter((g) => g.path.startsWith(ADMIN_PREFIX));
    expect(admin.length, 'no admin routes found').toBeGreaterThan(10);
    const bad = admin.filter((g) => serverRank(g) !== ranks.ADMIN_RANK).map((g) => `${g.method} ${g.path} -> ${serverRank(g)}`);
    expect(bad).toEqual([]);
  });

  it('every requireRole-gated route has a pairing, the admin rule or a dated exemption (completeness)', () => {
    const uncovered = GATES.filter(
      (g) =>
        !g.path.startsWith(ADMIN_PREFIX) &&
        !PAIRINGS.some((p) => p.method === g.method && p.path === g.path) &&
        !EXEMPTIONS.some((e) => e.method === g.method && e.path === g.path),
    ).map((g) => `${g.method} ${g.path} (requireRole ${g.arg})`);
    expect(uncovered, 'a new gated route with no client crosscheck: add a PAIRINGS entry for its web-next control, or a dated EXEMPTIONS entry').toEqual([]);
  });

  it('EXEMPTIONS are dated, carry a real reason, and still name a gated route', () => {
    for (const e of EXEMPTIONS) {
      expect(e.dated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.reason.length).toBeGreaterThan(30);
      expect(gateOf(e.method, e.path), `${e.method} ${e.path} has no requireRole any more; delete the exemption`).toBeTruthy();
    }
  });

  it('ranks.ts names the report constants by re-export, never by a second definition', () => {
    const r = read(`${NEXT_SRC}/ranks.ts`);
    expect(/export\s*\{[^}]*EXPORT_MIN_RANK[^}]*\}\s*from/.test(r)).toBe(true);
    expect(/export\s*\{[^}]*ADMIN_RANK[^}]*\}\s*from/.test(r)).toBe(true);
    expect(readIntConst(r, 'ENGINEER_RANK')).toBe(2);
  });
});
