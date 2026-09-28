/**
 * UX Phase 8 Brief B, File 2 — client write-gate vs server write-gate
 * crosscheck.
 *
 * `api/src/app.rbac.test.ts:376-478` enumerates GET routes against the
 * server's own rank table, but its own header says it covers reads only —
 * the WRITE routes behind `requireRole`/`canWrite`/`canName`/`canRecord`/
 * `canAdjust` are never checked against the CLIENT's own rank constants
 * (`App.tsx`'s `ENGINEER_RANK`, `EXPORT_RANK`). The precedent defect is
 * real and shipped: the register's Export button was offered at rank 2
 * while the server gated it at 3 (fixed 3 Sep 2026, `EXPORT_RANK` in
 * `App.tsx`) — a control that could only ever answer 403. That defect
 * shape is a CLIENT gate looser than the SERVER's; this test would have
 * caught it, and would catch its opposite (a client gate TIGHTER than the
 * server's, which hides a capability nobody meant to hide).
 *
 * Deliberately dumb, in `targets.guard.test.ts` / `api.callers.test.ts`'s
 * own idiom: reads source files off disk with `node:fs` and greps them —
 * no imports of the real modules, no DOM (`vitest.config.ts`'s
 * `environment: 'node'`), so this file is `.ts`, not `.tsx`.
 *
 * PAIRINGS is the explicit table the brief asks for: for every write
 * control gated by a client rank constant, the constant it is gated by,
 * the exact route it POSTs/PUTs to, and where that route's own
 * `requireRole(N)` is declared. An entry here whose route text no longer
 * appears in its file fails the "PAIRINGS is not stale" test below, so an
 * unmapped or renamed control is visible rather than silently skipped.
 *
 * ---------------------------------------------------------------------
 * WS-RC (23 Sep 2026 red-team remediation) — completeness.
 *
 * Until today PAIRINGS was a hand-maintained 6-entry table checked against
 * however many `requireRole(N)` call sites actually existed in `api/src` —
 * nothing counted them, so a new gated route with no client counterpart
 * shipped silently. `/api/admin/*`, the PDAS write routes, the report-export
 * route and `/api/products/limits/local` all had zero crosscheck coverage.
 *
 * **The real count, and how it was taken.** Every `app.<method>('<path>',
 * requireRole(...` registration under `api/src` (recursive, `.ts` only,
 * `*.test.ts` and `dist/` excluded, comments stripped first — see
 * `discoverRouteGates` below) is enumerated PROGRAMMATICALLY, by symbol —
 * the `app.METHOD(` + `requireRole(` shape, not a line number. That scan
 * finds **31** route-level gates (confirmed by an independent `grep -rnE
 * "app\.(get|post|put|patch|delete)\(.*requireRole\(" api/src --include=*.ts
 * | grep -v '\.test\.ts'"` on 23 Sep 2026, same count). It deliberately does
 * NOT count the blanket `app.use('/api', requireRole(1))` at `app.ts:335` —
 * that is the floor every route already sits on, not a distinguishing gate
 * a specific client control could be crosschecked against — nor the
 * `requireRole` function definition itself (`auth.ts:401`) or the several
 * comment-only mentions of `requireRole(N)` found while grepping (e.g.
 * `changeover.ts:126,192`, `cone.ts:109`, `ops.ts:5`, `app.ts:1156`), which
 * `discoverRouteGates`'s comment-stripped scan already excludes. Today's
 * audit reported three irreconcilable counts (58/67/78-79) because none of
 * those three passes said what they were counting; this one names its unit
 * (a route-level `requireRole(...)` registration) and its exclusions.
 *
 * Every one of the 31 is now REQUIRED to appear in exactly one of two
 * places, checked by the "every gated route is covered" test below:
 *   - PAIRINGS (20 routes) — a real client rank constant/gate exists and is
 *     crosschecked against the server's rank, exactly as the original 6
 *     entries were.
 *   - EXEMPTIONS (11 routes) — a dated, written, justified reason the route
 *     has no rank-literal client counterpart to check (never a silent gap):
 *     7 are `GET /api/admin/*` listings (a read, not a write control — this
 *     guard's own scope per the header above, and already covered by
 *     `app.rbac.test.ts`'s GET table, `api/src/app.rbac.test.ts:260-279`);
 *     4 are the product-write routes gated by a SERVER-DERIVED flag
 *     (`GET /api/product-write/status`'s `.canWrite` / `.local.canWrite`)
 *     rather than any client rank literal — `api.ts:361-377`'s own
 *     `ProductWriteStatus` doc already names this as deliberate ("a rank
 *     the server no longer honours must not still show a button that only
 *     ever answers 403").
 *
 * A route with no gate at all needs neither an entry nor an exemption —
 * this file only concerns itself with routes `requireRole` actually wraps.
 *
 * **Staleness, both directions.** PAIRINGS' existing staleness test already
 * fails when a routeNeedle stops matching real code. EXEMPTIONS gets the
 * same treatment PLUS a second check the brief specifically asked for: an
 * exemption whose route has SINCE GAINED a client rank counterpart must
 * also fail, not sail through as a permanent free pass. The 4 product-write
 * exemptions are re-verified against `Catalogue.tsx` / `ProductLimitsBlock.tsx`
 * containing no `rank >=` comparison at all (comment-stripped) — if a future
 * change adds one, the write path stopped being purely server-derived and
 * this exemption is no longer honest.
 *
 * **Comment-blindness.** This file's original `readIntConst`/`readRouteRank`
 * scanned raw file text, the same shape that produced two guard incidents
 * earlier today (`generationScope.guard.test.ts`, `api.callers.test.ts`) —
 * a prose mention of `requireRole(N)` or a rank number in a comment could
 * have been read as real code. Both `reliability.guard.test.ts` and
 * `targets.guard.test.ts` fixed this the same way (`14a2e4f`, WS-GB): a
 * LINE-PRESERVING `commentMask`/`readCode` pair, chosen over
 * `api.callers.test.ts`'s regex-replace `stripComments` because it doesn't
 * shift line numbers. This file was exposed the same way — `changeover.ts`,
 * `cone.ts` and `ops.ts` all carry comment-only mentions of `requireRole(N)`
 * that a raw-text scan could have matched — and now reuses that exact idiom
 * (copied verbatim, not reinvented a fourth time; `generationScope.guard.
 * test.ts` lives in `api/src`, a different workspace with no shared module
 * this `web/src` file can import, so — as `targets.guard.test.ts` already
 * does in this same directory — the pair is duplicated here, not imported).
 * Every read in this file now goes through `readCode`.
 * ---------------------------------------------------------------------
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const WEB_SRC = toPosix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/*$/, '');
const API_SRC = toPosix(fileURLToPath(new URL('../../api/src', import.meta.url))).replace(/\/*$/, '');
const REPO_ROOT = toPosix(fileURLToPath(new URL('../..', import.meta.url))).replace(/\/*$/, '/');
const relPath = (f: string) => toPosix(f).replace(REPO_ROOT, '');

const APP_TSX_FILE = `${WEB_SRC}/App.tsx`;
const REPORT_MODEL_FILE = `${WEB_SRC}/screens/report/model.ts`;
const REPORTS_COMMON_FILE = `${API_SRC}/services/reports/common.ts`;

/**
 * Line-preserving comment stripper, copied verbatim from
 * `reliability.guard.test.ts` / `targets.guard.test.ts` (WS-GB, `14a2e4f`)
 * rather than reinvented — see the file header. `web/src` and `api/src` are
 * separate workspaces with no shared test-support module, so, exactly as
 * `targets.guard.test.ts` already does alongside `reliability.guard.test.ts`
 * in THIS directory, the pair is duplicated per file, not imported.
 */
function commentMask(lines: string[]): boolean[] {
  let inBlock = false;
  return lines.map((l) => {
    const t = l.trimStart();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return true;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return true;
    }
    return t.startsWith('*') || t.startsWith('//');
  });
}

function stripCommentsPreservingLines(src: string): string {
  const lines = src.split('\n');
  const mask = commentMask(lines);
  return lines.map((l, i) => (mask[i] ? '' : l)).join('\n');
}

/** `readFileSync` + comment-stripping in one call — every scan in this file
 *  reads a route/screen file off disk before matching a token against it. */
function readCode(file: string): string {
  return stripCommentsPreservingLines(readFileSync(file, 'utf8'));
}

const APP_TSX = readCode(APP_TSX_FILE);

/** Read a `const NAME = <int>;` declaration out of a (comment-stripped)
 *  source string. */
function readIntConst(src: string, name: string, file: string): number {
  const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(src);
  if (!m) throw new Error(`${name} definition not found in ${file} — update this guard`);
  return Number(m[1]);
}

/**
 * Read a route's own `requireRole(<int>)` — either a literal integer, a
 * named local constant declared in the SAME file (e.g. changeover.ts's own
 * `const PDAS_WRITE_RANK = 2;`), or — new in WS-RC — a named constant
 * IMPORTED from `constFile` when it is not declared locally (e.g.
 * `reports.ts`'s `EXPORT_RANK`, which lives in
 * `services/reports/common.ts`).
 */
function readRouteRank(routeFile: string, routeNeedle: string, constFile?: string): number {
  const src = readCode(routeFile);
  const idx = src.indexOf(routeNeedle);
  if (idx === -1) {
    throw new Error(`route text "${routeNeedle}" not found in ${routeFile} — update PAIRINGS/EXEMPTIONS`);
  }
  // requireRole( ... ) appears right after the route path on the same
  // app.METHOD(...) call in every route file this test reads — search the
  // 200 chars following the route text, which comfortably spans the method
  // call and its requireRole argument without reaching the next route.
  const window = src.slice(idx, idx + 200);
  const literal = /requireRole\((\d+)\)/.exec(window);
  if (literal) return Number(literal[1]);
  const named = /requireRole\((\w+)\)/.exec(window);
  if (!named) throw new Error(`no requireRole(...) found near "${routeNeedle}" in ${routeFile}`);
  const sameFile = new RegExp(`const ${named[1]}\\s*=\\s*(\\d+)`).exec(src);
  if (sameFile) return Number(sameFile[1]);
  if (constFile) {
    const csrc = readCode(constFile);
    const m = new RegExp(`export const ${named[1]}\\s*=\\s*(\\d+)`).exec(csrc);
    if (m) return Number(m[1]);
  }
  throw new Error(
    `named requireRole constant ${named[1]} not found in ${routeFile}${constFile ? ` or ${constFile}` : ''} — pass/fix constFile`,
  );
}

/** The Setup screen is the ONE client gate for every `/api/admin/*` write
 *  form (StationsBlock, LineBlock, MachinesBlock, RulesBlock, SourcesBlock,
 *  Setup.tsx's own user management) — none of those components carry their
 *  own rank check (verified by grep, 23 Sep 2026: no `rank >=`/`ENGINEER_
 *  RANK`/`EXPORT_RANK` token in any of the five `setup/*Block.tsx` files).
 *  Unlike EXPORT_RANK/ENGINEER_RANK there is no named constant for this
 *  gate in App.tsx — it is the literal `rank >= 4` immediately guarding
 *  `<SetupScreen>` — so it is read positionally rather than by name. */
function readAdminGateRank(): number {
  const idx = APP_TSX.indexOf('<SetupScreen');
  if (idx === -1) throw new Error('<SetupScreen> render not found in App.tsx — update readAdminGateRank (ADMIN_GATE)');
  const before = APP_TSX.slice(Math.max(0, idx - 150), idx);
  const m = /rank\s*>=\s*(\d+)/.exec(before);
  if (!m) throw new Error('no `rank >= N` gate found immediately before <SetupScreen> in App.tsx — update readAdminGateRank (ADMIN_GATE)');
  return Number(m[1]);
}

type ClientGateName = 'EXPORT_RANK' | 'ENGINEER_RANK' | 'ADMIN_GATE' | 'EXPORT_MIN_RANK';

/** One reader per client-side gate a write control can be checked against.
 *  ADMIN_GATE and EXPORT_MIN_RANK are new in WS-RC — the original file only
 *  ever read EXPORT_RANK/ENGINEER_RANK, both named consts in App.tsx. */
const CLIENT_GATES: Record<ClientGateName, () => number> = {
  EXPORT_RANK: () => readIntConst(APP_TSX, 'EXPORT_RANK', 'App.tsx'),
  ENGINEER_RANK: () => readIntConst(APP_TSX, 'ENGINEER_RANK', 'App.tsx'),
  ADMIN_GATE: readAdminGateRank,
  // Report.tsx's export links (a DIFFERENT export from Readings' register
  // export above) are gated by `EXPORT_MIN_RANK`, declared in
  // `screens/report/model.ts`, not App.tsx.
  EXPORT_MIN_RANK: () => readIntConst(readCode(REPORT_MODEL_FILE), 'EXPORT_MIN_RANK', 'screens/report/model.ts'),
};

/**
 * The explicit control -> route table. `clientConstName` names one of
 * CLIENT_GATES above. `routeFile`/`routeNeedle` locate the server's own
 * gate; `routeNeedle` must be unique enough in the file to find the right
 * app.METHOD(...) call (checked by the "not stale" test). `constFile` is
 * only needed when the route's `requireRole(NAME)` constant is imported
 * rather than declared in `routeFile` itself.
 */
interface Pairing {
  control: string;
  clientConstName: ClientGateName;
  routeFile: string;
  routeNeedle: string;
  constFile?: string;
  evidence: string;
}

const PAIRINGS: Pairing[] = [
  {
    control: "Readings' Export control (Readings.tsx:248, W.report.exportCsv)",
    clientConstName: 'EXPORT_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/events/export'",
    evidence: 'the register CSV/XLSX download the 3 Sep 2026 defect was about; App.tsx passes canExport={rank >= EXPORT_RANK} to ReadingsScreen.',
  },
  {
    control: "Line's Change control / Product › Running's write control (product/Running.tsx ChangeForm, setCurrentProduct)",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/current-product'",
    evidence: 'App.tsx passes canWrite={rank >= ENGINEER_RANK} to both LineScreen and ProductScreen; both forms POST to /api/current-product (api.ts setCurrentProduct).',
  },
  {
    control: "Sacks' record-movement control (Sacks.tsx canRecord, MovementForm)",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/routes/sacks.ts`,
    routeNeedle: "app.post('/api/sacks/movements'",
    evidence: 'App.tsx passes canRecord={rank >= ENGINEER_RANK} to SacksScreen (roadmap Phase 7, IFL Q43 answer).',
  },
  {
    control: "Rejects' name-a-code control (Rejects.tsx canName) and ReasonSheet's inline rename",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/reject-codes/:id'",
    evidence: 'App.tsx passes canName={rank >= ENGINEER_RANK} to both RejectsScreen and ReasonSheet; both call setRejectLabel/api.ts:316, PUT /api/reject-codes/:id.',
  },
  {
    control: 'StationSheet’s calibration-adjustment form (canAdjust, recordAdjustment)',
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/calibration/adjustments'",
    evidence: 'App.tsx passes canAdjust={rank >= ENGINEER_RANK} to StationSheet; the form POSTs via recordAdjustment (api.ts:1794).',
  },
  {
    control: "Product › Changeover's Execute control (Changeover.tsx canExecute, changeoverExecute)",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/routes/changeover.ts`,
    routeNeedle: "app.post('/api/changeover/execute'",
    evidence:
      'App.tsx passes the SAME canWrite={rank >= ENGINEER_RANK} into ProductScreen -> ChangeoverTab (Product.tsx:97); the route is ' +
      'gated by its OWN local PDAS_WRITE_RANK constant (changeover.ts:61), deliberately not app.ts’s, per that file’s own comment ' +
      'at changeover.ts:58-59 ("Matches app.ts’s own PDAS_WRITE_RANK"). This pairing checks that the two constants, declared in ' +
      'two different files on purpose, have not drifted apart.',
  },
  // ---- New in WS-RC (23 Sep 2026) — the 14 previously-uncovered write
  // controls that DO have a real client rank gate. See EXEMPTIONS below for
  // the 11 gated routes that genuinely have none. ----
  {
    control: "Setup's create-user form (Setup.tsx:224, adminCreateUser)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/admin/users'",
    evidence: 'Only reachable at all once rank >= 4 renders <SetupScreen> (App.tsx:626); no per-form rank check inside Setup.tsx itself.',
  },
  {
    control: "Setup's user role/active toggle (Setup.tsx:106, adminUpdateUser)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.patch('/api/admin/users/:id'",
    evidence: 'Same Setup-screen gate as adminCreateUser above.',
  },
  {
    control: "Setup's password-reset form (Setup.tsx:313, adminResetPassword)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/routes/ops.ts`,
    routeNeedle: "app.post('/api/admin/users/:id/password'",
    evidence: 'Same Setup-screen gate; server route lives in routes/ops.ts, not app.ts (ops.ts:94).',
  },
  {
    control: "Setup's Stations block, name/machine-link/active edits (StationsBlock.tsx:82,117,138, adminSetStation)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/admin/stations/:id'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Stations block, link-a-raw-station-id form (StationsBlock.tsx:196, adminCreateStation)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/admin/stations'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Line block (LineBlock.tsx:62, adminSetLine)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/admin/line'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Machines block, create form (MachinesBlock.tsx:239, adminCreateMachine)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/admin/machines'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Machines block, edit/active-toggle (MachinesBlock.tsx:93,121, adminUpdateMachine)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/admin/machines/:id'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Sources block, source edits (SourcesBlock.tsx:90,94,126, adminUpdateSource)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/admin/sources/:id'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Sources block, table edits (SourcesBlock.tsx:179,208, adminUpdateSourceTable)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/admin/sources/tables/:id'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Rules block, weight-basis form (RulesBlock.tsx:106, adminSetWeightRule)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/admin/rules/weight'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Rules block, shift-boundaries form (RulesBlock.tsx:170, adminSetShiftRule)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/admin/rules/shift'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Setup's Rules block, plausibility-bounds form (RulesBlock.tsx:280, adminSetPlausibilityRule)",
    clientConstName: 'ADMIN_GATE',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/admin/rules/plausibility'",
    evidence: 'Same Setup-screen gate.',
  },
  {
    control: "Report screen's CSV/XLSX export links (Report.tsx:144-145, reportExportUrl)",
    clientConstName: 'EXPORT_MIN_RANK',
    routeFile: `${API_SRC}/routes/reports.ts`,
    routeNeedle: "app.get('/api/reports/:type/export'",
    constFile: REPORTS_COMMON_FILE,
    evidence:
      'Report.tsx:141 renders the links only when rank >= EXPORT_MIN_RANK (screens/report/model.ts); the server imports its own ' +
      'EXPORT_RANK from services/reports/common.ts (reports.ts:49), a DIFFERENT constant from App.tsx’s EXPORT_RANK used by the ' +
      'Readings register export above — same value today, separate declarations, worth crosschecking independently.',
  },
];

/**
 * Routes `requireRole` gates that are deliberately NOT in PAIRINGS, each
 * with a dated, written reason — never a silent hole. `routeNeedle` uses
 * the same lookup shape as PAIRINGS so both the "not stale" test and the
 * completeness test can locate them identically.
 */
interface Exemption {
  route: string;
  routeFile: string;
  routeNeedle: string;
  reason: string;
  dated: string;
}

const EXEMPTIONS: Exemption[] = [
  // ---- 7 admin GET (read) routes: this guard's own scope is WRITE
  // controls (see file header); the server rank for every one of these is
  // already asserted by app.rbac.test.ts's GET table (api/src/app.rbac.
  // test.ts:260-279). Visibility of the admin screen that renders these
  // reads is the SAME rank >= 4 gate PAIRINGS' ADMIN_GATE entries check
  // for the write forms living in the same blocks, so a rank mismatch on
  // reachability would already be caught by those entries failing. ----
  {
    route: 'GET /api/admin/users',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/users'",
    reason: 'Read-only listing (Setup.tsx adminListUsers); write-only scope, already covered server-side by app.rbac.test.ts:260.',
    dated: '2026-09-23',
  },
  {
    route: 'GET /api/admin/line',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/line'",
    reason: 'Read-only (LineBlock.tsx adminGetLine); write-only scope, already covered server-side by app.rbac.test.ts:267.',
    dated: '2026-09-23',
  },
  {
    route: 'GET /api/admin/machines',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/machines'",
    reason: 'Read-only (MachinesBlock.tsx adminListMachines); write-only scope, already covered server-side by app.rbac.test.ts:269.',
    dated: '2026-09-23',
  },
  {
    route: 'GET /api/admin/stations',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/stations'",
    reason: 'Read-only (StationsBlock.tsx adminListStations); write-only scope, already covered server-side by app.rbac.test.ts:263.',
    dated: '2026-09-23',
  },
  {
    route: 'GET /api/admin/sources',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/sources'",
    reason: 'Read-only (SourcesBlock.tsx adminGetSources); write-only scope, already covered server-side by app.rbac.test.ts:272.',
    dated: '2026-09-23',
  },
  {
    route: 'GET /api/admin/rules',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/rules'",
    reason: 'Read-only (RulesBlock.tsx adminGetRules); write-only scope, already covered server-side by app.rbac.test.ts:275.',
    dated: '2026-09-23',
  },
  {
    route: 'GET /api/admin/audit',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/admin/audit'",
    reason: 'Read-only (Setup.tsx adminGetAudit/adminGetAuditPage); write-only scope, already covered server-side by app.rbac.test.ts:279.',
    dated: '2026-09-23',
  },
  // ---- 4 PDAS/product-write routes: gated by a SERVER-DERIVED flag
  // (GET /api/product-write/status), never a client rank literal — see
  // api.ts:361-377's own ProductWriteStatus doc ("a rank the server no
  // longer honours must not still show a button that only ever answers
  // 403"). There is no rank constant on the client for these to be
  // crosschecked against; that absence is the deliberate design, not an
  // oversight. Re-verified below (not just declared) by the staleness
  // test, which fails if either component ever gains a `rank >=` check. ----
  {
    route: "POST /api/products (product create, Catalogue.tsx createProduct)",
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/products'",
    reason: 'Catalogue.tsx renders the create form only when status.canWrite (server-derived); no client rank literal exists to crosscheck.',
    dated: '2026-09-23',
  },
  {
    route: "POST /api/products/:id/active (retire/reactivate, Catalogue.tsx setProductActive)",
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/products/:id/active'",
    reason: 'Same status.canWrite server-derived gate as product create.',
    dated: '2026-09-23',
  },
  {
    route: "POST /api/products/:id/limits (PDAS limit change, Catalogue.tsx updateProductLimits)",
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/products/:id/limits'",
    reason: 'Same status.canWrite server-derived gate as product create.',
    dated: '2026-09-23',
  },
  {
    route: "POST /api/products/limits/local (SMS-local limit version, ProductLimitsBlock.tsx setLocalLimitVersion)",
    routeFile: `${API_SRC}/routes/cone.ts`,
    routeNeedle: "app.post('/api/products/limits/local'",
    reason: 'ProductLimitsBlock.tsx gates on canWriteLocal(status) = status.local.canWrite, a SEPARATE server-derived flag (api.ts:369-376); never a client rank literal.',
    dated: '2026-09-23',
  },
  {
    // Task L1 (28 Sep 2026): the pallet active/retire toggle mirrors POST
    // /api/products/:id/active exactly, same status.canWrite gate, added to
    // Catalogue.tsx's new PdasPallets block (DEFECTS.md D-34).
    route: "POST /api/pallets/:id/active (retire/reactivate a pallet, Catalogue.tsx setPalletActive)",
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/pallets/:id/active'",
    reason: 'PdasPallets in Catalogue.tsx gates on status.canWrite, the same server-derived ProductWriteStatus flag as product create/active/limits; no client rank literal exists to crosscheck.',
    dated: '2026-09-28',
  },
];

/**
 * Recursively list every non-test, non-declaration `.ts` file under
 * `api/src` (dist/ and node_modules/ excluded — neither is ever a sibling
 * of api/src's own tree, but excluded defensively anyway).
 */
function listApiSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listApiSrcFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface RouteGate {
  file: string;
  method: string;
  path: string;
  /** Matches PAIRINGS'/EXEMPTIONS' own `routeNeedle` shape exactly. */
  needle: string;
}

/**
 * The completeness scan: every `app.<method>('<path>', requireRole(...`
 * registration anywhere under api/src, found by symbol shape (method +
 * literal path + requireRole call immediately following), comments
 * stripped first. Deliberately does NOT match the blanket
 * `app.use('/api', requireRole(1))` — `app.use` takes no path/requireRole
 * pair in that shape, it takes a mount path and the gate as its own
 * argument, so the regex (which requires `requireRole(` as the SECOND
 * comma-separated argument after a quoted path on an `app.<verb>(` call)
 * never matches it.
 */
function discoverRouteGates(): RouteGate[] {
  const files = listApiSrcFiles(API_SRC);
  const gates: RouteGate[] = [];
  const re = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*requireRole\(/g;
  for (const file of files) {
    const src = readCode(file);
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const method = m[1]!;
      const path = m[2]!;
      gates.push({ file, method, path, needle: `app.${method}('${path}'` });
    }
  }
  return gates;
}

describe('client write-gate vs server write-gate crosscheck (the GET-only gap app.rbac.test.ts leaves)', () => {
  it('sanity: EXPORT_RANK, ENGINEER_RANK and EXPORT_MIN_RANK are still defined, and ADMIN_GATE still resolves (canary on the scan itself)', () => {
    expect(CLIENT_GATES.EXPORT_RANK()).toBeGreaterThan(0);
    expect(CLIENT_GATES.ENGINEER_RANK()).toBeGreaterThan(0);
    expect(CLIENT_GATES.EXPORT_MIN_RANK()).toBeGreaterThan(0);
    expect(CLIENT_GATES.ADMIN_GATE()).toBeGreaterThan(0);
  });

  it('PAIRINGS route text is not stale — every routeNeedle still appears in its routeFile', () => {
    const stale: string[] = [];
    for (const p of PAIRINGS) {
      const src = readCode(p.routeFile);
      if (!src.includes(p.routeNeedle)) stale.push(`${p.control}: "${p.routeNeedle}" not found in ${p.routeFile}`);
    }
    expect(stale, `PAIRINGS entries whose route text no longer matches (fix or remove them): ${stale.join('; ')}`).toEqual([]);
  });

  for (const p of PAIRINGS) {
    it(`${p.control}: client ${p.clientConstName} equals the server's requireRole on its route`, () => {
      const clientRank = CLIENT_GATES[p.clientConstName]();
      const serverRank = readRouteRank(p.routeFile, p.routeNeedle, p.constFile);
      expect(
        serverRank,
        `${p.control} — client gates at ${p.clientConstName}=${clientRank}, but the server's requireRole on ` +
          `${p.routeNeedle} (${p.routeFile}) is ${serverRank}. ${p.evidence} A disagreement here means the control ` +
          `either offers an action the server will 403 (client too loose — the exact shape of the 3 Sep 2026 Export ` +
          `defect) or hides one the server would actually allow (client too tight).`,
      ).toBe(clientRank);
    });
  }

  it('EXEMPTIONS route text is not stale — every routeNeedle still appears in its routeFile', () => {
    const stale: string[] = [];
    for (const e of EXEMPTIONS) {
      const src = readCode(e.routeFile);
      if (!src.includes(e.routeNeedle)) stale.push(`${e.route}: "${e.routeNeedle}" not found in ${e.routeFile} (dated ${e.dated})`);
    }
    expect(stale, `EXEMPTIONS entries naming a route that no longer exists (fix or remove them): ${stale.join('; ')}`).toEqual([]);
  });

  it('every EXEMPTIONS entry is dated and carries a non-trivial reason (no silent exemption)', () => {
    const bad = EXEMPTIONS.filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.dated) || e.reason.trim().length < 20);
    expect(bad.map((e) => e.route), 'every exemption must have an ISO date and a real justification').toEqual([]);
  });

  it(
    'the 4 product-write EXEMPTIONS have not since gained a client rank counterpart — Catalogue.tsx and ' +
      'ProductLimitsBlock.tsx must still contain no `rank >=` comparison (comment-stripped)',
    () => {
      const catalogue = readCode(`${WEB_SRC}/screens/product/Catalogue.tsx`);
      const limitsBlock = readCode(`${WEB_SRC}/screens/product/ProductLimitsBlock.tsx`);
      const offenders: string[] = [];
      if (/rank\s*>=/.test(catalogue)) offenders.push('Catalogue.tsx');
      if (/rank\s*>=/.test(limitsBlock)) offenders.push('ProductLimitsBlock.tsx');
      expect(
        offenders,
        `${offenders.join(', ')} now contain a client rank comparison — the "server-derived only" EXEMPTIONS for the ` +
          'product-write routes are stale; add real PAIRINGS entries for whichever control gained the check instead of ' +
          'leaving the old exemption in place.',
      ).toEqual([]);
    },
  );

  it('every requireRole-gated route in api/src is covered by PAIRINGS or a dated EXEMPTIONS entry (completeness)', () => {
    const gates = discoverRouteGates();
    expect(gates.length, 'discoverRouteGates found no gated routes at all — the scan itself is broken, not the app').toBeGreaterThan(0);
    const uncovered: string[] = [];
    for (const g of gates) {
      const inPairings = PAIRINGS.some((p) => p.routeFile === g.file && p.routeNeedle === g.needle);
      const inExemptions = EXEMPTIONS.some((e) => e.routeFile === g.file && e.routeNeedle === g.needle);
      if (!inPairings && !inExemptions) {
        uncovered.push(`${g.method.toUpperCase()} ${g.path} (${relPath(g.file)}, needle "${g.needle}")`);
      }
    }
    expect(
      uncovered,
      `Gated route(s) with no client-side crosscheck and no exemption (${uncovered.length}) — add a PAIRINGS entry if a ` +
        `real client rank gate exists, or a dated/justified EXEMPTIONS entry if it genuinely has none: ${uncovered.join('; ')}`,
    ).toEqual([]);
  });

  it('discoverRouteGates finds exactly the 31 routes this file accounts for (PAIRINGS + EXEMPTIONS) — a drift in either direction needs a human to look', () => {
    const gates = discoverRouteGates();
    expect(gates.length).toBe(PAIRINGS.length + EXEMPTIONS.length);
  });
});
